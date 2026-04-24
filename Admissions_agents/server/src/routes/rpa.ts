import { Router } from 'express';
import { db } from '../db';
import { encryptJson } from '../../worker/crypto-utils';
import { getTenantScope } from '../middleware/tenant';
import type { AuthedRequest } from '../middleware/auth';

type RpaAccountRow = {
  id: number;
  platform: string;
  nickname: string;
  role: string;
  status: string;
  daily_quota: number;
  followers: number;
  last_published_at: string | null;
  risk_note: string | null;
  device_fingerprint: string | null;
  created_at: string;
  updated_at: string;
};

type RpaTaskRow = {
  id: number;
  account_id: number;
  type: string;
  payload_json: string;
  scheduled_at: string;
  status: string;
  attempts: number;
  last_error: string | null;
  result_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const VALID_PLATFORMS = new Set(['xiaohongshu', 'douyin', 'kuaishou']);
const VALID_ACCOUNT_STATUSES = new Set(['active', 'paused', 'banned', 'cooldown']);
const VALID_TASK_TYPES = new Set(['publish', 'reply_dm', 'fetch_dm', 'fetch_comments']);
const VALID_TASK_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'canceled']);

const toAccount = (row: RpaAccountRow) => ({
  id: row.id,
  platform: row.platform,
  nickname: row.nickname,
  role: row.role,
  status: row.status,
  dailyQuota: row.daily_quota,
  followers: row.followers,
  lastPublishedAt: row.last_published_at,
  riskNote: row.risk_note,
  deviceFingerprint: row.device_fingerprint,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTask = (row: RpaTaskRow) => ({
  id: row.id,
  accountId: row.account_id,
  type: row.type,
  payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  scheduledAt: row.scheduled_at,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  result: row.result_json ? JSON.parse(row.result_json) : null,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const rpaRouter = Router();

rpaRouter.get('/accounts', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const { platform, status } = req.query;
  const filters: string[] = [];
  const params: string[] = [];

  if (!scope.isPlatformAdmin) {
    filters.push('tenant = ?');
    params.push(scope.tenant);
  }
  if (typeof platform === 'string' && platform) {
    filters.push('platform = ?');
    params.push(platform);
  }
  if (typeof status === 'string' && status) {
    filters.push('status = ?');
    params.push(status);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM rpa_accounts ${where} ORDER BY platform ASC, id ASC`).all(...params) as RpaAccountRow[];

  const todayPublishedStmt = db.prepare(`
    SELECT COUNT(*) as count FROM rpa_tasks
    WHERE account_id = ? AND type = 'publish' AND status = 'succeeded'
      AND date(finished_at) = date('now')
  `);

  const enriched = rows.map((row) => {
    const todayPublished = (todayPublishedStmt.get(row.id) as { count: number }).count;
    return { ...toAccount(row), todayPublished };
  });

  res.json({ success: true, data: enriched, error: null });
});

rpaRouter.patch('/accounts/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM rpa_accounts WHERE id = ?`).get(req.params.id) as RpaAccountRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '账号不存在' });
  }

  const body = req.body as { status?: string; dailyQuota?: number; riskNote?: string | null };

  if (body.status && !VALID_ACCOUNT_STATUSES.has(body.status)) {
    return res.status(400).json({ success: false, data: null, error: '状态非法' });
  }

  if (body.dailyQuota !== undefined && (!Number.isInteger(body.dailyQuota) || body.dailyQuota < 0 || body.dailyQuota > 50)) {
    return res.status(400).json({ success: false, data: null, error: 'dailyQuota 必须为 0-50 的整数' });
  }

  db.prepare(`
    UPDATE rpa_accounts
    SET status = ?, daily_quota = ?, risk_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    body.status ?? existing.status,
    body.dailyQuota ?? existing.daily_quota,
    body.riskNote ?? existing.risk_note,
    req.params.id
  );

  const updated = db.prepare(`SELECT * FROM rpa_accounts WHERE id = ?`).get(req.params.id) as RpaAccountRow;
  res.json({ success: true, data: toAccount(updated), error: null });
});

rpaRouter.get('/tasks', (req, res) => {
  const { accountId, status, type } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (typeof accountId === 'string' && accountId) {
    filters.push('account_id = ?');
    params.push(Number(accountId));
  }
  if (typeof status === 'string' && status) {
    filters.push('status = ?');
    params.push(status);
  }
  if (typeof type === 'string' && type) {
    filters.push('type = ?');
    params.push(type);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM rpa_tasks ${where} ORDER BY scheduled_at DESC LIMIT 200`).all(...params) as RpaTaskRow[];

  res.json({ success: true, data: rows.map(toTask), error: null });
});

