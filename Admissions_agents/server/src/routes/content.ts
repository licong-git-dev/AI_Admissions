import { Router } from 'express';
import { db } from '../db';
import { getTenantScope, resolveTenantForWrite } from '../middleware/tenant';
import type { AuthedRequest } from '../middleware/auth';
import { scanPlatformCompliance, type ComplianceIssue } from '../services/platform-compliance';
import { loadActiveViolationWords } from './violation-words';

type ContentTypeCode = 'policy' | 'major' | 'case' | 'reminder' | 'qa';
type PlatformId = 'xhs' | 'dy' | 'ks';
type RpaPlatform = 'xiaohongshu' | 'douyin' | 'kuaishou';

type ContentBodyItem = {
  title?: string;
  content?: string;
  imageDesc?: string;
};

type ContentRow = {
  id: number;
  title: string;
  type: ContentTypeCode;
  platforms_json: string;
  body_json: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  reject_reason: string | null;
  generated_at: string;
  published_at: string | null;
  views: number;
  likes: number;
  comments: number;
  leads: number;
};

type CreateReviewBody = {
  title?: string;
  type?: ContentTypeCode;
  platforms?: PlatformId[];
  body?: Record<string, ContentBodyItem>;
};

type UpdateReviewBody = {
  status?: 'approved' | 'rejected';
  rejectReason?: string;
};

const contentRouter = Router();
const CONTENT_TYPES: ContentTypeCode[] = ['policy', 'major', 'case', 'reminder', 'qa'];
const PLATFORM_IDS: PlatformId[] = ['xhs', 'dy', 'ks'];
const MAX_PAGE_SIZE = 100;

const PLATFORM_MAPPING: Record<PlatformId, RpaPlatform> = {
  xhs: 'xiaohongshu',
  dy: 'douyin',
  ks: 'kuaishou',
};

const pickBestAccount = (platform: RpaPlatform): { id: number; dailyQuota: number; todayPublished: number } | null => {
  const candidates = db.prepare(`
    SELECT id, daily_quota FROM rpa_accounts
    WHERE platform = ? AND status = 'active' AND cookies_json IS NOT NULL
    ORDER BY CASE role WHEN 'brand' THEN 0 ELSE 1 END, id ASC
  `).all(platform) as Array<{ id: number; daily_quota: number }>;

  for (const candidate of candidates) {
    const { count } = db.prepare(`
      SELECT COUNT(*) as count FROM rpa_tasks
      WHERE account_id = ? AND type = 'publish'
        AND (status = 'succeeded' OR status = 'queued' OR status = 'running')
        AND date(COALESCE(finished_at, scheduled_at)) = date('now')
    `).get(candidate.id) as { count: number };

    if (count < candidate.daily_quota) {
      return { id: candidate.id, dailyQuota: candidate.daily_quota, todayPublished: count };
    }
  }

  return null;
};

const scheduleTimeWithin = (baseMs: number): string => {
  const jitterMs = (5 + Math.random() * 25) * 60 * 1000;
  return new Date(baseMs + jitterMs).toISOString();
};

const createPublishTasksForContent = (contentId: number, row: ContentRow): Array<{ accountId: number; taskId: number; platform: PlatformId }> => {
  const platforms = parsePlatforms(row.platforms_json);
  const body = parseBody(row.body_json);
  const scheduled: Array<{ accountId: number; taskId: number; platform: PlatformId }> = [];

  const now = Date.now();

  for (const platformId of platforms) {
    const rpaPlatform = PLATFORM_MAPPING[platformId];
    const account = pickBestAccount(rpaPlatform);
    if (!account) {
      continue;
    }

    const platformBody = body?.[platformId] || {};
    const title = typeof platformBody.title === 'string' && platformBody.title.trim() ? platformBody.title : row.title;
    const content = typeof platformBody.content === 'string' ? platformBody.content : '';

    const payload = { title, content, imageDesc: platformBody.imageDesc || '' };

    const result = db.prepare(`
      INSERT INTO rpa_tasks (account_id, type, payload_json, scheduled_at, status, attempts, content_id, created_at, updated_at)
      VALUES (?, 'publish', ?, ?, 'queued', 0, ?, datetime('now'), datetime('now'))
    `).run(account.id, JSON.stringify(payload), scheduleTimeWithin(now), contentId);

    scheduled.push({ accountId: account.id, taskId: Number(result.lastInsertRowid), platform: platformId });
  }

  return scheduled;
};

