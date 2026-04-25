import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { getTenantScope, resolveTenantForWrite } from '../middleware/tenant';
import { MISSION_TEMPLATES, getMissionTemplate } from '../services/mission-templates';
import { enqueueJob } from '../../worker/job-queue';

type MissionRow = {
  id: number;
  tenant: string;
  type: string;
  title: string;
  goal_json: string;
  status: string;
  created_by: number | null;
  step_count: number;
  approval_count: number;
  last_error: string | null;
  summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type StepRow = {
  id: number;
  mission_id: number;
  step_index: number;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_args_json: string | null;
  tool_result_json: string | null;
  needs_approval: number;
  approved_by: number | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
};

const toMission = (row: MissionRow) => ({
  id: row.id,
  tenant: row.tenant,
  type: row.type,
  title: row.title,
  goal: JSON.parse(row.goal_json || '{}'),
  status: row.status,
  createdBy: row.created_by,
  stepCount: row.step_count,
  approvalCount: row.approval_count,
  lastError: row.last_error,
  summary: row.summary,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toStep = (row: StepRow) => ({
  id: row.id,
  missionId: row.mission_id,
  stepIndex: row.step_index,
  role: row.role,
  content: row.content,
  toolName: row.tool_name,
  toolArgs: row.tool_args_json ? JSON.parse(row.tool_args_json) : null,
  toolResult: row.tool_result_json ? JSON.parse(row.tool_result_json) : null,
  needsApproval: row.needs_approval === 1,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  rejectedReason: row.rejected_reason,
  createdAt: row.created_at,
});

export const missionsRouter = Router();

missionsRouter.use(requireAuth);

missionsRouter.get('/templates', (_req, res) => {
  res.json({ success: true, data: MISSION_TEMPLATES, error: null });
});

// 一键启动：用模板默认参数创建并执行，不需要填 JSON
missionsRouter.post('/quick-start', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const body = req.body as { type?: string };
  const template = body.type ? getMissionTemplate(body.type) : undefined;
  if (!template) {
    return res.status(400).json({ success: false, data: null, error: `未知任务类型 ${body.type}` });
  }

  const scope = getTenantScope(req);
  const tenant = resolveTenantForWrite(scope);

  // v3.3.a · daily_briefing 特殊路径：不走 agent runtime，直接入 briefing 推送队列
  if (template.type === 'daily_briefing') {
    const dateStr = new Date().toISOString().slice(0, 10);
    enqueueJob({
      name: 'agent.daily_briefing_push',
      payload: { tenant },
      maxAttempts: 2,
      singletonKey: `briefing-push:${tenant}:${dateStr}:manual`,
    });
    return res.status(202).json({
      success: true,
      data: { type: template.type, title: template.title, async: true, note: '已加入队列，几秒后 HomePanel 刷新即可看到' },
      error: null,
    });
  }

  const result = db.prepare(`
    INSERT INTO agent_missions (tenant, type, title, goal_json, status, created_by, step_count, approval_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, datetime('now'), datetime('now'))
  `).run(tenant, template.type, template.title, JSON.stringify(template.defaultGoal), req.user!.sub);

  const missionId = Number(result.lastInsertRowid);
  enqueueJob({
    name: 'agent.run_mission',
    payload: { missionId },
    maxAttempts: 3, // v3.4.c · 智能重试
    singletonKey: `mission:${missionId}`,
  });

  res.status(201).json({ success: true, data: { missionId, type: template.type, title: template.title }, error: null });
});

missionsRouter.get('/', (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const { status, limit } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (!scope.isPlatformAdmin) {
    filters.push('tenant = ?');
    params.push(scope.tenant);
  }
  if (typeof status === 'string' && status) {
    filters.push('status = ?');
    params.push(status);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const cap = Math.min(Math.max(1, Number(limit) || 50), 200);

  const rows = db.prepare(`
    SELECT * FROM agent_missions ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, cap) as MissionRow[];

  res.json({ success: true, data: rows.map(toMission), error: null });
});

missionsRouter.post('/', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const body = req.body as { type?: string; title?: string; goal?: Record<string, unknown> };
  if (!body.type) {
    return res.status(400).json({ success: false, data: null, error: 'type 必填' });
  }

  const template = getMissionTemplate(body.type);
  if (!template) {
    return res.status(400).json({ success: false, data: null, error: `未知任务类型 ${body.type}，请使用 /api/missions/templates 查看可用类型` });
  }

  const scope = getTenantScope(req);
  const tenant = resolveTenantForWrite(scope);
  const title = body.title?.trim() || template.title;
  const goal = body.goal && typeof body.goal === 'object' ? { ...template.defaultGoal, ...body.goal } : template.defaultGoal;

  const result = db.prepare(`
    INSERT INTO agent_missions (tenant, type, title, goal_json, status, created_by, step_count, approval_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, datetime('now'), datetime('now'))
  `).run(tenant, body.type, title, JSON.stringify(goal), req.user!.sub);

  const missionId = Number(result.lastInsertRowid);

  enqueueJob({
    name: 'agent.run_mission',
    payload: { missionId },
    maxAttempts: 3, // v3.4.c · 智能重试
    singletonKey: `mission:${missionId}`,
  });

  const created = db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(missionId) as MissionRow;
  res.status(201).json({ success: true, data: toMission(created), error: null });
});

// ============== 定时计划（方案 B）==============

type ScheduleRow = {
  id: number;
  tenant: string;
  mission_type: string;
  cron_hour: number;
  cron_weekday: string | null;
  enabled: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};

const toSchedule = (row: ScheduleRow) => ({
  id: row.id,
  tenant: row.tenant,
  missionType: row.mission_type,
  cronHour: row.cron_hour,
  cronWeekday: row.cron_weekday,
  enabled: row.enabled === 1,
  lastTriggeredAt: row.last_triggered_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

missionsRouter.get('/schedules/list', (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const rows = scope.isPlatformAdmin
    ? db.prepare(`SELECT * FROM agent_schedule_configs ORDER BY id ASC`).all() as ScheduleRow[]
    : db.prepare(`SELECT * FROM agent_schedule_configs WHERE tenant = ? ORDER BY id ASC`).all(scope.tenant) as ScheduleRow[];

  res.json({ success: true, data: rows.map(toSchedule), error: null });
});

missionsRouter.patch('/schedules/:id', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const row = db.prepare(`SELECT * FROM agent_schedule_configs WHERE id = ?`).get(req.params.id) as ScheduleRow | undefined;
  if (!row) return res.status(404).json({ success: false, data: null, error: '配置不存在' });
  if (!scope.isPlatformAdmin && row.tenant !== scope.tenant) {
    return res.status(404).json({ success: false, data: null, error: '配置不存在' });
  }

  const body = req.body as { enabled?: boolean; cronHour?: number; cronWeekday?: string | null };

  if (body.cronHour !== undefined && (!Number.isInteger(body.cronHour) || body.cronHour < 0 || body.cronHour > 23)) {
    return res.status(400).json({ success: false, data: null, error: 'cronHour 必须为 0-23 整数' });
  }
  if (body.cronWeekday !== undefined && body.cronWeekday !== null) {
    const valid = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    if (!valid.includes(body.cronWeekday)) {
      return res.status(400).json({ success: false, data: null, error: `cronWeekday 必须为 ${valid.join(' / ')} 之一` });
    }
  }

  db.prepare(`
    UPDATE agent_schedule_configs
    SET enabled = ?, cron_hour = ?, cron_weekday = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    body.enabled === undefined ? row.enabled : (body.enabled ? 1 : 0),
    body.cronHour ?? row.cron_hour,
    body.cronWeekday === undefined ? row.cron_weekday : body.cronWeekday,
    req.params.id
  );

  const updated = db.prepare(`SELECT * FROM agent_schedule_configs WHERE id = ?`).get(req.params.id) as ScheduleRow;
  res.json({ success: true, data: toSchedule(updated), error: null });
});

missionsRouter.get('/:id', (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const row = db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(req.params.id) as MissionRow | undefined;
  if (!row) return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  if (!scope.isPlatformAdmin && row.tenant !== scope.tenant) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }
  res.json({ success: true, data: toMission(row), error: null });
});

missionsRouter.get('/:id/steps', (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const mission = db.prepare(`SELECT tenant FROM agent_missions WHERE id = ?`).get(req.params.id) as { tenant: string } | undefined;
  if (!mission || (!scope.isPlatformAdmin && mission.tenant !== scope.tenant)) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }

  const steps = db.prepare(`
    SELECT * FROM agent_steps WHERE mission_id = ?
    ORDER BY step_index ASC
  `).all(req.params.id) as StepRow[];
  res.json({ success: true, data: steps.map(toStep), error: null });
});

missionsRouter.post('/:id/approve', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const mission = db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(req.params.id) as MissionRow | undefined;
  if (!mission || (!scope.isPlatformAdmin && mission.tenant !== scope.tenant)) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }
  if (mission.status !== 'waiting_approval') {
    return res.status(400).json({ success: false, data: null, error: `当前状态 ${mission.status} 不需要审批` });
  }

  // 找到最新的 waiting step
  const pendingStep = db.prepare(`
    SELECT * FROM agent_steps
    WHERE mission_id = ? AND role = 'tool_call' AND needs_approval = 1 AND approved_at IS NULL AND rejected_reason IS NULL
    ORDER BY step_index DESC
    LIMIT 1
  `).get(mission.id) as StepRow | undefined;

  if (!pendingStep) {
    return res.status(400).json({ success: false, data: null, error: '没有可审批的步骤' });
  }

  db.prepare(`UPDATE agent_steps SET approved_by = ?, approved_at = datetime('now') WHERE id = ?`).run(req.user!.sub, pendingStep.id);
  db.prepare(`UPDATE agent_missions SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(mission.id);

  // 异步执行被审批的 tool
  enqueueJob({
    name: 'agent.execute_approved_step',
    payload: { missionId: mission.id, stepId: pendingStep.id },
    maxAttempts: 1,
    singletonKey: `mission-approve:${mission.id}:${pendingStep.id}`,
  });

  res.json({ success: true, data: { missionId: mission.id, stepId: pendingStep.id }, error: null });
});

missionsRouter.post('/:id/reject', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const mission = db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(req.params.id) as MissionRow | undefined;
  if (!mission || (!scope.isPlatformAdmin && mission.tenant !== scope.tenant)) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }
  const body = req.body as { reason?: string };
  const reason = (body.reason || '审批拒绝').trim().slice(0, 500);

  const pendingStep = db.prepare(`
    SELECT * FROM agent_steps
    WHERE mission_id = ? AND role = 'tool_call' AND needs_approval = 1 AND approved_at IS NULL AND rejected_reason IS NULL
    ORDER BY step_index DESC
    LIMIT 1
  `).get(mission.id) as StepRow | undefined;

  if (pendingStep) {
    db.prepare(`UPDATE agent_steps SET rejected_reason = ? WHERE id = ?`).run(reason, pendingStep.id);
  }

  db.prepare(`UPDATE agent_missions SET status = 'canceled', summary = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(`管理员拒绝审批：${reason}`, mission.id);

  res.json({ success: true, data: { canceled: true }, error: null });
});