rpaRouter.post('/tasks', (req, res) => {
  const body = req.body as {
    accountId?: number;
    type?: string;
    payload?: Record<string, unknown>;
    scheduledAt?: string;
  };

  if (!body.accountId || !Number.isInteger(body.accountId)) {
    return res.status(400).json({ success: false, data: null, error: 'accountId 必填且为整数' });
  }

  if (!body.type || !VALID_TASK_TYPES.has(body.type)) {
    return res.status(400).json({ success: false, data: null, error: 'type 非法' });
  }

  const account = db.prepare(`SELECT platform, status FROM rpa_accounts WHERE id = ?`).get(body.accountId) as { platform: string; status: string } | undefined;
  if (!account) {
    return res.status(404).json({ success: false, data: null, error: '账号不存在' });
  }

  if (!VALID_PLATFORMS.has(account.platform)) {
    return res.status(400).json({ success: false, data: null, error: '账号所属平台不受支持' });
  }

  if (account.status !== 'active') {
    return res.status(400).json({ success: false, data: null, error: `账号当前状态为 ${account.status}，不可创建任务` });
  }

  const scheduledAt = body.scheduledAt || new Date().toISOString();
  const payloadJson = JSON.stringify(body.payload ?? {});

  const result = db.prepare(`
    INSERT INTO rpa_tasks (account_id, type, payload_json, scheduled_at, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, datetime('now'), datetime('now'))
  `).run(body.accountId, body.type, payloadJson, scheduledAt);

  const created = db.prepare(`SELECT * FROM rpa_tasks WHERE id = ?`).get(result.lastInsertRowid) as RpaTaskRow;
  res.status(201).json({ success: true, data: toTask(created), error: null });
});

rpaRouter.patch('/tasks/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM rpa_tasks WHERE id = ?`).get(req.params.id) as RpaTaskRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }

  const body = req.body as { status?: string };

  if (!body.status || !VALID_TASK_STATUSES.has(body.status)) {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  db.prepare(`UPDATE rpa_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(body.status, req.params.id);

  const updated = db.prepare(`SELECT * FROM rpa_tasks WHERE id = ?`).get(req.params.id) as RpaTaskRow;
  res.json({ success: true, data: toTask(updated), error: null });
});

rpaRouter.post('/accounts/:id/cookies', (req, res) => {
  const existing = db.prepare(`SELECT * FROM rpa_accounts WHERE id = ?`).get(req.params.id) as RpaAccountRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '账号不存在' });
  }

  const body = req.body as { cookies?: unknown };

  if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
    return res.status(400).json({ success: false, data: null, error: 'cookies 必须为非空数组' });
  }

  try {
    const encrypted = encryptJson(body.cookies);
    db.prepare(`UPDATE rpa_accounts SET cookies_json = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`).run(encrypted, req.params.id);
    res.json({ success: true, data: { cookieCount: body.cookies.length }, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, data: null, error: `cookies 加密失败：${message}` });
  }
});

rpaRouter.delete('/accounts/:id/cookies', (req, res) => {
  const existing = db.prepare(`SELECT * FROM rpa_accounts WHERE id = ?`).get(req.params.id) as RpaAccountRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '账号不存在' });
  }

  db.prepare(`UPDATE rpa_accounts SET cookies_json = NULL, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ success: true, data: { cleared: true }, error: null });
});

