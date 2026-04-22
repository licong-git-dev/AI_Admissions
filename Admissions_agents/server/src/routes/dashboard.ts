import { Router } from 'express';
import { db } from '../db';

const dashboardRouter = Router();

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

export { dashboardRouter };
