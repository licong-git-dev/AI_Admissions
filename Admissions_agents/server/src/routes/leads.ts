import { Router } from 'express';
import { db } from '../db';
import { getTenantScope, resolveTenantForWrite } from '../middleware/tenant';
import type { AuthedRequest } from '../middleware/auth';
import { inferLeadPersona, getStoredPersona } from '../services/lead-persona-inferer';

type LeadRow = {
  id: number;
  source: string;
  nickname: string;
  contact: string | null;
  intent: 'high' | 'medium' | 'low';
  last_message: string;
  status: string;
  assignee: string | null;
  tenant: string;
  created_at: string;
  updated_at: string;
  latest_followup_at: string | null;
  latest_next_action: string | null;
  latest_next_followup_at: string | null;
  persona_json?: string | null;
};

const isLeadAccessible = (row: LeadRow | undefined, req: AuthedRequest): boolean => {
  if (!row) return false;
  const scope = getTenantScope(req);
  if (scope.isPlatformAdmin) return true;
  return row.tenant === scope.tenant;
};

type CreateLeadBody = {
  source?: string;
  nickname?: string;
  contact?: string;
  intent?: string;
  status?: string;
  assignee?: string;
  lastMessage?: string;
};

type UpdateLeadBody = Partial<CreateLeadBody>;

type CreateFollowUpBody = {
  channel?: string;
  content?: string;
  nextAction?: string;
  nextFollowupAt?: string;
};

type SaveFollowUpBody = CreateFollowUpBody & {
  status?: string;
  lastMessage?: string;
};

type SaveEnrollmentBody = {
  schoolName?: string;
  majorName?: string;
  stage?: string;
  note?: string;
};

type SavePaymentBody = {
  totalAmount?: number;
  paidAmount?: number;
  method?: string;
  firstPaidAt?: string;
  nextPaymentDueAt?: string;
  note?: string;
};

type SaveProposalCardBody = {
  schoolName?: string;
  majorName?: string;
  duration?: string;
  tuitionAmount?: number;
  serviceAmount?: number;
  totalAmount?: number;
  paymentMethod?: string;
  installmentsNote?: string;
  suitableFor?: string;
  riskNote?: string;
  proposalText?: string;
  copyText?: string;
};

const VALID_INTENTS = new Set(['high', 'medium', 'low']);
const VALID_LEAD_STATUSES = new Set(['new', 'contacted', 'following', 'interested', 'enrolled', 'lost']);
const VALID_CHANNELS = new Set(['wechat', 'phone', 'system', 'manual']);
const VALID_ENROLLMENT_STAGES = new Set(['consulting', 'applying', 'applied', 'reviewing', 'completed']);
const VALID_PAYMENT_METHODS = new Set(['全款', '分期']);

const normalizeText = (value: string | undefined, maxLength: number): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
};

const toLead = (row: LeadRow) => {
  let persona: unknown = null;
  if (row.persona_json) {
    try { persona = JSON.parse(row.persona_json); } catch { persona = null; }
  }
  return {
    id: String(row.id),
    source: row.source,
    nickname: row.nickname,
    contact: row.contact ?? '',
    intent: row.intent,
    lastMessage: row.last_message,
    status: row.status,
    assignee: row.assignee ?? '未分配',
    createdAt: row.created_at,
    latestFollowupAt: row.latest_followup_at,
    latestNextAction: row.latest_next_action,
    latestNextFollowupAt: row.latest_next_followup_at,
    persona,
  };
};

const LEAD_WITH_LATEST_FOLLOWUP_SELECT = `
  SELECT
    l.id,
    l.source,
    l.nickname,
    l.contact,
    l.intent,
    l.last_message,
    l.status,
    l.assignee,
    l.tenant,
    l.created_at,
    l.updated_at,
    l.persona_json,
    latest.created_at as latest_followup_at,
    latest.next_action as latest_next_action,
    latest.next_followup_at as latest_next_followup_at
  FROM leads l
  LEFT JOIN (
    SELECT f.*
    FROM followups f
    INNER JOIN (
      SELECT lead_id, MAX(id) as id
      FROM followups
      GROUP BY lead_id
    ) latest_id ON latest_id.id = f.id
  ) latest ON latest.lead_id = l.id
`;