rpaRouter.get('/accounts/:id/login-status', (req, res) => {
  const row = db.prepare(`SELECT cookies_json, status FROM rpa_accounts WHERE id = ?`).get(req.params.id) as { cookies_json: string | null; status: string } | undefined;
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '账号不存在' });
  }

  res.json({
    success: true,
    data: {
      loggedIn: Boolean(row.cookies_json),
      status: row.status,
    },
    error: null,
  });
});

// KOS 排行榜：按 operator 员工维度聚合账号 → 线索 → 成交 → 分成
rpaRouter.get('/kos-ranking', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const { period } = req.query;

  let periodStart: string;
  let periodLabel: string;
  if (period === 'today') {
    periodStart = "datetime('now', 'start of day')";
    periodLabel = 'today';
  } else if (period === 'week') {
    periodStart = "datetime('now', '-7 days')";
    periodLabel = 'last7days';
  } else {
    periodStart = "datetime('now', 'start of month')";
    periodLabel = 'thisMonth';
  }

  const tenantFilter = scope.isPlatformAdmin ? '' : 'AND ra.tenant = ?';
  const params: (string | number)[] = scope.isPlatformAdmin ? [] : [scope.tenant];

  const rows = db.prepare(`
    SELECT
      u.id as operatorUserId,
      COALESCE(u.name, '未绑定员工') as operatorName,
      ra.tenant,
      COUNT(DISTINCT ra.id) as accountCount,
      COUNT(DISTINCT CASE WHEN datetime(l.created_at) >= ${periodStart} THEN l.id END) as newLeads,
      COUNT(DISTINCT CASE WHEN datetime(l.created_at) >= ${periodStart} AND l.intent = 'high' THEN l.id END) as highIntentLeads,
      COUNT(DISTINCT CASE WHEN datetime(d.signed_at) >= ${periodStart} THEN d.id END) as deals,
      COALESCE(SUM(CASE WHEN datetime(d.signed_at) >= ${periodStart} THEN d.commission_amount END), 0) as commissionFen,
      COALESCE(SUM(CASE WHEN datetime(d.signed_at) >= ${periodStart} THEN d.total_tuition END), 0) as tuitionFen
    FROM rpa_accounts ra
    LEFT JOIN users u ON u.id = ra.operator_user_id
    LEFT JOIN leads l ON l.source_account_id = ra.id
    LEFT JOIN deals d ON d.lead_id = l.id
    WHERE 1=1 ${tenantFilter}
    GROUP BY ra.operator_user_id, ra.tenant
    ORDER BY commissionFen DESC, newLeads DESC
    LIMIT 100
  `).all(...params) as Array<{
    operatorUserId: number | null;
    operatorName: string;
    tenant: string;
    accountCount: number;
    newLeads: number;
    highIntentLeads: number;
    deals: number;
    commissionFen: number;
    tuitionFen: number;
  }>;

  const ranking = rows.map((r) => ({
    operatorUserId: r.operatorUserId,
    operatorName: r.operatorName,
    tenant: r.tenant,
    accountCount: r.accountCount,
    newLeads: r.newLeads,
    highIntentLeads: r.highIntentLeads,
    deals: r.deals,
    commissionYuan: r.commissionFen / 100,
    tuitionYuan: r.tuitionFen / 100,
  }));

  res.json({
    success: true,
    data: {
      period: periodLabel,
      ranking,
    },
    error: null,
  });
});

rpaRouter.get('/messages', (req, res) => {
  const { accountId, processedStatus } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (typeof accountId === 'string' && accountId) {
    filters.push('account_id = ?');
    params.push(Number(accountId));
  }
  if (typeof processedStatus === 'string' && processedStatus) {
    filters.push('processed_status = ?');
    params.push(processedStatus);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, account_id as accountId, platform_msg_id as platformMsgId, sender_nickname as senderNickname,
           content, msg_type as msgType, fetched_at as fetchedAt, processed_status as processedStatus,
           lead_id as leadId
    FROM rpa_messages
    ${where}
    ORDER BY fetched_at DESC
    LIMIT 200
  `).all(...params);

  res.json({ success: true, data: rows, error: null });
});