missionsRouter.post('/:id/cancel', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const mission = db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(req.params.id) as MissionRow | undefined;
  if (!mission || (!scope.isPlatformAdmin && mission.tenant !== scope.tenant)) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }
  if (mission.status === 'succeeded' || mission.status === 'failed' || mission.status === 'canceled') {
    return res.json({ success: true, data: toMission(mission), error: null });
  }

  db.prepare(`UPDATE agent_missions SET status = 'canceled', summary = '手动取消', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(mission.id);
  res.json({ success: true, data: { canceled: true }, error: null });
});

// v3.5.c · 失败 mission 列表（按 last_error 聚合 + 单条重试 + 批量重试 + 关闭）
missionsRouter.get('/failed/list', (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const where = scope.isPlatformAdmin ? '' : `AND tenant = '${scope.tenant.replace(/'/g, "''")}'`;

  type FailedRow = {
    id: number; tenant: string; type: string; title: string; status: string;
    last_error: string | null; finished_at: string | null; created_at: string;
    step_count: number;
  };
  const rows = db.prepare(`
    SELECT id, tenant, type, title, status, last_error, finished_at, created_at, step_count
    FROM agent_missions
    WHERE status = 'failed' ${where}
    ORDER BY finished_at DESC, id DESC
    LIMIT ?
  `).all(limit) as FailedRow[];

  // 按 last_error 前 60 字聚合
  const buckets = new Map<string, { sample: string; count: number; missionIds: number[] }>();
  for (const r of rows) {
    const key = (r.last_error ?? '未知错误').slice(0, 60);
    const bucket = buckets.get(key) ?? { sample: r.last_error ?? '未知错误', count: 0, missionIds: [] };
    bucket.count += 1;
    if (bucket.missionIds.length < 20) bucket.missionIds.push(r.id);
    buckets.set(key, bucket);
  }

  const errorBuckets = Array.from(buckets.entries()).map(([key, v]) => ({
    errorKey: key,
    errorSample: v.sample,
    count: v.count,
    missionIds: v.missionIds,
  })).sort((a, b) => b.count - a.count);

  res.json({
    success: true,
    data: {
      missions: rows.map((r) => ({
        id: r.id,
        tenant: r.tenant,
        type: r.type,
        title: r.title,
        status: r.status,
        lastError: r.last_error,
        finishedAt: r.finished_at,
        createdAt: r.created_at,
        stepCount: r.step_count,
      })),
      errorBuckets,
    },
    error: null,
  });
});

