import { Router } from 'express';
import { db } from '../db';

export const metricsRouter = Router();

const formatLabels = (labels: Record<string, string>): string => {
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
  return pairs ? `{${pairs}}` : '';
};

const formatMetric = (
  name: string,
  help: string,
  type: 'gauge' | 'counter',
  rows: Array<{ labels: Record<string, string>; value: number }>
): string => {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const row of rows) {
    lines.push(`${name}${formatLabels(row.labels)} ${row.value}`);
  }
  return lines.join('\n');
};

metricsRouter.get('/', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.METRICS_BEARER_TOKEN;
  if (expectedToken) {
    if (authHeader !== `Bearer ${expectedToken}`) {
      return res.status(401).type('text/plain').send('Unauthorized');
    }
  }

  const blocks: string[] = [];

  const jobsByStatus = db.prepare(`
    SELECT name, status, COUNT(*) as count FROM jobs GROUP BY name, status
  `).all() as Array<{ name: string; status: string; count: number }>;

  blocks.push(formatMetric(
    'admissions_jobs_total',
    'Number of jobs grouped by name and status',
    'gauge',
    jobsByStatus.map((r) => ({ labels: { name: r.name, status: r.status }, value: r.count }))
  ));

  const jobSucceeded24h = db.prepare(`
    SELECT name, COUNT(*) as count FROM jobs
    WHERE status = 'succeeded' AND datetime(finished_at) > datetime('now', '-1 day')
    GROUP BY name
  `).all() as Array<{ name: string; count: number }>;

  blocks.push(formatMetric(
    'admissions_jobs_succeeded_last_day',
    'Jobs succeeded in last 24 hours by name',
    'gauge',
    jobSucceeded24h.map((r) => ({ labels: { name: r.name }, value: r.count }))
  ));

  const rpaTasksByPlatformStatus = db.prepare(`
    SELECT ra.platform, rt.status, COUNT(*) as count
    FROM rpa_tasks rt
    LEFT JOIN rpa_accounts ra ON ra.id = rt.account_id
    GROUP BY ra.platform, rt.status
  `).all() as Array<{ platform: string; status: string; count: number }>;

  blocks.push(formatMetric(
    'admissions_rpa_tasks_total',
    'RPA tasks grouped by platform and status',
    'gauge',
    rpaTasksByPlatformStatus.map((r) => ({ labels: { platform: r.platform ?? 'unknown', status: r.status }, value: r.count }))
  ));

  const leadsByTenantStatus = db.prepare(`
    SELECT tenant, status, COUNT(*) as count FROM leads GROUP BY tenant, status
  `).all() as Array<{ tenant: string; status: string; count: number }>;

  blocks.push(formatMetric(
    'admissions_leads_total',
    'Leads grouped by tenant and status',
    'gauge',
    leadsByTenantStatus.map((r) => ({ labels: { tenant: r.tenant, status: r.status }, value: r.count }))
  ));

  const dealsByTenantStatus = db.prepare(`
    SELECT tenant, status, COUNT(*) as count, COALESCE(SUM(commission_amount), 0) as commission
    FROM deals GROUP BY tenant, status
  `).all() as Array<{ tenant: string; status: string; count: number; commission: number }>;

  blocks.push(formatMetric(
    'admissions_deals_total',
    'Deals grouped by tenant and status',
    'gauge',
    dealsByTenantStatus.map((r) => ({ labels: { tenant: r.tenant, status: r.status }, value: r.count }))
  ));

  blocks.push(formatMetric(
    'admissions_commission_fen',
    'Commission amount (in fen) grouped by tenant and status',
    'gauge',
    dealsByTenantStatus.map((r) => ({ labels: { tenant: r.tenant, status: r.status }, value: r.commission }))
  ));

  const aiCallsByScene = db.prepare(`
    SELECT scene, COUNT(*) as count FROM ai_logs
    WHERE datetime(created_at) > datetime('now', '-1 day')
    GROUP BY scene
  `).all() as Array<{ scene: string; count: number }>;

  blocks.push(formatMetric(
    'admissions_ai_calls_last_day',
    'AI calls in last 24 hours grouped by scene',
    'counter',
    aiCallsByScene.map((r) => ({ labels: { scene: r.scene }, value: r.count }))
  ));

  const depositsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM deposits GROUP BY status
  `).all() as Array<{ status: string; count: number; total: number }>;

  blocks.push(formatMetric(
    'admissions_deposits_total',
    'Deposits grouped by status',
    'gauge',
    depositsByStatus.map((r) => ({ labels: { status: r.status }, value: r.count }))
  ));

  blocks.push(formatMetric(
    'admissions_deposits_amount_fen',
    'Deposit amount (in fen) grouped by status',
    'gauge',
    depositsByStatus.map((r) => ({ labels: { status: r.status }, value: r.total }))
  ));

  const rpaAccounts = db.prepare(`
    SELECT platform, status, COUNT(*) as count,
           SUM(CASE WHEN cookies_json IS NOT NULL THEN 1 ELSE 0 END) as loggedIn
    FROM rpa_accounts
    GROUP BY platform, status
  `).all() as Array<{ platform: string; status: string; count: number; loggedIn: number }>;

  blocks.push(formatMetric(
    'admissions_rpa_accounts_total',
    'RPA accounts grouped by platform and status',
    'gauge',
    rpaAccounts.map((r) => ({ labels: { platform: r.platform, status: r.status }, value: r.count }))
  ));

  blocks.push(formatMetric(
    'admissions_rpa_accounts_logged_in',
    'RPA accounts that have cookies (logged in) grouped by platform',
    'gauge',
    rpaAccounts.map((r) => ({ labels: { platform: r.platform, status: r.status }, value: r.loggedIn }))
  ));

  const auditWritesLastHour = (db.prepare(`
    SELECT COUNT(*) as count FROM audit_logs WHERE datetime(created_at) > datetime('now', '-1 hour')
  `).get() as { count: number }).count;

  blocks.push(formatMetric(
    'admissions_audit_writes_last_hour',
    'Audit log writes in the last hour',
    'gauge',
    [{ labels: {}, value: auditWritesLastHour }]
  ));

  res.type('text/plain; version=0.0.4').send(blocks.join('\n\n') + '\n');
});
