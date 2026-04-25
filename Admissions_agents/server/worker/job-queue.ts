import { db } from '../src/db';
import { logger } from './logger';
import { classifyError } from './error-classifier';

export type JobHandler<T = Record<string, unknown>> = (
  payload: T,
  ctx: { jobId: number; attempt: number }
) => Promise<unknown>;

type JobRow = {
  id: number;
  name: string;
  payload_json: string;
  scheduled_at: string;
  status: string;
  attempts: number;
  max_attempts: number;
};

const handlers = new Map<string, JobHandler>();

export const registerJobHandler = <T = Record<string, unknown>>(
  name: string,
  handler: JobHandler<T>
): void => {
  handlers.set(name, handler as JobHandler);
};

export type EnqueueInput = {
  name: string;
  payload?: Record<string, unknown>;
  scheduledAt?: string;
  maxAttempts?: number;
  singletonKey?: string;
};

export const enqueueJob = (input: EnqueueInput): number | null => {
  const scheduledAt = input.scheduledAt || new Date().toISOString();
  const maxAttempts = input.maxAttempts ?? 3;
  const singleton = input.singletonKey ?? null;

  if (singleton) {
    const existing = db.prepare(
      `SELECT id FROM jobs WHERE singleton_key = ? AND status IN ('queued', 'running') LIMIT 1`
    ).get(singleton) as { id: number } | undefined;
    if (existing) {
      return existing.id;
    }
  }

  const result = db.prepare(`
    INSERT INTO jobs (name, payload_json, scheduled_at, status, attempts, max_attempts, singleton_key, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', 0, ?, ?, datetime('now'), datetime('now'))
  `).run(input.name, JSON.stringify(input.payload ?? {}), scheduledAt, maxAttempts, singleton);

  return Number(result.lastInsertRowid);
};

const claimNextJob = (): JobRow | null => {
  const transaction = db.transaction(() => {
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'queued' AND datetime(scheduled_at) <= datetime('now')
      ORDER BY scheduled_at ASC
      LIMIT 1
    `).get() as JobRow | undefined;

    if (!job) return null;

    const update = db.prepare(`
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, started_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'
    `).run(job.id);

    if (update.changes === 0) return null;
    return job;
  });

  return transaction();
};

const markSucceeded = (jobId: number, result: unknown): void => {
  db.prepare(`
    UPDATE jobs
    SET status = 'succeeded', result_json = ?, finished_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(result ?? null), jobId);
};

const markFailed = (jobId: number, errorMessage: string, attempts: number, maxAttempts: number): void => {
  // v3.4.c · 智能重试：永久性错误立即失败，不浪费重试预算
  const category = classifyError(errorMessage);
  const exhausted = attempts >= maxAttempts;
  const finalStatus = (category === 'permanent' || exhausted) ? 'failed' : 'queued';
  const retryAt = finalStatus === 'queued'
    ? new Date(Date.now() + Math.min(60_000 * Math.pow(2, attempts - 1), 30 * 60_000)).toISOString()
    : null;

  db.prepare(`
    UPDATE jobs
    SET status = ?, last_error = ?, scheduled_at = COALESCE(?, scheduled_at),
        finished_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    finalStatus,
    errorMessage,
    retryAt,
    finalStatus === 'failed' ? new Date().toISOString() : null,
    jobId
  );
};

export const runJobTick = async (): Promise<void> => {
  const job = claimNextJob();
  if (!job) return;

  const handler = handlers.get(job.name);
  if (!handler) {
    markFailed(job.id, `No handler registered for job "${job.name}"`, job.max_attempts, job.max_attempts);
    logger.error('jobs', '无匹配 handler', { jobId: job.id, name: job.name });
    return;
  }

  try {
    const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
    const result = await handler(payload, { jobId: job.id, attempt: job.attempts });
    markSucceeded(job.id, result);
    logger.info('jobs', '作业成功', { jobId: job.id, name: job.name, attempt: job.attempts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category = classifyError(message);
    markFailed(job.id, message, job.attempts, job.max_attempts);
    logger.warn('jobs', '作业失败', {
      jobId: job.id,
      name: job.name,
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
      category,
      error: message,
    });
  }
};

export const getJobStats = (): { queued: number; running: number; failed: number; succeeded24h: number } => {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'succeeded' AND datetime(finished_at) > datetime('now', '-1 day') THEN 1 ELSE 0 END) as succeeded24h
    FROM jobs
  `).get() as { queued: number; running: number; failed: number; succeeded24h: number };

  return {
    queued: row.queued ?? 0,
    running: row.running ?? 0,
    failed: row.failed ?? 0,
    succeeded24h: row.succeeded24h ?? 0,
  };
};

export const cleanupOldJobs = (retainDays: number = 7): number => {
  const result = db.prepare(`
    DELETE FROM jobs
    WHERE status IN ('succeeded', 'failed')
      AND datetime(finished_at) < datetime('now', '-' || ? || ' days')
  `).run(retainDays);
  return result.changes;
};
