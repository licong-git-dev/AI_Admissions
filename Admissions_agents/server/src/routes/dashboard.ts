import { Router } from 'express';
import { db } from '../db';
import type { AuthedRequest } from '../middleware/auth';
import { generateBriefing, getLatestBriefing } from '../services/briefing-generator';
import { AGENT_PERSONAS } from '../services/agent-personas';

const dashboardRouter = Router();

type HomeRole = 'platform_admin' | 'tenant_admin' | 'specialist';

const resolveHomeRole = (req: AuthedRequest): HomeRole => {
  const user = req.user;
  if (!user) return 'specialist';
  if (user.role === 'admin' && user.tenant === 'platform') return 'platform_admin';
  if (user.role === 'admin' || user.role === 'tenant_admin') return 'tenant_admin';
  return 'specialist';
};

dashboardRouter.get('/home', (req, res) => {
  const authedReq = req as AuthedRequest;
  const user = authedReq.user;
  const role = resolveHomeRole(authedReq);
  const tenant = user?.tenant ?? 'default';

  // 公共块：AI 员工近期状态
  const missionsActive = (db.prepare(`
    SELECT COUNT(*) as count FROM agent_missions WHERE status IN ('queued', 'running', 'waiting_approval')
    ${role !== 'platform_admin' ? 'AND tenant = ?' : ''}
  `).get(...(role !== 'platform_admin' ? [tenant] : [])) as { count: number }).count;

  const missionsSucceeded24h = (db.prepare(`
    SELECT COUNT(*) as count FROM agent_missions
    WHERE status = 'succeeded' AND datetime(finished_at) > datetime('now', '-1 day')
    ${role !== 'platform_admin' ? 'AND tenant = ?' : ''}
  `).get(...(role !== 'platform_admin' ? [tenant] : [])) as { count: number }).count;

  const missionsWaitingApproval = (db.prepare(`
    SELECT COUNT(*) as count FROM agent_missions WHERE status = 'waiting_approval'
    ${role !== 'platform_admin' ? 'AND tenant = ?' : ''}
  `).get(...(role !== 'platform_admin' ? [tenant] : [])) as { count: number }).count;

  // Platform admin：跨租户视角
  if (role === 'platform_admin') {
    const platformTotals = db.prepare(`
      SELECT
        (SELECT COUNT(DISTINCT tenant) FROM leads WHERE tenant != 'platform') as tenantCount,
        (SELECT COALESCE(SUM(commission_amount), 0) FROM deals) as commissionTotalFen,
        (SELECT COALESCE(SUM(commission_paid_amount), 0) FROM deals) as commissionPaidFen,
        (SELECT COUNT(*) FROM deals WHERE suspicious = 1) as suspiciousCount,
        (SELECT COUNT(*) FROM deals WHERE datetime(signed_at) > datetime('now', '-7 days')) as dealsLast7d,
        (SELECT COUNT(*) FROM leads WHERE datetime(created_at) > datetime('now', '-7 days')) as leadsLast7d
    `).get() as { tenantCount: number; commissionTotalFen: number; commissionPaidFen: number; suspiciousCount: number; dealsLast7d: number; leadsLast7d: number };

    const topActions: Array<{ type: string; title: string; count: number; to: string }> = [];
    if (platformTotals.suspiciousCount > 0) {
      topActions.push({
        type: 'alert',
        title: `${platformTotals.suspiciousCount} 条疑似异常成交待核查`,
        count: platformTotals.suspiciousCount,
        to: 'management',
      });
    }
    if (missionsWaitingApproval > 0) {
      topActions.push({
        type: 'approval',
        title: `${missionsWaitingApproval} 个 AI 任务等待你审批`,
        count: missionsWaitingApproval,
        to: 'agent',
      });
    }

    return res.json({
      success: true,
      data: {
        role,
        headline: '甲方总控台',
        highlights: [
          { label: '已接入乙方', value: platformTotals.tenantCount, unit: '家' },
          { label: '本周成交', value: platformTotals.dealsLast7d, unit: '单' },
          { label: '本周新线索', value: platformTotals.leadsLast7d, unit: '条' },
          { label: '应收分成（万元）', value: (platformTotals.commissionTotalFen / 100 / 10000).toFixed(2), accent: 'emerald' },
          { label: '未结分成（万元）', value: ((platformTotals.commissionTotalFen - platformTotals.commissionPaidFen) / 100 / 10000).toFixed(2), accent: platformTotals.commissionTotalFen > platformTotals.commissionPaidFen ? 'orange' : 'gray' },
          { label: '疑似异常', value: platformTotals.suspiciousCount, accent: platformTotals.suspiciousCount > 0 ? 'red' : 'gray' },
        ],
        topActions,
        aiSummary: {
          activeMissions: missionsActive,
          succeeded24h: missionsSucceeded24h,
          waitingApproval: missionsWaitingApproval,
        },
      },
      error: null,
    });
  }

  // Tenant admin：本租户视角
  if (role === 'tenant_admin') {
    const tenantStats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE tenant = ? AND date(created_at) = date('now')) as todayLeads,
        (SELECT COUNT(*) FROM leads WHERE tenant = ? AND intent = 'high' AND status NOT IN ('enrolled', 'lost')) as highIntentOpen,
        (SELECT COUNT(*) FROM leads WHERE tenant = ? AND status = 'enrolled') as totalEnrolled,
        (SELECT COUNT(*) FROM deals WHERE tenant = ? AND datetime(signed_at) > datetime('now', '-7 days')) as dealsLast7d,
        (SELECT COALESCE(SUM(total_tuition), 0) FROM deals WHERE tenant = ? AND datetime(signed_at) > datetime('now', '-30 days')) as tuitionLast30dFen,
        (SELECT COUNT(*) FROM rpa_accounts WHERE tenant = ? AND cookies_json IS NOT NULL AND status = 'active') as rpaLoggedIn,
        (SELECT COUNT(*) FROM content_items WHERE tenant = ? AND status = 'pending') as contentPending
    `).get(tenant, tenant, tenant, tenant, tenant, tenant, tenant) as {
      todayLeads: number; highIntentOpen: number; totalEnrolled: number; dealsLast7d: number;
      tuitionLast30dFen: number; rpaLoggedIn: number; contentPending: number;
    };

    const topActions: Array<{ type: string; title: string; count: number; to: string }> = [];
    if (tenantStats.highIntentOpen > 0) {
      topActions.push({
        type: 'followup',
        title: `${tenantStats.highIntentOpen} 条高意向未转化，建议让 AI 员工跟进`,
        count: tenantStats.highIntentOpen,
        to: 'agent',
      });
    }
    if (tenantStats.contentPending > 0) {
      topActions.push({
        type: 'review',
        title: `${tenantStats.contentPending} 条内容待审核`,
        count: tenantStats.contentPending,
        to: 'factory',
      });
    }
    if (missionsWaitingApproval > 0) {
      topActions.push({
        type: 'approval',
        title: `${missionsWaitingApproval} 个 AI 任务等你审批`,
        count: missionsWaitingApproval,
        to: 'agent',
      });
    }
    if (tenantStats.rpaLoggedIn < 3) {
      topActions.push({
        type: 'warning',
        title: `仅 ${tenantStats.rpaLoggedIn} 个 RPA 账号已登录（建议 ≥3）`,
        count: tenantStats.rpaLoggedIn,
        to: 'acquisition',
      });
    }

    return res.json({
      success: true,
      data: {
        role,
        headline: '乙方运营台',
        highlights: [
          { label: '今日新线索', value: tenantStats.todayLeads, unit: '条' },
          { label: '高意向未转化', value: tenantStats.highIntentOpen, unit: '条', accent: tenantStats.highIntentOpen > 10 ? 'orange' : 'gray' },
          { label: '本周成交', value: tenantStats.dealsLast7d, unit: '单' },
          { label: '近 30 天学费（万元）', value: (tenantStats.tuitionLast30dFen / 100 / 10000).toFixed(2), accent: 'emerald' },
          { label: '已登录 RPA 账号', value: tenantStats.rpaLoggedIn, unit: '个', accent: tenantStats.rpaLoggedIn < 3 ? 'orange' : 'gray' },
          { label: '累计学员', value: tenantStats.totalEnrolled, unit: '人' },
        ],
        topActions,
        aiSummary: {
          activeMissions: missionsActive,
          succeeded24h: missionsSucceeded24h,
          waitingApproval: missionsWaitingApproval,
        },
        quickActions: [
          { id: 'mission:daily_content_sprint', label: '生成今日 3 条内容' },
          { id: 'mission:lead_followup_sweep', label: '扫描高意向线索' },
          { id: 'mission:daily_briefing', label: '出一份今日战报' },
          { id: 'mission:weekly_report', label: '出本周经营报表' },
        ],
      },
      error: null,
    });
  }

  // Specialist：我的今日待办
  const myStats = user ? db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE assignee = ? AND tenant = ? AND status NOT IN ('enrolled', 'lost')) as myOpenLeads,
      (SELECT COUNT(*) FROM leads WHERE assignee = ? AND tenant = ? AND intent = 'high' AND status NOT IN ('enrolled', 'lost')) as myHighIntent,
      (SELECT COUNT(*) FROM leads WHERE assignee = ? AND tenant = ? AND date(created_at) = date('now')) as myTodayLeads
  `).get(user.name, tenant, user.name, tenant, user.name, tenant) as {
    myOpenLeads: number; myHighIntent: number; myTodayLeads: number;
  } : { myOpenLeads: 0, myHighIntent: 0, myTodayLeads: 0 };

  const todayTodos = user ? db.prepare(`
    WITH latest_followup AS (
      SELECT lead_id, MAX(id) as fid FROM followups GROUP BY lead_id
    )
    SELECT l.id, l.nickname, l.intent, l.source, l.last_message as lastMessage,
           f.next_followup_at as nextFollowupAt, f.next_action as nextAction
    FROM leads l
    LEFT JOIN latest_followup lf ON lf.lead_id = l.id
    LEFT JOIN followups f ON f.id = lf.fid
    WHERE l.assignee = ? AND l.tenant = ? AND l.status NOT IN ('enrolled', 'lost')
      AND (
        (f.next_followup_at IS NOT NULL AND datetime(f.next_followup_at) <= datetime('now', '+1 day'))
        OR l.intent = 'high'
      )
    ORDER BY
      CASE WHEN l.intent = 'high' THEN 0 WHEN l.intent = 'medium' THEN 1 ELSE 2 END,
      f.next_followup_at ASC
    LIMIT 10
  `).all(user.name, tenant) : [];

  return res.json({
    success: true,
    data: {
      role,
      headline: `${user?.name ?? '专员'} · 今日工作台`,
      highlights: [
        { label: '今日分给我', value: myStats.myTodayLeads, unit: '条' },
        { label: '我的高意向', value: myStats.myHighIntent, unit: '条', accent: myStats.myHighIntent > 5 ? 'emerald' : 'gray' },
        { label: '我的待跟进', value: myStats.myOpenLeads, unit: '条' },
      ],
      todayTodos,
      quickActions: [
        { id: 'goto:leads', label: '查看我的全部线索' },
        { id: 'goto:assistant', label: '打开微信助手 AI 话术' },
      ],
    },
    error: null,
  });
});



