import { db } from '../src/db';
import { logger } from './logger';
import { publishToXiaohongshu, fetchDmFromXiaohongshu } from './adapters/xiaohongshu';
import { publishToDouyin, fetchDmFromDouyin } from './adapters/douyin';
import { publishToKuaishou, fetchDmFromKuaishou } from './adapters/kuaishou';
import { analyzeIntent } from './intent-client';
import type {
  AccountContext,
  FetchDmResult,
  FetchedDm,
  PublishPayload,
  PublishResult,
} from './task-types';

type RpaTaskRow = {
  id: number;
  account_id: number;
  type: string;
  payload_json: string;
  scheduled_at: string;
  status: string;
  attempts: number;
  content_id: number | null;
};

type RpaAccountRow = {
  id: number;
  platform: 'xiaohongshu' | 'douyin' | 'kuaishou';
  nickname: string;
  status: string;
  daily_quota: number;
  cookies_json: string | null;
  device_fingerprint: string | null;
};

const MAX_ATTEMPTS = 3;
const ACTIVE_HOUR_START = 8;
const ACTIVE_HOUR_END = 22;

const isInActiveHours = (): boolean => {
  const hour = new Date().getHours();
  return hour >= ACTIVE_HOUR_START && hour < ACTIVE_HOUR_END;
};

const countPublishedToday = (accountId: number): number => {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM rpa_tasks
    WHERE account_id = ? AND type = 'publish' AND status = 'succeeded'
      AND date(finished_at) = date('now')
  `).get(accountId) as { count: number };
  return row.count;
};

const claimNextTask = (): RpaTaskRow | null => {
  const transaction = db.transaction(() => {
    const task = db.prepare(`
      SELECT * FROM rpa_tasks
      WHERE status = 'queued' AND datetime(scheduled_at) <= datetime('now')
      ORDER BY scheduled_at ASC
      LIMIT 1
    `).get() as RpaTaskRow | undefined;

    if (!task) {
      return null;
    }

    const update = db.prepare(`
      UPDATE rpa_tasks
      SET status = 'running', attempts = attempts + 1, started_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'
    `).run(task.id);

    if (update.changes === 0) {
      return null;
    }

    return task;
  });

  return transaction();
};

const markSucceeded = (taskId: number, result: unknown): void => {
  db.prepare(`
    UPDATE rpa_tasks
    SET status = 'succeeded', result_json = ?, finished_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(result), taskId);
};

const markFailed = (taskId: number, error: string, attempts: number): void => {
  const finalStatus = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
  db.prepare(`
    UPDATE rpa_tasks
    SET status = ?, last_error = ?, finished_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(finalStatus, error, finalStatus === 'failed' ? new Date().toISOString() : null, taskId);
};

const toAccountContext = (row: RpaAccountRow): AccountContext => ({
  id: row.id,
  platform: row.platform,
  nickname: row.nickname,
  deviceFingerprint: row.device_fingerprint,
  cookiesJson: row.cookies_json,
});

const PLATFORM_LABELS: Record<RpaAccountRow['platform'], string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  kuaishou: '快手',
};

const runPublish = async (account: RpaAccountRow, payload: PublishPayload): Promise<PublishResult> => {
  const ctx = toAccountContext(account);
  switch (account.platform) {
    case 'xiaohongshu':
      return publishToXiaohongshu(ctx, payload);
    case 'douyin':
      return publishToDouyin(ctx, payload);
    case 'kuaishou':
      return publishToKuaishou(ctx, payload);
    default:
      return { success: false, message: `未支持的平台：${account.platform}` };
  }
};

const runFetchDm = async (
  account: RpaAccountRow
): Promise<{ result: FetchDmResult; messages: FetchedDm[] }> => {
  const ctx = toAccountContext(account);
  switch (account.platform) {
    case 'xiaohongshu':
      return fetchDmFromXiaohongshu(ctx, {});
    case 'douyin':
      return fetchDmFromDouyin(ctx, {});
    case 'kuaishou':
      return fetchDmFromKuaishou(ctx, {});
    default:
      return {
        result: { success: false, fetched: 0, leadCreated: 0, message: `fetch_dm 暂不支持平台 ${account.platform}` },
        messages: [],
      };
  }
};

const processFetchedMessages = async (
  account: RpaAccountRow,
  messages: FetchedDm[]
): Promise<{ stored: number; leadCreated: number }> => {
  let stored = 0;
  let leadCreated = 0;

  for (const msg of messages) {
    const existing = db.prepare(
      `SELECT id FROM rpa_messages WHERE account_id = ? AND platform_msg_id = ?`
    ).get(account.id, msg.platformMsgId) as { id: number } | undefined;

    if (existing) continue;

    const intentResult = await analyzeIntent(PLATFORM_LABELS[account.platform], msg.senderNickname, msg.content);

    let leadId: number | null = null;
    let processedStatus: 'pending' | 'auto_replied' | 'lead_created' | 'ignored' = 'pending';

    if (intentResult.intent === 'high' || intentResult.intent === 'medium') {
      const accountTenant = (db.prepare(`SELECT tenant FROM rpa_accounts WHERE id = ?`).get(account.id) as { tenant?: string } | undefined)?.tenant || 'default';
      const leadResult = db.prepare(`
        INSERT INTO leads (source, nickname, contact, intent, last_message, status, assignee, tenant, source_account_id, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, 'new', NULL, ?, ?, datetime('now'), datetime('now'))
      `).run(PLATFORM_LABELS[account.platform], msg.senderNickname, intentResult.intent, msg.content, accountTenant, account.id);
      leadId = Number(leadResult.lastInsertRowid);
      leadCreated += 1;
      processedStatus = 'lead_created';

      db.prepare(`
        INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
        VALUES (?, 'system', ?, ?, NULL, datetime('now'))
      `).run(leadId, `AI 意向分析：${intentResult.analysis}`, intentResult.suggestion);
    } else {
      processedStatus = 'ignored';
    }

    db.prepare(`
      INSERT INTO rpa_messages (account_id, platform_msg_id, sender_nickname, content, msg_type, fetched_at, processed_status, lead_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      account.id,
      msg.platformMsgId,
      msg.senderNickname,
      msg.content,
      msg.msgType,
      msg.fetchedAt,
      processedStatus,
      leadId
    );

    stored += 1;
  }

  return { stored, leadCreated };
};

