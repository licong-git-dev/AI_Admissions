import { registerJobHandler, enqueueJob } from './job-queue';
import { scheduleFetchDmTasks } from './runner';
import { runCrawlOnce } from './crawler';
import { runHealthCheckOnce } from './health-check';
import { cleanupIdleContexts } from './browser-manager';
import { db } from '../src/db';
import { logger } from './logger';
import { sendTextMessageToUser } from '../src/services/wechat-work';
import { runAgentMission, resumeAgentMission } from './agent-runtime';
import { getToolByName, isTerminal } from '../src/services/agent-tools';
import { generateBriefing, markBriefingPushed } from '../src/services/briefing-generator';

// ============== Handlers ==============

registerJobHandler('schedule.fetch_dm', async () => {
  scheduleFetchDmTasks();
  return { scheduled: true };
});

registerJobHandler('crawler.run_once', async () => {
  const result = await runCrawlOnce();
  return result;
});

registerJobHandler('rpa.health_check', async () => {
  const result = await runHealthCheckOnce();
  return result;
});

registerJobHandler('browser.cleanup_idle', async () => {
  await cleanupIdleContexts();
  return { cleaned: true };
});

registerJobHandler('audit.cleanup', async (payload: Record<string, unknown>) => {
  const days = typeof payload.retainDays === 'number' ? payload.retainDays : 60;
  const result = db.prepare(
    `DELETE FROM audit_logs WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')`
  ).run(days);
  logger.info('jobs', 'audit_logs 清理完成', { deleted: result.changes });
  return { deleted: result.changes };
});

registerJobHandler('jobs.cleanup', async (payload: Record<string, unknown>) => {
  const days = typeof payload.retainDays === 'number' ? payload.retainDays : 7;
  const result = db.prepare(
    `DELETE FROM jobs WHERE status IN ('succeeded', 'failed') AND datetime(finished_at) < datetime('now', '-' || ? || ' days')`
  ).run(days);
  return { deleted: result.changes };
});

// ============== Agent 数字员工 · 定时计划（方案 B）==============

type ScheduleConfig = {
  id: number;
  tenant: string;
  mission_type: string;
  cron_hour: number;
  cron_weekday: string | null;
  enabled: number;
  last_triggered_at: string | null;
};

const WEEKDAY_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

