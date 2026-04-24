import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';

export const platformRouter = Router();

platformRouter.use(requireAuth, requireRole(['admin']));

platformRouter.get('/overview', (_req: AuthedRequest, res) => {
  const tenantBreakdown = db.prepare(`
    SELECT tenant,
           COUNT(*) as totalLeads,
           SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) as enrolledLeads,
           SUM(CASE WHEN intent = 'high' THEN 1 ELSE 0 END) as highIntent,
           SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) as todayLeads
    FROM leads
    GROUP BY tenant
    ORDER BY totalLeads DESC
  `).all() as Array<{ tenant: string; totalLeads: number; enrolledLeads: number; highIntent: number; todayLeads: number }>;

  const dealsByTenant = db.prepare(`
    SELECT tenant,
           COUNT(*) as totalDeals,
           COALESCE(SUM(total_tuition), 0) as totalTuition,
           COALESCE(SUM(commission_amount), 0) as totalCommission,
           COALESCE(SUM(commission_paid_amount), 0) as commissionPaid,
           SUM(CASE WHEN suspicious = 1 THEN 1 ELSE 0 END) as suspiciousCount
    FROM deals
    GROUP BY tenant
  `).all() as Array<{ tenant: string; totalDeals: number; totalTuition: number; totalCommission: number; commissionPaid: number; suspiciousCount: number }>;

  const usersByTenant = db.prepare(`
    SELECT tenant,
           COUNT(*) as total,
           SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
           SUM(CASE WHEN role = 'tenant_admin' THEN 1 ELSE 0 END) as tenantAdmins,
           SUM(CASE WHEN role = 'specialist' THEN 1 ELSE 0 END) as specialists,
           SUM(CASE WHEN is_active = 1 AND datetime(last_login_at) > datetime('now', '-7 days') THEN 1 ELSE 0 END) as activeWeekly
    FROM users
    GROUP BY tenant
  `).all() as Array<{ tenant: string; total: number; admins: number; tenantAdmins: number; specialists: number; activeWeekly: number }>;

  const rpaByTenant = db.prepare(`
    SELECT tenant,
           COUNT(*) as totalAccounts,
           SUM(CASE WHEN cookies_json IS NOT NULL THEN 1 ELSE 0 END) as loggedInAccounts,
           SUM(CASE WHEN status = 'cooldown' THEN 1 ELSE 0 END) as cooldownAccounts,
           SUM(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) as bannedAccounts
    FROM rpa_accounts
    GROUP BY tenant
  `).all() as Array<{ tenant: string; totalAccounts: number; loggedInAccounts: number; cooldownAccounts: number; bannedAccounts: number }>;

  const tenants = new Map<string, {
    tenant: string;
    leads: { total: number; enrolled: number; highIntent: number; today: number };
    deals: { total: number; tuitionYuan: number; commissionYuan: number; commissionPaidYuan: number; suspicious: number };
    users: { total: number; admins: number; tenantAdmins: number; specialists: number; activeWeekly: number };
    rpa: { total: number; loggedIn: number; cooldown: number; banned: number };
  }>();

  const ensure = (name: string) => {
    if (!tenants.has(name)) {
      tenants.set(name, {
        tenant: name,
        leads: { total: 0, enrolled: 0, highIntent: 0, today: 0 },
        deals: { total: 0, tuitionYuan: 0, commissionYuan: 0, commissionPaidYuan: 0, suspicious: 0 },
        users: { total: 0, admins: 0, tenantAdmins: 0, specialists: 0, activeWeekly: 0 },
        rpa: { total: 0, loggedIn: 0, cooldown: 0, banned: 0 },
      });
    }
    return tenants.get(name)!;
  };

  for (const row of tenantBreakdown) {
    const t = ensure(row.tenant);
    t.leads.total = row.totalLeads;
    t.leads.enrolled = row.enrolledLeads;
    t.leads.highIntent = row.highIntent;
    t.leads.today = row.todayLeads;
  }

  for (const row of dealsByTenant) {
    const t = ensure(row.tenant);
    t.deals.total = row.totalDeals;
    t.deals.tuitionYuan = row.totalTuition / 100;
    t.deals.commissionYuan = row.totalCommission / 100;
    t.deals.commissionPaidYuan = row.commissionPaid / 100;
    t.deals.suspicious = row.suspiciousCount;
  }

  for (const row of usersByTenant) {
    const t = ensure(row.tenant);
    t.users = {
      total: row.total,
      admins: row.admins,
      tenantAdmins: row.tenantAdmins,
      specialists: row.specialists,
      activeWeekly: row.activeWeekly,
    };
  }

  for (const row of rpaByTenant) {
    const t = ensure(row.tenant);
    t.rpa = {
      total: row.totalAccounts,
      loggedIn: row.loggedInAccounts,
      cooldown: row.cooldownAccounts,
      banned: row.bannedAccounts,
    };
  }

  const tenantList = Array.from(tenants.values()).filter((t) => t.tenant !== 'platform');

  const platformTotals = {
    tenants: tenantList.length,
    totalLeads: tenantList.reduce((s, t) => s + t.leads.total, 0),
    totalEnrolled: tenantList.reduce((s, t) => s + t.leads.enrolled, 0),
    totalDeals: tenantList.reduce((s, t) => s + t.deals.total, 0),
    totalTuitionYuan: tenantList.reduce((s, t) => s + t.deals.tuitionYuan, 0),
    totalCommissionYuan: tenantList.reduce((s, t) => s + t.deals.commissionYuan, 0),
    unpaidCommissionYuan: tenantList.reduce((s, t) => s + (t.deals.commissionYuan - t.deals.commissionPaidYuan), 0),
    suspiciousDeals: tenantList.reduce((s, t) => s + t.deals.suspicious, 0),
    totalUsers: tenantList.reduce((s, t) => s + t.users.total, 0),
    activeUsersWeekly: tenantList.reduce((s, t) => s + t.users.activeWeekly, 0),
  };

  const systemHealth = {
    contentItemsPending: (db.prepare(`SELECT COUNT(*) as count FROM content_items WHERE status = 'pending'`).get() as { count: number }).count,
    rpaTasksQueued: (db.prepare(`SELECT COUNT(*) as count FROM rpa_tasks WHERE status = 'queued'`).get() as { count: number }).count,
    rpaTasksFailed24h: (db.prepare(`SELECT COUNT(*) as count FROM rpa_tasks WHERE status = 'failed' AND datetime(updated_at) > datetime('now', '-1 day')`).get() as { count: number }).count,
    auditWrites24h: (db.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE datetime(created_at) > datetime('now', '-1 day')`).get() as { count: number }).count,
    consentsTotal: (db.prepare(`SELECT COUNT(*) as count FROM consents`).get() as { count: number }).count,
    agreementsUnreviewed: (db.prepare(`SELECT COUNT(*) as count FROM agreements WHERE is_active = 1 AND legal_reviewed = 0`).get() as { count: number }).count,
  };

  res.json({
    success: true,
    data: {
      platformTotals,
      tenants: tenantList,
      systemHealth,
    },
    error: null,
  });
});

platformRouter.get('/jobs', (_req: AuthedRequest, res) => {
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'succeeded' AND datetime(finished_at) > datetime('now', '-1 day') THEN 1 ELSE 0 END) as succeeded24h
    FROM jobs
  `).get() as { queued: number; running: number; failed: number; succeeded24h: number };

  const recent = db.prepare(`
    SELECT id, name, status, attempts, max_attempts as maxAttempts,
           last_error as lastError, scheduled_at as scheduledAt,
           started_at as startedAt, finished_at as finishedAt, created_at as createdAt
    FROM jobs
    ORDER BY id DESC
    LIMIT 50
  `).all();

  res.json({
    success: true,
    data: {
      stats: {
        queued: stats.queued ?? 0,
        running: stats.running ?? 0,
        failed: stats.failed ?? 0,
        succeeded24h: stats.succeeded24h ?? 0,
      },
      recent,
    },
    error: null,
  });
});

platformRouter.get('/trend', (_req: AuthedRequest, res) => {
  const leadsTrend = db.prepare(`
    WITH RECURSIVE days(day) AS (
      SELECT date('now', '-29 days')
      UNION ALL
      SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    )
    SELECT strftime('%m-%d', days.day) as date,
           (SELECT COUNT(*) FROM leads WHERE date(created_at) = days.day) as leads,
           (SELECT COUNT(*) FROM deals WHERE date(signed_at) = days.day) as deals
    FROM days
  `).all() as Array<{ date: string; leads: number; deals: number }>;

  res.json({ success: true, data: leadsTrend, error: null });
});
