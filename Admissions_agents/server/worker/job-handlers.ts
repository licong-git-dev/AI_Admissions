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
import {
  generateValueStatement,
  listTenantsWithActivity,
  markStatementPushed,
  previousMonthPeriod,
} from '../src/services/value-statement-generator';

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
      maxAttempts: 3, // v3.4.c · 智能重试：transient 错误退避重试，permanent 立即失败
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

// ============== v3.3.b 月度价值账单 ==============

registerJobHandler('value_statement.push_one', async (payload: Record<string, unknown>) => {
  const tenant = typeof payload.tenant === 'string' ? payload.tenant : 'default';
  const period = typeof payload.period === 'string' ? payload.period : previousMonthPeriod();

  let statement;
  try {
    statement = await generateValueStatement(tenant, period);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('value_statement', '生成月度账单失败', { tenant, period, error: msg });
    return { tenant, period, error: msg };
  }

  type AdminRow = { wechat_work_userid: string };
  const admins = db.prepare(
    `SELECT wechat_work_userid FROM users
     WHERE tenant = ? AND role IN ('admin', 'tenant_admin')
       AND wechat_work_userid IS NOT NULL AND is_active = 1`
  ).all(tenant) as AdminRow[];

  const tuitionYuan = Math.round(statement.tuitionTotalFen / 100);
  const commissionYuan = Math.round(statement.commissionTotalFen / 100);
  const text = `【月度价值账单 · ${period}】\n续费健康分：${statement.healthScore} / 100（${statement.healthGrade} 级）\n本月营收 ${tuitionYuan} 元，平台分成 ${commissionYuan} 元\n\n${statement.narrative}`;

  let delivered = 0;
  let stubbed = 0;
  for (const admin of admins) {
    try {
      const result = await sendTextMessageToUser({ toUser: admin.wechat_work_userid, content: text });
      if (result.stub) stubbed += 1;
      else if (result.success) delivered += 1;
    } catch (error) {
      logger.warn('value_statement', '推送失败但继续', { tenant, userId: admin.wechat_work_userid, error: String(error) });
    }
  }

  markStatementPushed(tenant, period);
  logger.info('value_statement', '月度账单推送完成', {
    tenant, period, adminCount: admins.length, delivered, stubbed, healthScore: statement.healthScore,
  });

  return { tenant, period, delivered, stubbed, healthScore: statement.healthScore };
});

// 月初 1 号 09:00 触发：为每个活跃租户生成 + 推送上月账单
registerJobHandler('value_statement.monthly_tick', async () => {
  const now = new Date();
  const isFirstOfMonth = now.getDate() === 1;
  const isNineAM = now.getHours() === 9;
  if (!isFirstOfMonth || !isNineAM) {
    return { skipped: true, reason: 'not first day at 9am', date: now.getDate(), hour: now.getHours() };
  }

  const period = previousMonthPeriod(now);
  const tenants = listTenantsWithActivity();
  const enqueued: string[] = [];

  for (const tenant of tenants) {
    enqueueJob({
      name: 'value_statement.push_one',
      payload: { tenant, period },
      maxAttempts: 2,
      singletonKey: `value-statement:${tenant}:${period}`,
    });
    enqueued.push(tenant);
  }

  logger.info('value_statement', '月度账单 tick 入队', { period, tenants: enqueued.length });
  return { period, enqueued: enqueued.length };
});

// ============== v3.4.b 续费临界自动干预 ==============

const RENEWAL_HEALTH_THRESHOLD = 55; // 健康分 < 55 即触发干预