registerJobHandler('agent.daily_schedule_tick', async () => {
  const configs = db.prepare(`
    SELECT id, tenant, mission_type, cron_hour, cron_weekday, enabled, last_triggered_at
    FROM agent_schedule_configs
    WHERE enabled = 1
  `).all() as ScheduleConfig[];

  const now = new Date();
  const currentHour = now.getHours();
  const currentWeekday = now.getDay();

  let triggered = 0;

  for (const cfg of configs) {
    // 小时匹配
    if (cfg.cron_hour !== currentHour) continue;

    // 周几匹配（如果配置了）
    if (cfg.cron_weekday) {
      const expected = WEEKDAY_MAP[cfg.cron_weekday.toLowerCase()];
      if (expected !== currentWeekday) continue;
    }

    // 同一小时内不重复触发
    if (cfg.last_triggered_at) {
      const last = new Date(cfg.last_triggered_at);
      if (last.getFullYear() === now.getFullYear() &&
          last.getMonth() === now.getMonth() &&
          last.getDate() === now.getDate() &&
          last.getHours() === now.getHours()) {
        continue;
      }
    }

    // 模板存在性校验
    const { getMissionTemplate } = await import('../src/services/mission-templates');
    const template = getMissionTemplate(cfg.mission_type);
    if (!template) {
      logger.warn('schedule', '未知 mission_type 跳过', { configId: cfg.id, type: cfg.mission_type });
      continue;
    }

    // 特殊类型：daily_briefing 走独立处理路径（不经过 agent runtime）
    if (cfg.mission_type === 'daily_briefing') {
      const dateStr = now.toISOString().slice(0, 10);
      enqueueJob({
        name: 'agent.daily_briefing_push',
        payload: { tenant: cfg.tenant },
        maxAttempts: 2,
        singletonKey: `briefing-push:${cfg.tenant}:${dateStr}`,
      });
      db.prepare(`UPDATE agent_schedule_configs SET last_triggered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(cfg.id);
      logger.info('schedule', '定时触发 daily_briefing', { configId: cfg.id, tenant: cfg.tenant });
      triggered += 1;
      continue;
    }

    // 创建 mission
    const result = db.prepare(`
      INSERT INTO agent_missions (tenant, type, title, goal_json, status, created_by, step_count, approval_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', NULL, 0, 0, datetime('now'), datetime('now'))
    `).run(cfg.tenant, cfg.mission_type, `[定时] ${template.title}`, JSON.stringify(template.defaultGoal));

    const missionId = Number(result.lastInsertRowid);
    enqueueJob({
      name: 'agent.run_mission',
      payload: { missionId },
      maxAttempts: 1,
      singletonKey: `mission:${missionId}`,
    });

    db.prepare(`UPDATE agent_schedule_configs SET last_triggered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(cfg.id);
    logger.info('schedule', '定时触发 mission', { configId: cfg.id, missionId, type: cfg.mission_type, tenant: cfg.tenant });
    triggered += 1;
  }

  return { triggered, configsChecked: configs.length };
});

// ============== 今日战报生成 + 推送（v3.3.a）==============

registerJobHandler('agent.daily_briefing_push', async (payload: Record<string, unknown>) => {
  const tenant = typeof payload.tenant === 'string' ? payload.tenant : 'default';

  let briefing;
  try {
    briefing = await generateBriefing(tenant);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('briefing', '生成今日战报失败', { tenant, error: msg });
    return { tenant, error: msg };
  }

  // 推送给该租户的活跃管理员（有 wechat_work_userid 的）
  type AdminRow = { wechat_work_userid: string };
  const admins = db.prepare(
    `SELECT wechat_work_userid FROM users
     WHERE tenant = ? AND role IN ('admin', 'tenant_admin')
       AND wechat_work_userid IS NOT NULL AND is_active = 1`
  ).all(tenant) as AdminRow[];

  const text = `【今日战报 · ${briefing.date}】\n\n${briefing.narrative}`;
  let delivered = 0;
  let stubbed = 0;

  for (const admin of admins) {
    try {
      const result = await sendTextMessageToUser({
        toUser: admin.wechat_work_userid,
        content: text,
      });
      if (result.stub) stubbed += 1;
      else if (result.success) delivered += 1;
    } catch (error) {
      logger.warn('briefing', '推送失败但继续', { tenant, userId: admin.wechat_work_userid, error: String(error) });
    }
  }

  markBriefingPushed(tenant, briefing.date);
  logger.info('briefing', '今日战报推送完成', {
    tenant, adminCount: admins.length, delivered, stubbed, source: briefing.source,
  });

  return { tenant, date: briefing.date, delivered, stubbed, adminCount: admins.length, source: briefing.source };
});

// ============== Agent 数字员工 ==============

registerJobHandler('agent.run_mission', async (payload: Record<string, unknown>) => {
  const missionId = typeof payload.missionId === 'number' ? payload.missionId : null;
  if (!missionId) return { error: 'missionId 缺失' };
  try {
    await runAgentMission(missionId);
    return { missionId, done: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('agent', 'run_mission 异常', { missionId, error: msg });
    db.prepare(`UPDATE agent_missions SET status = 'failed', last_error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(msg, missionId);
    return { missionId, error: msg };
  }
});

registerJobHandler('agent.execute_approved_step', async (payload: Record<string, unknown>) => {
  const missionId = typeof payload.missionId === 'number' ? payload.missionId : null;
  const stepId = typeof payload.stepId === 'number' ? payload.stepId : null;
  if (!missionId || !stepId) return { error: 'missionId/stepId 缺失' };

  type StepRow = { id: number; mission_id: number; step_index: number; tool_name: string | null; tool_args_json: string | null };
  const step = db.prepare(`SELECT id, mission_id, step_index, tool_name, tool_args_json FROM agent_steps WHERE id = ?`).get(stepId) as StepRow | undefined;
  if (!step || !step.tool_name) return { error: 'step 不存在或缺 tool_name' };

  const tool = getToolByName(step.tool_name);
  if (!tool) {
    db.prepare(`UPDATE agent_missions SET status = 'failed', last_error = ?, finished_at = datetime('now') WHERE id = ?`).run(`未知工具 ${step.tool_name}`, missionId);
    return { error: 'unknown tool' };
  }

  const args = step.tool_args_json ? JSON.parse(step.tool_args_json) as Record<string, unknown> : {};
  type MissionRow = { id: number; tenant: string; created_by: number | null };
  const mission = db.prepare(`SELECT id, tenant, created_by FROM agent_missions WHERE id = ?`).get(missionId) as MissionRow | undefined;
  if (!mission) return { error: 'mission 不存在' };

  const userRow = mission.created_by
    ? db.prepare(`SELECT role, tenant FROM users WHERE id = ?`).get(mission.created_by) as { role: string; tenant: string } | undefined
    : undefined;
  const isPlatformAdmin = Boolean(userRow && userRow.role === 'admin' && userRow.tenant === 'platform');

  let result: unknown;
  try {
    result = await tool.handler(args, {
      tenant: mission.tenant,
      isPlatformAdmin,
      missionId: mission.id,
      createdByUserId: mission.created_by,
    });
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }

  const toolResultIndex = step.step_index + 1;
  db.prepare(`
    INSERT INTO agent_steps (mission_id, step_index, role, tool_name, tool_args_json, tool_result_json, needs_approval, created_at)
    VALUES (?, ?, 'tool_result', ?, ?, ?, 0, datetime('now'))
  `).run(missionId, toolResultIndex, step.tool_name, step.tool_args_json, JSON.stringify(result).slice(0, 8000));
  db.prepare(`UPDATE agent_missions SET step_count = ?, updated_at = datetime('now') WHERE id = ?`).run(toolResultIndex, missionId);

  // 如果是 terminal，mission 结束
  if (isTerminal(tool)) {
    const summary = (result as { summary?: string; reason?: string }).summary ?? (result as { reason?: string }).reason ?? '';
    const finalStatus = step.tool_name === 'finish_mission' ? 'succeeded' : 'canceled';
    db.prepare(`UPDATE agent_missions SET status = ?, summary = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(finalStatus, summary, missionId);
    return { missionId, done: true, terminal: true };
  }

  // 否则继续 runtime
  try {
    await resumeAgentMission(missionId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    db.prepare(`UPDATE agent_missions SET status = 'failed', last_error = ?, finished_at = datetime('now') WHERE id = ?`).run(msg, missionId);
  }
  return { missionId, resumed: true };
});

// 定金催付：延时作业，按天数递归入队
const REMINDER_SEQUENCE_DAYS = [1, 3, 7, 14];

const fallbackAdminsWithWechat = (): Array<{ name: string; userId: string }> => {
  return db.prepare(
    `SELECT name, wechat_work_userid as userId FROM users WHERE role IN ('admin', 'tenant_admin') AND wechat_work_userid IS NOT NULL`
  ).all() as Array<{ name: string; userId: string }>;
};

const resolveAssigneeWechat = (assigneeHint: string | null): string | null => {
  if (!assigneeHint) return null;
  const user = db.prepare(
    `SELECT wechat_work_userid FROM users WHERE username = ? OR name = ? LIMIT 1`
  ).get(assigneeHint, assigneeHint) as { wechat_work_userid: string | null } | undefined;
  return user?.wechat_work_userid ?? null;
};

registerJobHandler('deposit.remind_unpaid', async (payload: Record<string, unknown>) => {
  const phone = typeof payload.phone === 'string' ? payload.phone : '';
  const leadId = typeof payload.leadId === 'number' ? payload.leadId : null;
  const sequenceIndex = typeof payload.sequenceIndex === 'number' ? payload.sequenceIndex : 0;

  if (!phone) {
    return { skipped: 'missing phone' };
  }

  // 已支付：不再催付，不再入队下一轮
  const paid = db.prepare(
    `SELECT id FROM deposits WHERE phone = ? AND status = 'paid' LIMIT 1`
  ).get(phone) as { id: number } | undefined;
  if (paid) {
    return { skipped: 'already_paid', depositId: paid.id };
  }

  // 找到最新未支付订单（没有就当无订单，仍然提醒一次）
  const latestDeposit = db.prepare(
    `SELECT id, out_trade_no as outTradeNo, amount FROM deposits WHERE phone = ? ORDER BY id DESC LIMIT 1`
  ).get(phone) as { id: number; outTradeNo: string; amount: number } | undefined;

  const lead = leadId
    ? db.prepare(`SELECT id, nickname, source, assignee, tenant FROM leads WHERE id = ?`).get(leadId) as { id: number; nickname: string; source: string; assignee: string | null; tenant: string } | undefined
    : db.prepare(`SELECT id, nickname, source, assignee, tenant FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`).get(phone) as { id: number; nickname: string; source: string; assignee: string | null; tenant: string } | undefined;

  const dayLabel = REMINDER_SEQUENCE_DAYS[sequenceIndex] ?? (sequenceIndex + 1);
  const waitDays = sequenceIndex === 0 ? '1' : String(dayLabel);

  const text = [
    `【定金未支付提醒】（第 ${sequenceIndex + 1} 次）`,
    `学员：${lead?.nickname ?? '未绑定'}（${phone}）`,
    `来源：${lead?.source ?? '未知'}`,
    latestDeposit
      ? `未支付订单：${latestDeposit.outTradeNo} · ¥${(latestDeposit.amount / 100).toFixed(0)}`
      : '该学员尚未生成过定金订单，需主动跟进下单',
    `已等待 ${waitDays} 天未支付，请尽快跟进。`,
  ].join('\n');

  const assigneeUserId = resolveAssigneeWechat(lead?.assignee ?? null);
  let delivered = 0;
  let stubbed = 0;

  const tryDeliver = async (toUser: string) => {
    const result = await sendTextMessageToUser({ toUser, content: text }).catch(() => ({ success: false, stub: false }));
    if ((result as { stub?: boolean }).stub) stubbed += 1;
    else if (result.success) delivered += 1;
  };

  if (assigneeUserId) {
    await tryDeliver(assigneeUserId);
  } else {
    for (const admin of fallbackAdminsWithWechat()) {
      await tryDeliver(admin.userId);
    }
  }

  // 入队下一轮提醒（如果还有后续节点）
  const nextIndex = sequenceIndex + 1;
  if (nextIndex < REMINDER_SEQUENCE_DAYS.length) {
    const currentOffset = REMINDER_SEQUENCE_DAYS[sequenceIndex] ?? 1;
    const nextOffset = REMINDER_SEQUENCE_DAYS[nextIndex] ?? (currentOffset + 7);
    const delayDays = nextOffset - currentOffset;
    const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString();
    enqueueJob({
      name: 'deposit.remind_unpaid',
      payload: { phone, leadId: lead?.id ?? leadId, sequenceIndex: nextIndex },
      scheduledAt,
      singletonKey: `deposit-remind:${phone}:${nextIndex}`,
    });
  }

  logger.info('deposit-remind', '催付提醒已执行', {
    phone,
    sequenceIndex,
    delivered,
    stubbed,
    hasAssignee: Boolean(assigneeUserId),
  });

  return { phone, sequenceIndex, delivered, stubbed };
});

// ============== Cron-style 定时调度 ==============

type RecurringJob = {
  name: string;
  intervalMs: number;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
};

// fetch_dm 间隔：默认 5 分钟（竞品对标结论：成人教育 3-7 天转化窗口，首次响应必须 ≤ 5 分钟）
// 可通过 FETCH_DM_INTERVAL_MS 环境变量覆盖（1-60 分钟范围）
const clampMinutes = (envValue: string | undefined, defaultMin: number, minMin: number, maxMin: number): number => {
  const parsed = envValue ? Number(envValue) : NaN;
  if (!Number.isFinite(parsed) || parsed < minMin * 60 * 1000 || parsed > maxMin * 60 * 1000) {
    return defaultMin * 60 * 1000;
  }
  return parsed;
};

const FETCH_DM_INTERVAL_MS = clampMinutes(process.env.FETCH_DM_INTERVAL_MS, 5, 1, 60);
const CRAWLER_INTERVAL_MS = Number(process.env.CRAWLER_INTERVAL_MS) || 60 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = Number(process.env.RPA_HEALTH_CHECK_INTERVAL_MS) || 24 * 60 * 60 * 1000;

const RECURRING_JOBS: RecurringJob[] = [
  { name: 'schedule.fetch_dm', intervalMs: FETCH_DM_INTERVAL_MS },
  { name: 'crawler.run_once', intervalMs: CRAWLER_INTERVAL_MS },
  { name: 'rpa.health_check', intervalMs: HEALTH_CHECK_INTERVAL_MS },
  { name: 'browser.cleanup_idle', intervalMs: 5 * 60 * 1000, maxAttempts: 1 },
  { name: 'audit.cleanup', intervalMs: 24 * 60 * 60 * 1000, payload: { retainDays: 60 } },
  { name: 'jobs.cleanup', intervalMs: 24 * 60 * 60 * 1000, payload: { retainDays: 7 } },
  { name: 'agent.daily_schedule_tick', intervalMs: 5 * 60 * 1000, maxAttempts: 1 },
];

const lastEnqueuedAt = new Map<string, number>();

export const scheduleRecurringJobs = (): void => {
  const now = Date.now();

  for (const job of RECURRING_JOBS) {
    const last = lastEnqueuedAt.get(job.name) ?? 0;
    if (now - last < job.intervalMs) continue;

    enqueueJob({
      name: job.name,
      payload: job.payload,
      maxAttempts: job.maxAttempts ?? 3,
      singletonKey: `recurring:${job.name}`,
    });
    lastEnqueuedAt.set(job.name, now);
  }
};
