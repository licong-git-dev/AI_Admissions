/**
 * 学员评价系统（v3.6.a）
 *
 * 三层路由：
 * - 学员侧（require student token）：POST /api/student/evaluations · 提交一次评价（每月限 1 次）
 * - 后台（admin/tenant_admin）：GET /api/evaluations · 看本租户的评价 + 统计
 * - 平台（platform admin）：GET /api/platform/evaluations/by-tenant · 跨租户对比 + 黑名单风险
 *
 * 业务逻辑：
 * - 5 维度打分（1-5 分）：顾问态度 / 学习指导 / 缴费透明 / 材料办理 / 总体
 * - 任一维度 ≤ 2 自动标 is_complaint = 1
 * - 平均分自动算
 * - 一个 lead 每月只能评 1 次（防刷）
 */

import { Router } from 'express';
import { db } from '../db';
import type { AuthedRequest } from '../middleware/auth';
import { requireStudent } from './student-auth';

export const studentEvaluationRouter = Router();

studentEvaluationRouter.use(requireStudent);

studentEvaluationRouter.get('/eligible', (req, res) => {
  const phone = (req as AuthedRequest).user!.phone!;
  type LeadRow = { id: number; tenant: string; status: string };
  const lead = db.prepare(
    `SELECT id, tenant, status FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`
  ).get(phone) as LeadRow | undefined;

  if (!lead) {
    return res.json({ success: true, data: { eligible: false, reason: 'no_lead' }, error: null });
  }
  // 仅 enrolled 及之后状态的学员可以评价
  if (!['enrolled', 'studying', 'graduated'].includes(lead.status)) {
    return res.json({
      success: true,
      data: { eligible: false, reason: 'not_enrolled', currentStatus: lead.status },
      error: null,
    });
  }

  // 本月是否已评
  type CountRow = { c: number };
  const recent = db.prepare(
    `SELECT COUNT(*) as c FROM student_evaluations
     WHERE lead_id = ? AND datetime(created_at) > datetime('now', '-30 days')`
  ).get(lead.id) as CountRow;

  if (recent.c > 0) {
    type LastRow = { created_at: string };
    const last = db.prepare(
      `SELECT created_at FROM student_evaluations WHERE lead_id = ? ORDER BY id DESC LIMIT 1`
    ).get(lead.id) as LastRow;
    return res.json({
      success: true,
      data: { eligible: false, reason: 'recently_evaluated', lastAt: last.created_at },
      error: null,
    });
  }

  res.json({ success: true, data: { eligible: true, leadId: lead.id }, error: null });
});

const validScore = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 0;
};

studentEvaluationRouter.post('/', (req, res) => {
  const phone = (req as AuthedRequest).user!.phone!;
  type LeadRow = { id: number; tenant: string; status: string };
  const lead = db.prepare(
    `SELECT id, tenant, status FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`
  ).get(phone) as LeadRow | undefined;

  if (!lead) {
    return res.status(400).json({ success: false, data: null, error: '未找到您的报名记录' });
  }
  if (!['enrolled', 'studying', 'graduated'].includes(lead.status)) {
    return res.status(400).json({ success: false, data: null, error: '完成报名后才可评价' });
  }

  type CountRow = { c: number };
  const recent = db.prepare(
    `SELECT COUNT(*) as c FROM student_evaluations
     WHERE lead_id = ? AND datetime(created_at) > datetime('now', '-30 days')`
  ).get(lead.id) as CountRow;
  if (recent.c > 0) {
    return res.status(429).json({ success: false, data: null, error: '本月已评价过，30 天后可再提交' });
  }

  const body = req.body as {
    scoreAdvisor?: number;
    scoreLearning?: number;
    scorePayment?: number;
    scoreMaterials?: number;
    scoreOverall?: number;
    feedback?: string;
  };

  const scores = {
    advisor: validScore(body.scoreAdvisor),
    learning: validScore(body.scoreLearning),
    payment: validScore(body.scorePayment),
    materials: validScore(body.scoreMaterials),
    overall: validScore(body.scoreOverall),
  };

  const allValid = Object.values(scores).every((v) => v > 0);
  if (!allValid) {
    return res.status(400).json({ success: false, data: null, error: '5 项评分均必填，每项 1-5 分' });
  }

  const avg = Number((Object.values(scores).reduce((a, b) => a + b, 0) / 5).toFixed(2));
  const isComplaint = Object.values(scores).some((v) => v <= 2) ? 1 : 0;
  const feedback = typeof body.feedback === 'string' ? body.feedback.slice(0, 500) : null;

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
  const ua = (req.headers['user-agent'] as string) || null;

  const result = db.prepare(`
    INSERT INTO student_evaluations (
      tenant, lead_id, phone,
      score_advisor, score_learning, score_payment, score_materials, score_overall,
      avg_score, feedback, is_complaint, is_published, ip, ua, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))
  `).run(
    lead.tenant, lead.id, phone,
    scores.advisor, scores.learning, scores.payment, scores.materials, scores.overall,
    avg, feedback, isComplaint, ip, ua
  );

  res.status(201).json({
    success: true,
    data: {
      id: Number(result.lastInsertRowid),
      avgScore: avg,
      isComplaint: isComplaint === 1,
    },
    error: null,
  });
});