registerJobHandler('renewal.push_intervention', async (payload: Record<string, unknown>) => {
  const tenant = typeof payload.tenant === 'string' ? payload.tenant : 'default';
  const period = typeof payload.period === 'string' ? payload.period : previousMonthPeriod();

  // 拉最新账单获取健康分细节
  type StatementRow = {
    health_score: number;
    health_grade: string;
    leads_total: number;
    deals_count: number;
    ai_missions_succeeded: number;
    breakdown_json: string;
  };
  const stmt = db.prepare(
    `SELECT health_score, health_grade, leads_total, deals_count, ai_missions_succeeded, breakdown_json
     FROM monthly_value_statements WHERE tenant = ? AND period = ?`
  ).get(tenant, period) as StatementRow | undefined;

  if (!stmt) {
    return { tenant, period, skipped: 'no_statement' };
  }
  if (stmt.health_score >= RENEWAL_HEALTH_THRESHOLD) {
    return { tenant, period, skipped: 'healthy', score: stmt.health_score };
  }

  // 找到该租户的 admin 用户（有企微 userid 的）
  type AdminRow = { wechat_work_userid: string };
  const admins = db.prepare(
    `SELECT wechat_work_userid FROM users
     WHERE tenant = ? AND role IN ('admin', 'tenant_admin')
       AND wechat_work_userid IS NOT NULL AND is_active = 1`
  ).all(tenant) as AdminRow[];

  // 根据健康分细分诊断 + 给具体 3 条建议
  const breakdown = JSON.parse(stmt.breakdown_json) as {
    healthBreakdown?: { leadGrowthRate: number; conversionRate: number; aiEngagementScore: number; activeDaysScore: number };
  };
  const hb = breakdown.healthBreakdown ?? { leadGrowthRate: 0, conversionRate: 0, aiEngagementScore: 0, activeDaysScore: 0 };
  const advice: string[] = [];
  if (hb.aiEngagementScore < 40) {
    advice.push('① AI 员工调用太少，建议把每日内容冲刺定时任务打开（AI 员工 → 定时自动化）');
  }
  if (hb.conversionRate < 3) {
    advice.push('② 线索→成交转化率偏低，建议让 AI 扫一遍高意向线索 → 给专员推话术');
  }
  if (hb.activeDaysScore < 15) {
    advice.push('③ 本月活跃天数太少，建议至少每天登录一次审核 AI 内容（5 分钟）');
  }
  if (hb.leadGrowthRate < -20) {
    advice.push('④ 线索环比下滑严重，建议查一下 RPA 账号是否被封或 H5 测评是否在投放');
  }
  if (advice.length === 0) {
    advice.push('① 各项指标都偏低，建议先把每日内容冲刺 + 高意向跟进两个定时任务打开');
  }

  const text = [
    `【客户成功提醒 · ${period}】`,
    `老板，我是小报。我看了下你这月的续费健康分：${stmt.health_score} / 100（${stmt.health_grade} 级）。`,
    `按这个状态再不动手，下个续费周期可能就要重新评估合作了。`,
    ``,
    `我帮你拆了下，三个关键改进点：`,
    ...advice.slice(0, 3),
    ``,
    `要不抽 5 分钟登录系统看看？我等你。`,
  ].join('\n');

  let delivered = 0;
  let stubbed = 0;
  for (const admin of admins) {
    try {
      const result = await sendTextMessageToUser({ toUser: admin.wechat_work_userid, content: text });
      if (result.stub) stubbed += 1;
      else if (result.success) delivered += 1;
    } catch (error) {
      logger.warn('renewal', '推送失败但继续', { tenant, userId: admin.wechat_work_userid, error: String(error) });
    }
  }

  logger.info('renewal', '续费干预推送完成', {
    tenant, period, score: stmt.health_score, grade: stmt.health_grade, delivered, stubbed, adminCount: admins.length,
  });
  return { tenant, period, score: stmt.health_score, delivered, stubbed };
});

// 月中 15 号 09:00 触发：扫所有租户的最新账单，对 health_score < 阈值的入队推送
registerJobHandler('renewal.health_check_tick', async () => {
  const now = new Date();
  const isFifteenth = now.getDate() === 15;
  const isNineAM = now.getHours() === 9;
  if (!isFifteenth || !isNineAM) {
    return { skipped: true, reason: 'not 15th at 9am', date: now.getDate(), hour: now.getHours() };
  }

  // 拿每个租户最新一份账单
  type LatestRow = { tenant: string; period: string; health_score: number };
  const latest = db.prepare(`
    SELECT m.tenant, m.period, m.health_score
    FROM monthly_value_statements m
    INNER JOIN (
      SELECT tenant, MAX(period) as max_period
      FROM monthly_value_statements
      GROUP BY tenant
    ) latest_p ON latest_p.tenant = m.tenant AND latest_p.max_period = m.period
  `).all() as LatestRow[];

  let triggered = 0;
  for (const row of latest) {
    if (row.health_score >= RENEWAL_HEALTH_THRESHOLD) continue;
    enqueueJob({
      name: 'renewal.push_intervention',
      payload: { tenant: row.tenant, period: row.period },
      maxAttempts: 2,
      singletonKey: `renewal-intervention:${row.tenant}:${row.period}`,
    });
    triggered += 1;
  }

  logger.info('renewal', '续费健康巡检完成', { tenantsChecked: latest.length, triggered });
  return { tenantsChecked: latest.length, triggered };
});

// ============== v3.7.a 数据飞轮 ==============

registerJobHandler('best_practice.mining_tick', async () => {
  const now = new Date();
  // 每周一 03:00 跑（UTC+8 时区下）
  const isMonday = now.getDay() === 1;
  const isThreeAM = now.getHours() === 3;
  if (!isMonday || !isThreeAM) {
    return { skipped: true, reason: 'not Mon 3am', day: now.getDay(), hour: now.getHours() };
  }

  const { runBestPracticeMining } = await import('../src/services/best-practice-miner');
  const result = runBestPracticeMining();
  logger.info('best_practice', '数据飞轮挖掘完成', result);
  return result;
});