const getLeadRow = (id: string, req?: AuthedRequest): LeadRow | undefined => {
  const row = db
    .prepare(
      `${LEAD_WITH_LATEST_FOLLOWUP_SELECT}
       WHERE l.id = ?`
    )
    .get(id) as LeadRow | undefined;
  if (!row) return undefined;
  if (req && !isLeadAccessible(row, req)) return undefined;
  return row;
};

const getEnrollment = (leadId: string) => db.prepare(
  `SELECT id, lead_id as leadId, school_name as schoolName, major_name as majorName, stage, note, created_at as createdAt, updated_at as updatedAt
   FROM enrollments
   WHERE lead_id = ?`
).get(leadId);

const getLatestPayment = (leadId: string) => db.prepare(
  `SELECT id, lead_id as leadId, total_amount as totalAmount, paid_amount as paidAmount, method, first_paid_at as firstPaidAt, next_payment_due_at as nextPaymentDueAt, note, created_at as createdAt, updated_at as updatedAt
   FROM payment_records
   WHERE lead_id = ?
   ORDER BY id DESC
   LIMIT 1`
).get(leadId);

const getProposalCard = (leadId: string) => db.prepare(
  `SELECT id, lead_id as leadId, school_name as schoolName, major_name as majorName, duration,
          tuition_amount as tuitionAmount, service_amount as serviceAmount, total_amount as totalAmount,
          payment_method as paymentMethod, installments_note as installmentsNote, suitable_for as suitableFor,
          risk_note as riskNote, proposal_text as proposalText, copy_text as copyText,
          created_at as createdAt, updated_at as updatedAt
   FROM proposal_cards
   WHERE lead_id = ?`
).get(leadId) ?? null;

const resolveLeadStatusFromEnrollment = (currentStatus: string, stage: string): string => {
  if (currentStatus === 'lost') {
    return currentStatus;
  }

  if (stage === 'consulting') {
    return currentStatus;
  }

  return 'enrolled';
};

const resolveLeadStatusFromPayment = (currentStatus: string, paidAmount: number): string => {
  if (currentStatus === 'lost') {
    return currentStatus;
  }

  if (paidAmount > 0) {
    return 'enrolled';
  }

  return currentStatus;
};

export const leadsRouter = Router();