const parsePlatforms = (value: string): PlatformId[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is PlatformId => typeof item === 'string' && PLATFORM_IDS.includes(item as PlatformId))
      : [];
  } catch {
    return [];
  }
};

const parseBody = (value: string | null): Record<string, ContentBodyItem> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, ContentBodyItem>;
  } catch {
    return null;
  }
};

contentRouter.get('/reviews', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE) : 50;

  const tenantClause = scope.isPlatformAdmin ? '' : 'AND tenant = ?';
  const params: (string | number)[] = scope.isPlatformAdmin ? [limit] : [scope.tenant, limit];

  const rows = db.prepare(`
    SELECT id, title, type, platforms_json, status, reject_reason, generated_at
    FROM content_items
    WHERE status IN ('pending', 'approved', 'rejected') ${tenantClause}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params) as Array<Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'reject_reason' | 'generated_at'>>;

  const items = rows.map((row) => ({
    id: `r${row.id}`,
    title: row.title,
    type: row.type,
    platforms: parsePlatforms(row.platforms_json),
    status: row.status,
    generatedAt: row.generated_at,
    rejectReason: row.reject_reason ?? undefined,
  }));

  res.json({ success: true, data: items, error: null });
});

contentRouter.post('/reviews', (req, res) => {
  const body = req.body as CreateReviewBody;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() as ContentTypeCode : undefined;
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((item): item is PlatformId => typeof item === 'string' && PLATFORM_IDS.includes(item as PlatformId))
    : [];

  if (!title || !type || !CONTENT_TYPES.includes(type) || platforms.length === 0) {
    return res.status(400).json({ success: false, data: null, error: 'title、type、platforms 为合法必填项' });
  }

  // 平台合规二次扫描（标题 + 各平台正文合并检查）
  const blockWords = loadActiveViolationWords();
  const textCorpus = [
    title,
    ...Object.values(body.body || {}).flatMap((v) => [v?.title, v?.content, v?.imageDesc].filter(Boolean) as string[]),
  ].join('\n');
  const scan = scanPlatformCompliance(textCorpus, blockWords);
  if (!scan.pass) {
    const blockIssues: ComplianceIssue[] = scan.issues.filter((i) => i.severity === 'block');
    return res.status(400).json({
      success: false,
      data: { issues: blockIssues },
      error: `内容命中 ${blockIssues.length} 条合规风险，已阻止入库。请修改后重试。`,
    });
  }

  const bodyJson = body.body && typeof body.body === 'object' ? JSON.stringify(body.body) : null;
  const scope = getTenantScope(req as AuthedRequest);
  const tenant = resolveTenantForWrite(scope);

  const result = db.prepare(`
    INSERT INTO content_items (title, type, platforms_json, body_json, tenant, status, generated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))
  `).run(title, type, JSON.stringify(platforms), bodyJson, tenant);

  const row = db.prepare(`
    SELECT id, title, type, platforms_json, status, reject_reason, generated_at
    FROM content_items
    WHERE id = ?
  `).get(result.lastInsertRowid) as Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'reject_reason' | 'generated_at'>;

  res.status(201).json({
    success: true,
    data: {
      id: `r${row.id}`,
      title: row.title,
      type: row.type,
      platforms: parsePlatforms(row.platforms_json),
      status: row.status,
      generatedAt: row.generated_at,
      rejectReason: row.reject_reason ?? undefined,
    },
    error: null,
  });
});

contentRouter.patch('/reviews/:id', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const rawId = Number(req.params.id.replace(/^r/, ''));
  if (!Number.isInteger(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, data: null, error: '内容 ID 非法' });
  }

  const existing = db.prepare('SELECT * FROM content_items WHERE id = ?').get(rawId) as (ContentRow & { tenant: string }) | undefined;
  if (!existing || (!scope.isPlatformAdmin && existing.tenant !== scope.tenant)) {
    return res.status(404).json({ success: false, data: null, error: '内容不存在' });
  }

  const body = req.body as UpdateReviewBody;
  const status = body.status;
  const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason.trim() : '';

  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  if (status === 'rejected' && !rejectReason) {
    return res.status(400).json({ success: false, data: null, error: 'rejectReason 为必填项' });
  }

  db.prepare(`
    UPDATE content_items
    SET status = ?, reject_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, status === 'rejected' ? rejectReason : null, rawId);

  const updated = db.prepare('SELECT * FROM content_items WHERE id = ?').get(rawId) as ContentRow;

  let scheduledTasks: Array<{ accountId: number; taskId: number; platform: PlatformId }> = [];
  if (status === 'approved' && existing.status !== 'approved') {
    scheduledTasks = createPublishTasksForContent(rawId, updated);
  }

  res.json({
    success: true,
    data: {
      id: `r${updated.id}`,
      title: updated.title,
      type: updated.type,
      platforms: parsePlatforms(updated.platforms_json),
      status: updated.status,
      generatedAt: updated.generated_at,
      rejectReason: updated.reject_reason ?? undefined,
      scheduledTasks,
    },
    error: null,
  });
});