// ============== v3.7.b 沉默学员预警 ==============

const SILENCE_THRESHOLD_DAYS = 60;

registerJobHandler('student_silence.alert_tick', async () => {
  const now = new Date();
  // 每天 09:00 扫一次
  if (now.getHours() !== 9) {
    return { skipped: true, reason: 'not 9am', hour: now.getHours() };
  }

  // 找已成交但 60+ 天没有任何活动（无 followup / 无 portal 登录）的学员
  type SilentRow = { id: number; nickname: string; tenant: string; assignee: string | null; last_activity: string };
  const rows = db.prepare(`
    SELECT
      l.id, l.nickname, l.tenant, l.assignee,
      COALESCE(
        (SELECT MAX(created_at) FROM followups WHERE lead_id = l.id),
        l.updated_at
      ) as last_activity
    FROM leads l
    WHERE l.status = 'enrolled'
      AND datetime(COALESCE(
        (SELECT MAX(created_at) FROM followups WHERE lead_id = l.id),
        l.updated_at
      )) < datetime('now', '-' || ? || ' days')
    LIMIT 200
  `).all(SILENCE_THRESHOLD_DAYS) as SilentRow[];

  if (rows.length === 0) {
    return { silentStudents: 0, alerted: 0 };
  }

  // 按租户分组，每个租户一条聚合提醒
  const byTenant = new Map<string, SilentRow[]>();
  for (const row of rows) {
    const arr = byTenant.get(row.tenant) ?? [];
    arr.push(row);
    byTenant.set(row.tenant, arr);
  }

  let alerted = 0;
  for (const [tenant, students] of byTenant) {
    // 找该租户的 admin
    type AdminRow = { wechat_work_userid: string };
    const admins = db.prepare(
      `SELECT wechat_work_userid FROM users
       WHERE tenant = ? AND role IN ('admin', 'tenant_admin')
         AND wechat_work_userid IS NOT NULL AND is_active = 1`
    ).all(tenant) as AdminRow[];

    if (admins.length === 0) continue;

    const list = students.slice(0, 10).map((s) => {
      const days = Math.floor((Date.now() - new Date(s.last_activity).getTime()) / (24 * 60 * 60 * 1000));
      return `· ${s.nickname}（${days} 天无动静${s.assignee ? '，对接 ' + s.assignee : ''}）`;
    }).join('\n');

    const text = [
      `【沉默学员预警】（小报）`,
      `老板，扫描发现 ${students.length} 个已成交学员超过 ${SILENCE_THRESHOLD_DAYS} 天无任何动静，先抽查前 ${Math.min(10, students.length)} 个：`,
      ``,
      list,
      ``,
      `沉默 = 流失风险 + 退费风险 + 推荐意愿归零，建议让顾问主动联系一遍。`,
    ].join('\n');

    for (const admin of admins) {
      try {
        await sendTextMessageToUser({ toUser: admin.wechat_work_userid, content: text });
      } catch {
        // ignore individual failures
      }
    }
    alerted += 1;
  }

  logger.info('silence', '沉默学员预警发送完成', { silentStudents: rows.length, alerted });
  return { silentStudents: rows.length, alerted };
});

// ============== Agent 数字员工 ==============

registerJobHandler('agent.run_mission', async (payload: Record<string, unknown>, ctx: { jobId: number; attempt: number }) => {
  const missionId = typeof payload.missionId === 'number' ? payload.missionId : null;
  if (!missionId) return { error: 'missionId 缺失' };
  try {
    await runAgentMission(missionId);
    return { missionId, done: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // v3.4.c · 智能重试：transient 错误抛出让 job-queue 退避重试，permanent 立即标失败
    const { classifyError } = await import('./error-classifier');
    const category = classifyError(msg);

    if (category === 'transient') {
      logger.warn('agent', 'run_mission 临时性失败，将由 job-queue 退避重试', {
        missionId, attempt: ctx.attempt, error: msg,
      });
      // 临时性：mission 保持 running 状态，向上抛 → job-queue 计算下次重试时间
      throw error;
    }

    // permanent：立即标 failed，不重试
    logger.error('agent', 'run_mission 永久性失败', { missionId, error: msg });
    db.prepare(`UPDATE agent_missions SET status = 'failed', last_error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(msg, missionId);
    return { missionId, error: msg, classified: 'permanent' };
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
  { name: 'value_statement.monthly_tick', intervalMs: 60 * 60 * 1000, maxAttempts: 1 },
  { name: 'renewal.health_check_tick', intervalMs: 60 * 60 * 1000, maxAttempts: 1 },
  { name: 'best_practice.mining_tick', intervalMs: 60 * 60 * 1000, maxAttempts: 1 },
  { name: 'student_silence.alert_tick', intervalMs: 60 * 60 * 1000, maxAttempts: 1 },
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
