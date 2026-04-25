import { Router, type Response } from 'express';
import { db } from '../db';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { notifyAdminNewDeal } from '../services/notify';
import { triggerRewardOnDeal } from '../services/referral-service';

type DealRow = {
  id: number;
  lead_id: number;
  school_name: string;
  major_name: string;
  total_tuition: number;
  commission_rate: number;
  commission_amount: number;
  deposit_id: number | null;
  tenant: string;
  assignee_user_id: number | null;
  status: string;
  paid_amount: number;
  commission_paid_amount: number;
  commission_settled_at: string | null;
  signed_at: string;
  note: string | null;
  suspicious: number;
  suspicious_reason: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

const VALID_STATUSES = new Set([
  'pending_payment',
  'partially_paid',
  'fully_paid',
  'settled_to_a',
  'refunded',
  'canceled',
]);

const DEFAULT_COMMISSION_RATE = 0.30;

const toDeal = (row: DealRow) => ({
  id: row.id,
  leadId: row.lead_id,
  schoolName: row.school_name,
  majorName: row.major_name,
  totalTuitionFen: row.total_tuition,
  totalTuitionYuan: row.total_tuition / 100,
  commissionRate: row.commission_rate,
  commissionAmountFen: row.commission_amount,
  commissionAmountYuan: row.commission_amount / 100,
  depositId: row.deposit_id,
  tenant: row.tenant,
  assigneeUserId: row.assignee_user_id,
  status: row.status,
  paidAmountFen: row.paid_amount,
  commissionPaidAmountFen: row.commission_paid_amount,
  commissionSettledAt: row.commission_settled_at,
  signedAt: row.signed_at,
  note: row.note,
  suspicious: row.suspicious === 1,
  suspiciousReason: row.suspicious_reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const detectSuspicious = (leadId: number): { suspicious: boolean; reason: string | null } => {
  const { count: followupCount } = db.prepare(
    `SELECT COUNT(*) as count FROM followups WHERE lead_id = ?`
  ).get(leadId) as { count: number };

  if (followupCount === 0) {
    return {
      suspicious: true,
      reason: '该线索无任何跟进记录，疑似绕过系统线下成交',
    };
  }

  const { count: recentFollowupCount } = db.prepare(
    `SELECT COUNT(*) as count FROM followups WHERE lead_id = ? AND datetime(created_at) >= datetime('now', '-30 days')`
  ).get(leadId) as { count: number };

  if (recentFollowupCount === 0) {
    return {
      suspicious: true,
      reason: '近 30 天内无跟进记录，成交链路不完整',
    };
  }

  return { suspicious: false, reason: null };
};

const getScopedWhere = (user: { role: string; tenant: string; sub: number }): { clause: string; params: (string | number)[] } => {
  if (user.role === 'admin') {
    return { clause: '', params: [] };
  }
  if (user.role === 'tenant_admin') {
    return { clause: 'WHERE d.tenant = ?', params: [user.tenant] };
  }
  // specialist：仅本人负责的 deals
  return {
    clause: 'WHERE d.tenant = ? AND d.assignee_user_id = ?',
    params: [user.tenant, user.sub],
  };
};

export const dealsRouter = Router();

dealsRouter.use(requireAuth);

dealsRouter.get('/', (req: AuthedRequest, res) => {
  const user = req.user!;
  const { status, period } = req.query;

  const scope = getScopedWhere(user);
  const filters = [...(scope.clause ? [scope.clause.replace('WHERE ', '')] : [])];
  const params: (string | number)[] = [...scope.params];

  if (typeof status === 'string' && status) {
    filters.push('d.status = ?');
    params.push(status);
  }
  if (typeof period === 'string' && /^\d{4}-\d{2}$/.test(period)) {
    filters.push("strftime('%Y-%m', d.signed_at) = ?");
    params.push(period);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT d.* FROM deals d
    ${where}
    ORDER BY d.id DESC
    LIMIT 500
  `).all(...params) as DealRow[];

  res.json({ success: true, data: rows.map(toDeal), error: null });
});

dealsRouter.get('/summary', requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const user = req.user!;
  const tenantFilter = user.role === 'tenant_admin' ? 'WHERE tenant = ?' : '';
  const tenantParams = user.role === 'tenant_admin' ? [user.tenant] : [];

  const overall = db.prepare(`
    SELECT
      COUNT(*) as totalDeals,
      COALESCE(SUM(total_tuition), 0) as totalTuition,
      COALESCE(SUM(commission_amount), 0) as totalCommission,
      COALESCE(SUM(commission_paid_amount), 0) as commissionPaid,
      SUM(CASE WHEN suspicious = 1 THEN 1 ELSE 0 END) as suspiciousCount
    FROM deals
    ${tenantFilter}
  `).get(...tenantParams) as {
    totalDeals: number;
    totalTuition: number;
    totalCommission: number;
    commissionPaid: number;
    suspiciousCount: number;
  };

  const byMonth = db.prepare(`
    SELECT
      strftime('%Y-%m', signed_at) as period,
      COUNT(*) as deals,
      COALESCE(SUM(total_tuition), 0) as tuition,
      COALESCE(SUM(commission_amount), 0) as commission,
      COALESCE(SUM(commission_paid_amount), 0) as commissionPaid
    FROM deals
    ${tenantFilter}
    GROUP BY period
    ORDER BY period DESC
    LIMIT 12
  `).all(...tenantParams);

  res.json({
    success: true,
    data: {
      totalDeals: overall.totalDeals,
      totalTuitionYuan: overall.totalTuition / 100,
      totalCommissionYuan: overall.totalCommission / 100,
      commissionPaidYuan: overall.commissionPaid / 100,
      commissionUnpaidYuan: (overall.totalCommission - overall.commissionPaid) / 100,
      suspiciousCount: overall.suspiciousCount,
      byMonth,
    },
    error: null,
  });
});

dealsRouter.post('/', (req: AuthedRequest, res) => {
  const user = req.user!;
  const body = req.body as {
    leadId?: number;
    schoolName?: string;
    majorName?: string;
    totalTuitionYuan?: number;
    commissionRate?: number;
    depositId?: number | null;
    note?: string;
    signedAt?: string;
  };

  if (!body.leadId || !Number.isInteger(body.leadId)) {
    return res.status(400).json({ success: false, data: null, error: 'leadId 必填且为整数' });
  }

  if (!body.schoolName || !body.majorName) {
    return res.status(400).json({ success: false, data: null, error: 'schoolName 与 majorName 必填' });
  }

  const tuitionYuan = Number(body.totalTuitionYuan);
  if (!Number.isFinite(tuitionYuan) || tuitionYuan <= 0 || tuitionYuan > 500000) {
    return res.status(400).json({ success: false, data: null, error: '学费需在 0-500000 元之间' });
  }

  const rate = Number(body.commissionRate ?? DEFAULT_COMMISSION_RATE);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    return res.status(400).json({ success: false, data: null, error: 'commissionRate 需在 (0, 1] 之间' });
  }

  const lead = db.prepare(`SELECT id, assignee FROM leads WHERE id = ?`).get(body.leadId) as { id: number; assignee: string | null } | undefined;
  if (!lead) {
    return res.status(404).json({ success: false, data: null, error: '关联线索不存在' });
  }

  const totalTuitionFen = Math.round(tuitionYuan * 100);
  const commissionAmountFen = Math.round(totalTuitionFen * rate);

  const { suspicious, reason } = detectSuspicious(body.leadId);

  const assigneeUser = lead.assignee
    ? db.prepare(`SELECT id FROM users WHERE name = ? OR username = ? LIMIT 1`).get(lead.assignee, lead.assignee) as { id: number } | undefined
    : undefined;

  const result = db.prepare(`
    INSERT INTO deals (
      lead_id, school_name, major_name, total_tuition, commission_rate, commission_amount,
      deposit_id, tenant, assignee_user_id, status, signed_at, note, suspicious, suspicious_reason, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    body.leadId,
    body.schoolName,
    body.majorName,
    totalTuitionFen,
    rate,
    commissionAmountFen,
    body.depositId ?? null,
    user.tenant,
    assigneeUser?.id ?? null,
    body.signedAt || new Date().toISOString(),
    body.note ?? null,
    suspicious ? 1 : 0,
    reason,
    user.sub
  );

  const created = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(result.lastInsertRowid) as DealRow;

  void notifyAdminNewDeal({
    schoolName: created.school_name,
    majorName: created.major_name,
    totalTuitionYuan: created.total_tuition / 100,
    suspicious: created.suspicious === 1,
    suspiciousReason: created.suspicious_reason,
  });

  // v3.3.c · 转介绍奖励：成交时自动触发（如该 lead 携带 referred_by_code）
  try {
    triggerRewardOnDeal(created.id);
  } catch (err) {
    console.warn('[deals] 触发推荐奖励失败但继续', err);
  }

  res.status(201).json({ success: true, data: toDeal(created), error: null });
});

dealsRouter.patch('/:id', (req: AuthedRequest, res) => {
  const user = req.user!;
  const existing = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(req.params.id) as DealRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '成交记录不存在' });
  }

  if (user.role === 'specialist' && existing.assignee_user_id !== user.sub) {
    return res.status(403).json({ success: false, data: null, error: '仅能修改自己负责的成交' });
  }
  if (user.role === 'tenant_admin' && existing.tenant !== user.tenant) {
    return res.status(403).json({ success: false, data: null, error: '仅能操作本租户成交' });
  }

  const body = req.body as {
    paidAmountYuan?: number;
    commissionPaidAmountYuan?: number;
    commissionSettledAt?: string | null;
    status?: string;
    note?: string;
  };

  if (body.status && !VALID_STATUSES.has(body.status)) {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.paidAmountYuan !== undefined) {
    const fen = Math.round(Number(body.paidAmountYuan) * 100);
    if (!Number.isFinite(fen) || fen < 0 || fen > existing.total_tuition) {
      return res.status(400).json({ success: false, data: null, error: '已缴学费金额非法' });
    }
    updates.push('paid_amount = ?');
    params.push(fen);
  }

  if (body.commissionPaidAmountYuan !== undefined) {
    if (user.role === 'specialist') {
      return res.status(403).json({ success: false, data: null, error: '仅管理员可登记分成结算金额' });
    }
    const fen = Math.round(Number(body.commissionPaidAmountYuan) * 100);
    if (!Number.isFinite(fen) || fen < 0 || fen > existing.commission_amount) {
      return res.status(400).json({ success: false, data: null, error: '分成已付金额非法' });
    }
    updates.push('commission_paid_amount = ?');
    params.push(fen);
  }

  if (body.commissionSettledAt !== undefined) {
    updates.push('commission_settled_at = ?');
    params.push(body.commissionSettledAt);
  }

  if (body.status) {
    updates.push('status = ?');
    params.push(body.status);
  }

  if (body.note !== undefined) {
    updates.push('note = ?');
    params.push(body.note);
  }

  if (updates.length === 0) {
    return res.json({ success: true, data: toDeal(existing), error: null });
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE deals SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(req.params.id) as DealRow;
  res.json({ success: true, data: toDeal(updated), error: null });
});

// ========== 月度结算报表 ==========

type SettlementReportRow = {
  id: number;
  period: string;
  tenant: string;
  total_deals: number;
  total_tuition: number;
  total_commission: number;
  commission_paid: number;
  commission_unpaid: number;
  suspicious_deals: number;
  generated_at: string;
  generated_by: number | null;
};

const toReport = (row: SettlementReportRow) => ({
  id: row.id,
  period: row.period,
  tenant: row.tenant,
  totalDeals: row.total_deals,
  totalTuitionYuan: row.total_tuition / 100,
  totalCommissionYuan: row.total_commission / 100,
  commissionPaidYuan: row.commission_paid / 100,
  commissionUnpaidYuan: row.commission_unpaid / 100,
  suspiciousDeals: row.suspicious_deals,
  generatedAt: row.generated_at,
  generatedBy: row.generated_by,
});

export const settlementRouter = Router();

settlementRouter.use(requireAuth, requireRole(['admin', 'tenant_admin']));

settlementRouter.get('/reports', (req: AuthedRequest, res) => {
  const user = req.user!;
  const where = user.role === 'admin' ? '' : 'WHERE tenant = ?';
  const params = user.role === 'admin' ? [] : [user.tenant];
  const rows = db.prepare(`SELECT * FROM settlement_reports ${where} ORDER BY period DESC LIMIT 120`).all(...params) as SettlementReportRow[];
  res.json({ success: true, data: rows.map(toReport), error: null });
});

const aggregatePeriod = (period: string, tenant: string | null): {
  totalDeals: number;
  totalTuition: number;
  totalCommission: number;
  commissionPaid: number;
  suspiciousCount: number;
} => {
  const where = tenant ? `WHERE strftime('%Y-%m', signed_at) = ? AND tenant = ?` : `WHERE strftime('%Y-%m', signed_at) = ?`;
  const params = tenant ? [period, tenant] : [period];

  return db.prepare(`
    SELECT
      COUNT(*) as totalDeals,
      COALESCE(SUM(total_tuition), 0) as totalTuition,
      COALESCE(SUM(commission_amount), 0) as totalCommission,
      COALESCE(SUM(commission_paid_amount), 0) as commissionPaid,
      SUM(CASE WHEN suspicious = 1 THEN 1 ELSE 0 END) as suspiciousCount
    FROM deals
    ${where}
  `).get(...params) as {
    totalDeals: number;
    totalTuition: number;
    totalCommission: number;
    commissionPaid: number;
    suspiciousCount: number;
  };
};

settlementRouter.post('/reports/generate', (req: AuthedRequest, res) => {
  const user = req.user!;
  const body = req.body as { period?: string };

  if (!body.period || !/^\d{4}-\d{2}$/.test(body.period)) {
    return res.status(400).json({ success: false, data: null, error: 'period 格式必须为 YYYY-MM' });
  }

  const tenant = user.role === 'admin' ? 'default' : user.tenant;
  const stats = aggregatePeriod(body.period, tenant);

  db.prepare(`
    INSERT INTO settlement_reports (period, tenant, total_deals, total_tuition, total_commission, commission_paid, commission_unpaid, suspicious_deals, generated_at, generated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(period) DO UPDATE SET
      tenant = excluded.tenant,
      total_deals = excluded.total_deals,
      total_tuition = excluded.total_tuition,
      total_commission = excluded.total_commission,
      commission_paid = excluded.commission_paid,
      commission_unpaid = excluded.commission_unpaid,
      suspicious_deals = excluded.suspicious_deals,
      generated_at = datetime('now'),
      generated_by = excluded.generated_by
  `).run(
    body.period,
    tenant,
    stats.totalDeals,
    stats.totalTuition,
    stats.totalCommission,
    stats.commissionPaid,
    stats.totalCommission - stats.commissionPaid,
    stats.suspiciousCount,
    user.sub
  );

  const updated = db.prepare(`SELECT * FROM settlement_reports WHERE period = ?`).get(body.period) as SettlementReportRow;
  res.json({ success: true, data: toReport(updated), error: null });
});

const escapeCsvCell = (value: unknown): string => {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
};

settlementRouter.get('/reports/:period/csv', (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  if (!/^\d{4}-\d{2}$/.test(req.params.period)) {
    return res.status(400).json({ success: false, data: null, error: 'period 格式必须为 YYYY-MM' });
  }

  const where = user.role === 'admin'
    ? `WHERE strftime('%Y-%m', d.signed_at) = ?`
    : `WHERE strftime('%Y-%m', d.signed_at) = ? AND d.tenant = ?`;
  const params = user.role === 'admin' ? [req.params.period] : [req.params.period, user.tenant];

  const rows = db.prepare(`
    SELECT d.*, l.nickname as lead_nickname, l.contact as lead_contact, l.source as lead_source,
           u.name as assignee_name
    FROM deals d
    LEFT JOIN leads l ON l.id = d.lead_id
    LEFT JOIN users u ON u.id = d.assignee_user_id
    ${where}
    ORDER BY d.signed_at ASC
  `).all(...params) as Array<DealRow & { lead_nickname: string; lead_contact: string | null; lead_source: string; assignee_name: string | null }>;

  const header = ['成交ID', '签约日期', '线索昵称', '联系方式', '来源', '负责人', '院校', '专业', '总学费(元)', '分成率', '应分成(元)', '已分成(元)', '状态', '疑似异常', '备注'];

  const lines = [header.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.id,
      row.signed_at,
      row.lead_nickname,
      row.lead_contact || '',
      row.lead_source,
      row.assignee_name || '',
      row.school_name,
      row.major_name,
      (row.total_tuition / 100).toFixed(2),
      row.commission_rate.toFixed(2),
      (row.commission_amount / 100).toFixed(2),
      (row.commission_paid_amount / 100).toFixed(2),
      row.status,
      row.suspicious === 1 ? `是（${row.suspicious_reason || ''}）` : '否',
      row.note || '',
    ].map(escapeCsvCell).join(','));
  }

  const csv = '﻿' + lines.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="settlement-${req.params.period}.csv"`);
  res.send(csv);
});