leadsRouter.get('/', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const { status, source, intent, search, needsFollowup, needsPayment, sortBy } = req.query;
  const filters: string[] = [];
  const params: string[] = [];

  if (!scope.isPlatformAdmin) {
    filters.push('l.tenant = ?');
    params.push(scope.tenant);
  }

  if (typeof status === 'string' && status) {
    filters.push('l.status = ?');
    params.push(status);
  }
  if (typeof source === 'string' && source) {
    filters.push('l.source = ?');
    params.push(source);
  }
  if (typeof intent === 'string' && intent) {
    filters.push('l.intent = ?');
    params.push(intent);
  }
  if (typeof search === 'string' && search.trim()) {
    filters.push('(l.nickname LIKE ? OR COALESCE(l.contact, \'\') LIKE ? OR l.last_message LIKE ? OR COALESCE(l.assignee, \'\') LIKE ?)');
    const keyword = `%${search.trim()}%`;
    params.push(keyword, keyword, keyword, keyword);
  }
  if (needsFollowup === 'true') {
    filters.push(`latest.next_followup_at IS NOT NULL AND datetime(latest.next_followup_at) <= datetime('now') AND l.status NOT IN ('enrolled', 'lost')`);
  }
  if (needsPayment === 'true') {
    filters.push(`EXISTS (
      SELECT 1
      FROM payment_records p
      WHERE p.lead_id = l.id
        AND p.next_payment_due_at IS NOT NULL
        AND datetime(p.next_payment_due_at) <= datetime('now', '+7 days')
        AND p.paid_amount < p.total_amount
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const orderBy = sortBy === 'priority'
    ? `ORDER BY CASE
         WHEN latest.next_followup_at IS NOT NULL AND datetime(latest.next_followup_at) <= datetime('now') AND l.status NOT IN ('enrolled', 'lost') THEN 0
         WHEN l.intent = 'high' THEN 1
         WHEN l.intent = 'medium' THEN 2
         ELSE 3
       END, datetime(COALESCE(latest.next_followup_at, l.updated_at)) ASC, l.id DESC`
    : sortBy === 'intent'
      ? `ORDER BY CASE l.intent WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, l.id DESC`
      : `ORDER BY l.id DESC`;

  const rows = db
    .prepare(
      `${LEAD_WITH_LATEST_FOLLOWUP_SELECT}
       ${where}
       ${orderBy}`
    )
    .all(...params) as LeadRow[];

  res.json({ success: true, data: rows.map(toLead), error: null });
});

// v3.5.b · 人设推断
leadsRouter.post('/:id/infer-persona', async (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!isLeadAccessible(row, req as AuthedRequest)) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }
  try {
    const persona = await inferLeadPersona(row!.id);
    res.json({ success: true, data: persona, error: null });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, data: null, error: msg });
  }
});

leadsRouter.get('/:id/persona', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!isLeadAccessible(row, req as AuthedRequest)) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }
  const persona = getStoredPersona(row!.id);
  res.json({ success: true, data: persona, error: null });
});

leadsRouter.get('/:id', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!isLeadAccessible(row, req as AuthedRequest)) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  res.json({ success: true, data: toLead(row!), error: null });
});

leadsRouter.post('/', (req, res) => {
  const scope = getTenantScope(req as AuthedRequest);
  const body = req.body as CreateLeadBody & { tenant?: string };
  const source = normalizeText(body.source, 50);
  const nickname = normalizeText(body.nickname, 50);
  const contact = normalizeText(body.contact, 100);
  const assignee = normalizeText(body.assignee, 50);
  const lastMessage = normalizeText(body.lastMessage, 1000);
  const intent = body.intent || 'low';
  const status = body.status || 'new';
  const tenant = resolveTenantForWrite(scope, body.tenant);

  if (!source || !nickname) {
    return res.status(400).json({
      success: false,
      data: null,
      error: 'source 和 nickname 为必填项',
    });
  }

  if (!VALID_INTENTS.has(intent)) {
    return res.status(400).json({ success: false, data: null, error: 'intent 非法' });
  }

  if (!VALID_LEAD_STATUSES.has(status)) {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  const result = db
    .prepare(
      `INSERT INTO leads (source, nickname, contact, intent, last_message, status, assignee, tenant, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(
      source,
      nickname,
      contact || null,
      intent,
      lastMessage || '',
      status,
      assignee || null,
      tenant
    );

  const created = getLeadRow(String(result.lastInsertRowid));
  res.status(201).json({ success: true, data: created ? toLead(created) : null, error: null });
});

leadsRouter.patch('/:id', (req, res) => {
  const existing = getLeadRow(req.params.id, req as AuthedRequest);
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const body = req.body as UpdateLeadBody;
  const source = normalizeText(body.source, 50);
  const nickname = normalizeText(body.nickname, 50);
  const contact = normalizeText(body.contact, 100);
  const assignee = normalizeText(body.assignee, 50);
  const lastMessage = normalizeText(body.lastMessage, 1000);

  if (body.intent && !VALID_INTENTS.has(body.intent)) {
    return res.status(400).json({ success: false, data: null, error: 'intent 非法' });
  }

  if (body.status && !VALID_LEAD_STATUSES.has(body.status)) {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  db.prepare(
    `UPDATE leads
     SET source = ?, nickname = ?, contact = ?, intent = ?, last_message = ?, status = ?, assignee = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    source ?? existing.source,
    nickname ?? existing.nickname,
    contact ?? existing.contact,
    body.intent ?? existing.intent,
    lastMessage ?? existing.last_message,
    body.status ?? existing.status,
    assignee ?? existing.assignee,
    req.params.id
  );

  const updated = getLeadRow(req.params.id, req as AuthedRequest);
  res.json({ success: true, data: updated ? toLead(updated) : null, error: null });
});

leadsRouter.get('/:id/follow-ups', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const followUps = db
    .prepare(
      `SELECT id, lead_id as leadId, channel, content, next_action as nextAction, next_followup_at as nextFollowupAt, created_at as createdAt
       FROM followups
       WHERE lead_id = ?
       ORDER BY id DESC`
    )
    .all(req.params.id);

  res.json({ success: true, data: followUps, error: null });
});

leadsRouter.post('/:id/follow-ups', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const body = req.body as CreateFollowUpBody;
  const channel = body.channel || 'manual';
  const content = normalizeText(body.content, 2000);
  const nextAction = normalizeText(body.nextAction, 200);

  if (!content) {
    return res.status(400).json({ success: false, data: null, error: 'content 为必填项' });
  }

  if (!VALID_CHANNELS.has(channel)) {
    return res.status(400).json({ success: false, data: null, error: 'channel 非法' });
  }

  const result = db
    .prepare(
      `INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      req.params.id,
      channel,
      content,
      nextAction || null,
      body.nextFollowupAt || null
    );

  const created = db
    .prepare(
      `SELECT id, lead_id as leadId, channel, content, next_action as nextAction, next_followup_at as nextFollowupAt, created_at as createdAt
       FROM followups
       WHERE id = ?`
    )
    .get(result.lastInsertRowid);

  res.status(201).json({ success: true, data: created, error: null });
});

leadsRouter.post('/:id/follow-up-actions', (req, res) => {
  const existing = getLeadRow(req.params.id, req as AuthedRequest);
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const body = req.body as SaveFollowUpBody;
  const channel = body.channel || 'manual';
  const content = normalizeText(body.content, 2000);
  const nextAction = normalizeText(body.nextAction, 200);
  const lastMessage = normalizeText(body.lastMessage, 1000);

  if (!content) {
    return res.status(400).json({ success: false, data: null, error: 'content 为必填项' });
  }

  if (!VALID_CHANNELS.has(channel)) {
    return res.status(400).json({ success: false, data: null, error: 'channel 非法' });
  }

  if (body.status && !VALID_LEAD_STATUSES.has(body.status)) {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  const transaction = db.transaction(() => {
    const followUpResult = db.prepare(
      `INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      req.params.id,
      channel,
      content,
      nextAction || null,
      body.nextFollowupAt || null
    );

    db.prepare(
      `UPDATE leads
       SET status = ?, last_message = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.status ?? existing.status,
      lastMessage ?? content,
      req.params.id
    );

    const lead = getLeadRow(req.params.id, req as AuthedRequest);
    const followUp = db.prepare(
      `SELECT id, lead_id as leadId, channel, content, next_action as nextAction, next_followup_at as nextFollowupAt, created_at as createdAt
       FROM followups
       WHERE id = ?`
    ).get(followUpResult.lastInsertRowid);

    return {
      lead: lead ? toLead(lead) : null,
      followUp,
      enrollment: getEnrollment(req.params.id) ?? null,
      payment: getLatestPayment(req.params.id) ?? null,
    };
  });

  const result = transaction();
  res.status(201).json({ success: true, data: result, error: null });
});

leadsRouter.get('/:id/enrollment', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  res.json({ success: true, data: getEnrollment(req.params.id) ?? null, error: null });
});

leadsRouter.post('/:id/enrollment', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const body = req.body as SaveEnrollmentBody;
  const schoolName = normalizeText(body.schoolName, 100) ?? '';
  const majorName = normalizeText(body.majorName, 100) ?? '';
  const note = normalizeText(body.note, 500);
  const stage = body.stage ?? 'consulting';

  if (!VALID_ENROLLMENT_STAGES.has(stage)) {
    return res.status(400).json({ success: false, data: null, error: '报名阶段非法' });
  }

  db.prepare(
    `INSERT INTO enrollments (lead_id, school_name, major_name, stage, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(lead_id) DO UPDATE SET
       school_name = excluded.school_name,
       major_name = excluded.major_name,
       stage = excluded.stage,
       note = excluded.note,
       updated_at = datetime('now')`
  ).run(req.params.id, schoolName, majorName, stage, note ?? null);

  const nextLeadStatus = resolveLeadStatusFromEnrollment(row.status, stage);
  if (nextLeadStatus !== row.status) {
    db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(nextLeadStatus, req.params.id);
  }

  res.json({
    success: true,
    data: {
      enrollment: getEnrollment(req.params.id) ?? null,
      lead: toLead(getLeadRow(req.params.id, req as AuthedRequest) ?? row),
    },
    error: null,
  });
});

leadsRouter.get('/:id/payment', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  res.json({ success: true, data: getLatestPayment(req.params.id) ?? null, error: null });
});

leadsRouter.get('/:id/proposal-card', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  res.json({ success: true, data: getProposalCard(req.params.id), error: null });
});