export const runOnce = async (): Promise<void> => {
  if (!isInActiveHours()) {
    logger.info('runner', `当前时段 ${new Date().getHours()}:00 不在作息时段 ${ACTIVE_HOUR_START}-${ACTIVE_HOUR_END}，跳过`);
    return;
  }

  const task = claimNextTask();
  if (!task) {
    return;
  }

  logger.info('runner', '取到任务', { taskId: task.id, type: task.type, accountId: task.account_id });

  const account = db.prepare(`SELECT * FROM rpa_accounts WHERE id = ?`).get(task.account_id) as RpaAccountRow | undefined;
  if (!account) {
    markFailed(task.id, '账号不存在', MAX_ATTEMPTS);
    return;
  }

  if (account.status !== 'active') {
    markFailed(task.id, `账号当前状态为 ${account.status}`, MAX_ATTEMPTS);
    return;
  }

  try {
    if (task.type === 'publish') {
      const publishedToday = countPublishedToday(account.id);
      if (publishedToday >= account.daily_quota) {
        markFailed(task.id, `账号今日已发布 ${publishedToday} 条，达配额上限 ${account.daily_quota}`, MAX_ATTEMPTS);
        return;
      }

      const payload = JSON.parse(task.payload_json) as PublishPayload;
      const result = await runPublish(account, payload);

      if (result.success) {
        markSucceeded(task.id, result);
        db.prepare(`UPDATE rpa_accounts SET last_published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(account.id);

        if (task.content_id) {
          db.prepare(`
            UPDATE content_items
            SET status = 'published',
                published_at = COALESCE(published_at, datetime('now')),
                updated_at = datetime('now')
            WHERE id = ? AND status != 'published'
          `).run(task.content_id);
        }

        logger.info('runner', '发布成功', { taskId: task.id, contentId: task.content_id });
      } else {
        markFailed(task.id, result.message || '未知错误', task.attempts);
      }
      return;
    }

    if (task.type === 'fetch_dm') {
      const { result, messages } = await runFetchDm(account);
      if (result.success) {
        const { stored, leadCreated } = await processFetchedMessages(account, messages);
        markSucceeded(task.id, { ...result, stored, leadCreated });
        logger.info('runner', '私信抓取完成', { taskId: task.id, stored, leadCreated });
      } else {
        markFailed(task.id, result.message || '抓取失败', task.attempts);
      }
      return;
    }

    markFailed(task.id, `任务类型 ${task.type} 尚未实现`, MAX_ATTEMPTS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markFailed(task.id, message, task.attempts);
    logger.error('runner', '任务异常', { taskId: task.id, error: message });
  }
};

export const scheduleFetchDmTasks = (): void => {
  const accounts = db.prepare(`
    SELECT id, platform, cookies_json FROM rpa_accounts
    WHERE status = 'active' AND cookies_json IS NOT NULL
  `).all() as Array<{ id: number; platform: string; cookies_json: string }>;

  for (const account of accounts) {
    const recent = db.prepare(`
      SELECT id FROM rpa_tasks
      WHERE account_id = ? AND type = 'fetch_dm'
        AND datetime(created_at) > datetime('now', '-3 minutes')
    `).get(account.id) as { id: number } | undefined;

    if (recent) continue;

    db.prepare(`
      INSERT INTO rpa_tasks (account_id, type, payload_json, scheduled_at, status, attempts, created_at, updated_at)
      VALUES (?, 'fetch_dm', '{}', datetime('now'), 'queued', 0, datetime('now'), datetime('now'))
    `).run(account.id);

    logger.info('scheduler', '已生成 fetch_dm 任务', { accountId: account.id, platform: account.platform });
  }
};