missionsRouter.post('/:id/retry', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const mission = db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(req.params.id) as MissionRow | undefined;
  if (!mission || (!scope.isPlatformAdmin && mission.tenant !== scope.tenant)) {
    return res.status(404).json({ success: false, data: null, error: '任务不存在' });
  }
  if (mission.status !== 'failed') {
    return res.status(400).json({ success: false, data: null, error: '仅失败的任务可重试' });
  }

  // 重置 mission 到 queued + 清掉 last_error
  db.prepare(`
    UPDATE agent_missions
    SET status = 'queued', last_error = NULL, finished_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(mission.id);

  enqueueJob({
    name: 'agent.run_mission',
    payload: { missionId: mission.id },
    maxAttempts: 3,
    singletonKey: `mission-retry:${mission.id}:${Date.now()}`,
  });

  res.json({ success: true, data: { missionId: mission.id, retried: true }, error: null });
});

missionsRouter.post('/failed/batch-retry', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const body = req.body as { missionIds?: number[] } | undefined;
  const ids = Array.isArray(body?.missionIds) ? body!.missionIds.filter((x) => Number.isFinite(x)).slice(0, 100) : [];
  if (ids.length === 0) {
    return res.status(400).json({ success: false, data: null, error: 'missionIds 必填' });
  }

  const placeholders = ids.map(() => '?').join(',');
  type Row = { id: number; tenant: string; status: string };
  const targets = db.prepare(
    `SELECT id, tenant, status FROM agent_missions WHERE id IN (${placeholders})`
  ).all(...ids) as Row[];

  const eligible = targets.filter((r) =>
    r.status === 'failed' && (scope.isPlatformAdmin || r.tenant === scope.tenant)
  );

  let retried = 0;
  for (const target of eligible) {
    db.prepare(`
      UPDATE agent_missions
      SET status = 'queued', last_error = NULL, finished_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(target.id);

    enqueueJob({
      name: 'agent.run_mission',
      payload: { missionId: target.id },
      maxAttempts: 3,
      singletonKey: `mission-retry:${target.id}:${Date.now()}`,
    });
    retried += 1;
  }

  res.json({ success: true, data: { retried, requested: ids.length, skipped: ids.length - retried }, error: null });
});

missionsRouter.post('/failed/batch-dismiss', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const body = req.body as { missionIds?: number[] } | undefined;
  const ids = Array.isArray(body?.missionIds) ? body!.missionIds.filter((x) => Number.isFinite(x)).slice(0, 200) : [];
  if (ids.length === 0) {
    return res.status(400).json({ success: false, data: null, error: 'missionIds 必填' });
  }

  const placeholders = ids.map(() => '?').join(',');
  type Row = { id: number; tenant: string; status: string };
  const targets = db.prepare(
    `SELECT id, tenant, status FROM agent_missions WHERE id IN (${placeholders})`
  ).all(...ids) as Row[];

  const eligible = targets.filter((r) =>
    r.status === 'failed' && (scope.isPlatformAdmin || r.tenant === scope.tenant)
  );

  let dismissed = 0;
  for (const target of eligible) {
    db.prepare(`
      UPDATE agent_missions
      SET status = 'canceled', summary = '失败后人工关闭', updated_at = datetime('now')
      WHERE id = ?
    `).run(target.id);
    dismissed += 1;
  }

  res.json({ success: true, data: { dismissed, requested: ids.length }, error: null });
});