contentRouter.get('/calendar', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const { from, to } = req.query;
  const fromDate = typeof from === 'string' && from ? from : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = typeof to === 'string' && to ? to : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const tenantFilter = scope.isPlatformAdmin ? '' : 'AND ci.tenant = ?';
  const tenantParams: (string | number)[] = scope.isPlatformAdmin ? [] : [scope.tenant];

  const items = db.prepare(`
    SELECT ci.id, ci.title, ci.type, ci.platforms_json, ci.status, ci.generated_at, ci.published_at
    FROM content_items ci
    WHERE (
      (ci.status = 'approved' AND datetime(ci.generated_at) >= datetime(?))
      OR (ci.status = 'published' AND datetime(ci.published_at) >= datetime(?))
      OR (ci.status = 'pending')
    ) ${tenantFilter}
    ORDER BY COALESCE(ci.published_at, ci.generated_at) ASC
    LIMIT 200
  `).all(fromDate, fromDate, ...tenantParams) as Array<{
    id: number;
    title: string;
    type: string;
    platforms_json: string;
    status: string;
    generated_at: string;
    published_at: string | null;
  }>;

  const tasks = db.prepare(`
    SELECT rt.id, rt.content_id as contentId, rt.account_id as accountId, rt.type,
           rt.scheduled_at as scheduledAt, rt.status, rt.finished_at as finishedAt,
           ra.platform, ra.nickname
    FROM rpa_tasks rt
    LEFT JOIN rpa_accounts ra ON ra.id = rt.account_id
    WHERE rt.type = 'publish'
      AND rt.content_id IS NOT NULL
      AND datetime(rt.scheduled_at) BETWEEN datetime(?) AND datetime(?)
  `).all(fromDate, toDate) as Array<{
    id: number;
    contentId: number | null;
    accountId: number;
    type: string;
    scheduledAt: string;
    status: string;
    finishedAt: string | null;
    platform: string;
    nickname: string;
  }>;

  res.json({
    success: true,
    data: {
      items: items.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        platforms: parsePlatforms(row.platforms_json),
        status: row.status,
        generatedAt: row.generated_at,
        publishedAt: row.published_at,
      })),
      tasks,
      range: { from: fromDate, to: toDate },
    },
    error: null,
  });
});