leadsRouter.post('/:id/proposal-card', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const body = req.body as SaveProposalCardBody;
  const schoolName = normalizeText(body.schoolName, 100) ?? '';
  const majorName = normalizeText(body.majorName, 100) ?? '';
  const duration = normalizeText(body.duration, 50) ?? '';
  const tuitionAmount = Number(body.tuitionAmount ?? 0);
  const serviceAmount = Number(body.serviceAmount ?? 0);
  const totalAmount = tuitionAmount + serviceAmount;
  const paymentMethod = body.paymentMethod ?? '全款';
  const installmentsNote = normalizeText(body.installmentsNote, 300);
  const suitableFor = normalizeText(body.suitableFor, 300);
  const riskNote = normalizeText(body.riskNote, 300);
  const proposalText = normalizeText(body.proposalText, 4000) ?? '';
  const copyText = normalizeText(body.copyText, 4000) ?? proposalText;

  if (![tuitionAmount, serviceAmount, totalAmount].every((value) => Number.isFinite(value) && value >= 0)) {
    return res.status(400).json({ success: false, data: null, error: '金额非法' });
  }

  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({ success: false, data: null, error: '缴费方式非法' });
  }

  db.prepare(
    `INSERT INTO proposal_cards (
      lead_id, school_name, major_name, duration, tuition_amount, service_amount,
      total_amount, payment_method, installments_note, suitable_for, risk_note,
      proposal_text, copy_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(lead_id) DO UPDATE SET
      school_name = excluded.school_name,
      major_name = excluded.major_name,
      duration = excluded.duration,
      tuition_amount = excluded.tuition_amount,
      service_amount = excluded.service_amount,
      total_amount = excluded.total_amount,
      payment_method = excluded.payment_method,
      installments_note = excluded.installments_note,
      suitable_for = excluded.suitable_for,
      risk_note = excluded.risk_note,
      proposal_text = excluded.proposal_text,
      copy_text = excluded.copy_text,
      updated_at = datetime('now')`
  ).run(
    req.params.id,
    schoolName,
    majorName,
    duration,
    tuitionAmount,
    serviceAmount,
    totalAmount,
    paymentMethod,
    installmentsNote ?? null,
    suitableFor ?? null,
    riskNote ?? null,
    proposalText,
    copyText
  );

  res.json({ success: true, data: getProposalCard(req.params.id), error: null });
});