dashboardRouter.get('/summary', (_req, res) => {
  const todayNewLeads = (db.prepare(`SELECT COUNT(*) as count FROM leads WHERE date(created_at) = date('now')`).get() as { count: number }).count;
  const totalLeads = (db.prepare(`SELECT COUNT(*) as count FROM leads`).get() as { count: number }).count;
  const contactedLeads = (db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status IN ('contacted', 'following', 'interested', 'enrolled')`).get() as { count: number }).count;
  const interestedLeads = (db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'interested'`).get() as { count: number }).count;
  const enrolledLeads = (db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'enrolled'`).get() as { count: number }).count;
  const pendingFollowUps = (db.prepare(`
    SELECT COUNT(*) as count
    FROM (
      SELECT lead_id, MAX(id) as latest_followup_id
      FROM followups
      GROUP BY lead_id
    ) latest
    INNER JOIN followups f ON f.id = latest.latest_followup_id
    INNER JOIN leads l ON l.id = f.lead_id
    WHERE f.next_followup_at IS NOT NULL
      AND datetime(f.next_followup_at) <= datetime('now')
      AND l.status NOT IN ('enrolled', 'lost')
  `).get() as { count: number }).count;
  const pendingPaymentReminders = (db.prepare(`
    SELECT COUNT(*) as count
    FROM payment_records
    WHERE next_payment_due_at IS NOT NULL
      AND datetime(next_payment_due_at) <= datetime('now', '+7 days')
      AND paid_amount < total_amount
  `).get() as { count: number }).count;
  const contentGeneratedCount = (db.prepare(`SELECT COUNT(*) as count FROM content_items`).get() as { count: number }).count;
  const contentPublishedCount = (db.prepare(`SELECT COUNT(*) as count FROM content_items WHERE status = 'published'`).get() as { count: number }).count;
  const contentViews = (db.prepare(`SELECT COALESCE(SUM(views), 0) as total FROM content_items WHERE status = 'published'`).get() as { total: number }).total;
  const contentLeads = (db.prepare(`SELECT COALESCE(SUM(leads), 0) as total FROM content_items WHERE status = 'published'`).get() as { total: number }).total;

  const byAssignee = db.prepare(`
    WITH followup_counts AS (
      SELECT lead_id, COUNT(*) as followUps
      FROM followups
      GROUP BY lead_id
    )
    SELECT
      COALESCE(l.assignee, '未分配') as name,
      COUNT(*) as leads,
      COALESCE(SUM(fc.followUps), 0) as followUps,
      SUM(CASE WHEN l.status = 'interested' THEN 1 ELSE 0 END) as interested,
      SUM(CASE WHEN l.status = 'enrolled' THEN 1 ELSE 0 END) as enrolled
    FROM leads l
    LEFT JOIN followup_counts fc ON fc.lead_id = l.id
    GROUP BY COALESCE(l.assignee, '未分配')
    ORDER BY enrolled DESC, interested DESC, followUps DESC, leads DESC
  `).all() as Array<{ name: string; leads: number; followUps: number; interested: number; enrolled: number }>;
  const bySource = db.prepare(`SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC`).all() as Array<{ source: string; count: number }>;
  const rawTrend = db.prepare(`
    WITH RECURSIVE days(day) AS (
      SELECT date('now', '-6 days')
      UNION ALL
      SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    )
    SELECT
      strftime('%m-%d', days.day) as date,
      (SELECT COUNT(*) FROM leads WHERE date(created_at) = days.day) as leads,
      (SELECT COUNT(*) FROM followups WHERE date(created_at) = days.day) as followUps
    FROM days
  `).all() as Array<{ date: string; leads: number; followUps: number }>;

  res.json({
    success: true,
    data: {
      todayNewLeads,
      totalLeads,
      contactedLeads,
      interestedLeads,
      enrolledLeads,
      pendingFollowUps,
      pendingPaymentReminders,
      contentGeneratedCount,
      contentPublishedCount,
      contentViews,
      contentLeads,
      performance: byAssignee,
      funnel: [
        { value: totalLeads, name: `各平台线索 · ${totalLeads}人`, fill: '#8884d8' },
        { value: contactedLeads, name: `已建立联系 · ${contactedLeads}人`, fill: '#83a6ed' },
        { value: interestedLeads, name: `意向明确 · ${interestedLeads}人`, fill: '#8dd1e1' },
        { value: enrolledLeads, name: `已报名 · ${enrolledLeads}人`, fill: '#82ca9d' },
      ],
      trend: rawTrend,
      sources: bySource,
    },
    error: null,
  });
});

// 乙方新手引导 checklist：检查 7 件事是否完成，返回进度
dashboardRouter.get('/onboarding', (req, res) => {
  const user = (req as AuthedRequest).user;
  const tenant = user?.tenant ?? 'default';
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: '需登录' });
  }

  const checks = [
    {
      id: 'schools_loaded',
      label: '录入至少 1 所合作院校',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM schools`).get() as { count: number }).count > 0),
      actionLabel: '去系统设置 → 院校素材库',
      actionTab: 'settings',
    },
    {
      id: 'specialists_created',
      label: '创建至少 1 个招生专员账号',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM users WHERE tenant = ? AND role = 'specialist'`).get(tenant) as { count: number }).count > 0),
      actionLabel: '去用户管理（/api/auth/users）',
      actionTab: 'settings',
    },
    {
      id: 'rpa_logged_in',
      label: '至少 1 个 RPA 账号已登录',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM rpa_accounts WHERE tenant = ? AND cookies_json IS NOT NULL`).get(tenant) as { count: number }).count > 0),
      actionLabel: '去 AI 获客 → 发布矩阵',
      actionTab: 'acquisition',
    },
    {
      id: 'first_lead',
      label: '系统中有至少 1 条线索',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM leads WHERE tenant = ?`).get(tenant) as { count: number }).count > 0),
      actionLabel: '去线索管理',
      actionTab: 'leads',
    },
    {
      id: 'first_content_approved',
      label: '至少 1 条内容通过审核',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM content_items WHERE tenant = ? AND status IN ('approved', 'published')`).get(tenant) as { count: number }).count > 0),
      actionLabel: '去内容工厂',
      actionTab: 'factory',
    },
    {
      id: 'first_mission',
      label: '创建第一个 AI 员工任务',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM agent_missions WHERE tenant = ?`).get(tenant) as { count: number }).count > 0),
      actionLabel: '去 AI 员工工作台',
      actionTab: 'agent',
    },
    {
      id: 'compliance_reviewed',
      label: '至少 1 份协议经法务复审',
      completed: ((db.prepare(`SELECT COUNT(*) as count FROM agreements WHERE legal_reviewed = 1`).get() as { count: number }).count > 0),
      actionLabel: '去合规中心',
      actionTab: 'compliance',
    },
  ];

  const completedCount = checks.filter((c) => c.completed).length;
  const totalCount = checks.length;

  res.json({
    success: true,
    data: {
      checks,
      completedCount,
      totalCount,
      progress: Math.round((completedCount / totalCount) * 100),
      finished: completedCount === totalCount,
    },
    error: null,
  });
});

// v3.3.a · AI 员工今日战报：GET latest / POST generate
dashboardRouter.get('/tenant-briefing/latest', (req, res) => {
  const user = (req as AuthedRequest).user;
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: '需登录' });
  }
  const tenant = user.tenant ?? 'default';
  const briefing = getLatestBriefing(tenant);
  res.json({
    success: true,
    data: briefing ? { ...briefing, persona: AGENT_PERSONAS[briefing.personaId] } : null,
    error: null,
  });
});

dashboardRouter.post('/tenant-briefing/generate', async (req, res) => {
  const user = (req as AuthedRequest).user;
  if (!user) {
    return res.status(401).json({ success: false, data: null, error: '需登录' });
  }
  const tenant = user.tenant ?? 'default';
  try {
    const briefing = await generateBriefing(tenant);
    res.json({
      success: true,
      data: { ...briefing, persona: AGENT_PERSONAS[briefing.personaId] },
      error: null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, data: null, error: msg });
  }
});

// v3.3.a · 暴露 agent personas（前端渲染头像 + 昵称）
dashboardRouter.get('/agent-personas', (_req, res) => {
  res.json({ success: true, data: AGENT_PERSONAS, error: null });
});

export { dashboardRouter };