// 后台路由（admin / tenant_admin）
export const adminEvaluationRouter = Router();

adminEvaluationRouter.get('/', (req, res) => {
  const user = (req as AuthedRequest).user!;
  const tenant = user.tenant ?? 'default';
  const isPlatformAdmin = user.role === 'admin' && tenant === 'platform';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));

  const where = isPlatformAdmin ? '' : `WHERE e.tenant = '${tenant.replace(/'/g, "''")}'`;

  type Row = {
    id: number;
    tenant: string;
    lead_id: number;
    nickname: string;
    score_advisor: number;
    score_learning: number;
    score_payment: number;
    score_materials: number;
    score_overall: number;
    avg_score: number;
    feedback: string | null;
    is_complaint: number;
    created_at: string;
  };

  const rows = db.prepare(`
    SELECT e.id, e.tenant, e.lead_id, l.nickname,
           e.score_advisor, e.score_learning, e.score_payment, e.score_materials, e.score_overall,
           e.avg_score, e.feedback, e.is_complaint, e.created_at
    FROM student_evaluations e
    JOIN leads l ON l.id = e.lead_id
    ${where}
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(limit) as Row[];

  // 统计
  type AggRow = { c: number; avg: number; complaints: number };
  const agg = db.prepare(`
    SELECT COUNT(*) as c, COALESCE(AVG(avg_score), 0) as avg, SUM(is_complaint) as complaints
    FROM student_evaluations e
    ${where}
  `).get() as AggRow;

  res.json({
    success: true,
    data: {
      stats: {
        total: agg.c,
        avgScore: Number(agg.avg.toFixed(2)),
        complaints: agg.complaints,
        complaintRate: agg.c === 0 ? 0 : Number(((agg.complaints / agg.c) * 100).toFixed(1)),
      },
      evaluations: rows.map((r) => ({
        id: r.id,
        tenant: r.tenant,
        leadId: r.lead_id,
        nickname: r.nickname,
        scores: {
          advisor: r.score_advisor,
          learning: r.score_learning,
          payment: r.score_payment,
          materials: r.score_materials,
          overall: r.score_overall,
        },
        avgScore: r.avg_score,
        feedback: r.feedback,
        isComplaint: r.is_complaint === 1,
        createdAt: r.created_at,
      })),
    },
    error: null,
  });
});

// 平台跨租户对比（仅 platform admin）
adminEvaluationRouter.get('/by-tenant', (req, res) => {
  const user = (req as AuthedRequest).user!;
  const isPlatformAdmin = user.role === 'admin' && user.tenant === 'platform';
  if (!isPlatformAdmin) {
    return res.status(403).json({ success: false, data: null, error: '仅甲方可访问' });
  }

  type Row = {
    tenant: string;
    total: number;
    avg_score: number;
    complaints: number;
    avg_advisor: number;
    avg_learning: number;
    avg_payment: number;
    avg_materials: number;
  };
  const rows = db.prepare(`
    SELECT
      tenant,
      COUNT(*) as total,
      ROUND(AVG(avg_score), 2) as avg_score,
      SUM(is_complaint) as complaints,
      ROUND(AVG(score_advisor), 2) as avg_advisor,
      ROUND(AVG(score_learning), 2) as avg_learning,
      ROUND(AVG(score_payment), 2) as avg_payment,
      ROUND(AVG(score_materials), 2) as avg_materials
    FROM student_evaluations
    GROUP BY tenant
    ORDER BY avg_score ASC
  `).all() as Row[];

  res.json({
    success: true,
    data: rows.map((r) => ({
      tenant: r.tenant,
      total: r.total,
      avgScore: r.avg_score,
      complaints: r.complaints,
      complaintRate: r.total === 0 ? 0 : Number(((r.complaints / r.total) * 100).toFixed(1)),
      avgAdvisor: r.avg_advisor,
      avgLearning: r.avg_learning,
      avgPayment: r.avg_payment,
      avgMaterials: r.avg_materials,
      // 黑名单风险标识：投诉率 ≥ 30% 或平均分 < 3
      atRisk: r.total >= 3 && (
        (r.complaints / r.total) >= 0.3 || r.avg_score < 3
      ),
    })),
    error: null,
  });
});