leadsRouter.post('/:id/payment', (req, res) => {
  const row = getLeadRow(req.params.id, req as AuthedRequest);
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '线索不存在' });
  }

  const body = req.body as SavePaymentBody;
  const totalAmount = Number(body.totalAmount ?? 0);
  const paidAmount = Number(body.paidAmount ?? 0);
  const method = body.method ?? '全款';
  const note = normalizeText(body.note, 500);

  if (!Number.isFinite(totalAmount) || totalAmount < 0 || !Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalAmount) {
    return res.status(400).json({ success: false, data: null, error: '金额非法，已收金额不能大于应收金额' });
  }

  if (!VALID_PAYMENT_METHODS.has(method)) {
    return res.status(400).json({ success: false, data: null, error: '缴费方式非法' });
  }

  const result = db.prepare(
    `INSERT INTO payment_records (lead_id, total_amount, paid_amount, method, first_paid_at, next_payment_due_at, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(req.params.id, totalAmount, paidAmount, method, body.firstPaidAt ?? null, body.nextPaymentDueAt ?? null, note ?? null);

  const payment = db.prepare(
    `SELECT id, lead_id as leadId, total_amount as totalAmount, paid_amount as paidAmount, method, first_paid_at as firstPaidAt, next_payment_due_at as nextPaymentDueAt, note, created_at as createdAt, updated_at as updatedAt
     FROM payment_records
     WHERE id = ?`
  ).get(result.lastInsertRowid);

  const nextLeadStatus = resolveLeadStatusFromPayment(row.status, paidAmount);
  if (nextLeadStatus !== row.status) {
    db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(nextLeadStatus, req.params.id);
  }

  res.status(201).json({
    success: true,
    data: {
      payment,
      lead: toLead(getLeadRow(req.params.id, req as AuthedRequest) ?? row),
    },
    error: null,
  });
});