contentRouter.patch('/tasks/:taskId/schedule', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const body = req.body as { scheduledAt?: string };

  if (!body.scheduledAt || isNaN(Date.parse(body.scheduledAt))) {
    return res.status(400).json({ success: false, data: null, error: 'scheduledAt 非法' });
  }

  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId)) {
    return res.status(400).json({ success: false, data: null, error: '任务 ID 非法' });
  }

  const task = db.prepare(`
    SELECT rt.*, ci.tenant as content_tenant
    FROM rpa_tasks rt
    LEFT JOIN content_items ci ON ci.id = rt.content_id
    WHERE rt.id = ?
  `).get(taskId) as { id: number; status: string; content_tenant: string | null } | undefined;

  if (!task) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }

  if (!scope.isPlatformAdmin && task.content_tenant && task.content_tenant !== scope.tenant) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }

  if (task.status !== 'queued') {
    return res.status(400).json({ success: false, data: null, error: `任务状态为 ${task.status}，只能调整 queued 状态的任务` });
  }

  db.prepare(`UPDATE rpa_tasks SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`).run(body.scheduledAt, taskId);

  res.json({ success: true, data: { taskId, scheduledAt: body.scheduledAt }, error: null });
});

contentRouter.post('/compliance-scan', (req, res) => {
  const body = req.body as { text?: string };
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    return res.status(400).json({ success: false, data: null, error: 'text 必填' });
  }

  const blockWords = loadActiveViolationWords();
  const result = scanPlatformCompliance(text, blockWords);
  res.json({
    success: true,
    data: {
      pass: result.pass,
      issues: result.issues,
      sanitized: result.sanitized,
      blockCount: result.issues.filter((i) => i.severity === 'block').length,
      warnCount: result.issues.filter((i) => i.severity === 'warn').length,
    },
    error: null,
  });
});

// 内容效果回流：管理员在平台后台手动录入发布笔记的互动数据
contentRouter.patch('/records/:id/metrics', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ success: false, data: null, error: 'id 非法' });
  }

  const existing = db.prepare(`SELECT id, tenant, status FROM content_items WHERE id = ?`).get(id) as { id: number; tenant: string; status: string } | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '内容不存在' });
  }
  if (!scope.isPlatformAdmin && existing.tenant !== scope.tenant) {
    return res.status(404).json({ success: false, data: null, error: '内容不存在' });
  }
  if (existing.status !== 'published') {
    return res.status(400).json({ success: false, data: null, error: '仅支持更新已发布内容的效果数据' });
  }

  const body = req.body as { views?: number; likes?: number; comments?: number; leads?: number };
  const toInt = (v: unknown): number | null => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };
  const views = toInt(body.views);
  const likes = toInt(body.likes);
  const comments = toInt(body.comments);
  const leads = toInt(body.leads);

  const updates: string[] = [];
  const params: number[] = [];
  if (views !== null) { updates.push('views = ?'); params.push(views); }
  if (likes !== null) { updates.push('likes = ?'); params.push(likes); }
  if (comments !== null) { updates.push('comments = ?'); params.push(comments); }
  if (leads !== null) { updates.push('leads = ?'); params.push(leads); }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, data: null, error: '至少提供一个指标字段（views / likes / comments / leads）' });
  }

  updates.push(`updated_at = datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE content_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(`SELECT id, title, views, likes, comments, leads FROM content_items WHERE id = ?`).get(id);
  res.json({ success: true, data: updated, error: null });
});

contentRouter.get('/records', (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE) : 50;
  const rows = db.prepare(`
    SELECT id, title, type, platforms_json, status, published_at, views, likes, comments, leads
    FROM content_items
    WHERE status = 'published'
    ORDER BY published_at DESC, id DESC
    LIMIT ?
  `).all(limit) as Array<Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'published_at' | 'views' | 'likes' | 'comments' | 'leads'>>;

  const items = rows.map((row) => ({
    id: String(row.id),
    title: row.title,
    type: row.type,
    platforms: parsePlatforms(row.platforms_json),
    status: 'published' as const,
    stats: {
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      leads: row.leads,
    },
    createdAt: row.published_at ?? '',
  }));

  res.json({ success: true, data: items, error: null });
});

export { contentRouter };
