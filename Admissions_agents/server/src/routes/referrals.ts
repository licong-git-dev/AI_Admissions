import { Router } from 'express';
import { db } from '../db';
import type { AuthedRequest } from '../middleware/auth';
import { requireStudent } from './student-auth';
import {
  bindReferralOnLead,
  getCodeByLeadId,
  getCodeByValue,
  getReferralStatsForTenant,
  issueOrGetReferralCode,
  listRewards,
  listRewardsForReferrer,
  markRewardPaid,
} from '../services/referral-service';

// 公开路由（无需登录）
export const referralsPublicRouter = Router();

// 公开：根据 code 解码出推荐人简介，用于 H5 测评页面 / 海报展示
referralsPublicRouter.get('/by-code/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const record = getCodeByValue(code);
  if (!record) {
    return res.status(404).json({ success: false, data: null, error: '推荐码无效' });
  }
  // 仅返回展示必要的字段（不暴露 leadId / phone）
  res.json({
    success: true,
    data: {
      code: record.code,
      referrerName: record.referrerName,
      tenant: record.tenant,
    },
    error: null,
  });
});

// 学员端路由（需 student token）
export const studentReferralRouter = Router();

studentReferralRouter.use(requireStudent);

// 学员获取自己的推荐码（如未签发则生成；要求 enrolled）
studentReferralRouter.get('/me', (req, res) => {
  const phone = (req as AuthedRequest).user!.phone!;
  type LeadRow = { id: number; status: string; nickname: string };
  const lead = db.prepare(
    `SELECT id, status, nickname FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`
  ).get(phone) as LeadRow | undefined;

  if (!lead) {
    return res.json({ success: true, data: { eligible: false, reason: 'no_lead' }, error: null });
  }
  if (lead.status !== 'enrolled') {
    return res.json({
      success: true,
      data: { eligible: false, reason: 'not_enrolled', currentStatus: lead.status, nickname: lead.nickname },
      error: null,
    });
  }

  const code = issueOrGetReferralCode(lead.id);
  const rewards = listRewardsForReferrer(lead.id);
  const totalEarnedFen = rewards
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + r.amountFen, 0);
  const totalPendingFen = rewards
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + r.amountFen, 0);

  res.json({
    success: true,
    data: {
      eligible: true,
      code: code.code,
      invitedCount: code.invitedCount,
      convertedCount: code.convertedCount,
      totalEarnedFen,
      totalPendingFen,
      rewards: rewards.slice(0, 20),
    },
    error: null,
  });
});

// 后台路由（需 tenant_admin / admin）
export const adminReferralRouter = Router();

adminReferralRouter.get('/stats', (req, res) => {
  const user = (req as AuthedRequest).user!;
  const tenant = user.tenant ?? 'default';
  const stats = getReferralStatsForTenant(tenant);
  res.json({ success: true, data: stats, error: null });
});

adminReferralRouter.get('/rewards', (req, res) => {
  const user = (req as AuthedRequest).user!;
  const tenant = user.tenant ?? 'default';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = Number(req.query.limit ?? 100);
  const list = listRewards(tenant, { status, limit });
  res.json({ success: true, data: list, error: null });
});

adminReferralRouter.post('/rewards/:id/mark-paid', (req, res) => {
  const user = (req as AuthedRequest).user!;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, data: null, error: 'id 非法' });
  }
  const note = typeof (req.body as { note?: string } | undefined)?.note === 'string'
    ? (req.body as { note: string }).note
    : undefined;
  const ok = markRewardPaid(id, user.sub ?? 0, note);
  if (!ok) {
    return res.status(409).json({ success: false, data: null, error: '记录不存在或已发放' });
  }
  res.json({ success: true, data: { id, paid: true }, error: null });
});

// 内部 helper：lead 创建时绑定推荐码（导出供 lead-forms / leads 路由使用）
export const bindReferralIfPresent = (leadId: number, refCode: string | null | undefined): void => {
  if (!refCode) return;
  const trimmed = String(refCode).trim().toUpperCase();
  if (!trimmed || trimmed.length < 4) return;
  bindReferralOnLead(leadId, trimmed);
};

// 后台：列出已签发的推荐码（用于看哪些学员推荐效果好）
adminReferralRouter.get('/codes', (req, res) => {
  const user = (req as AuthedRequest).user!;
  const tenant = user.tenant ?? 'default';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));

  type CodeListRow = {
    id: number;
    code: string;
    referrer_lead_id: number;
    referrer_name: string;
    referrer_phone: string | null;
    invited_count: number;
    converted_count: number;
    is_active: number;
    created_at: string;
  };
  const rows = db.prepare(`
    SELECT id, code, referrer_lead_id, referrer_name, referrer_phone,
           invited_count, converted_count, is_active, created_at
    FROM referral_codes
    WHERE tenant = ?
    ORDER BY converted_count DESC, invited_count DESC, created_at DESC
    LIMIT ?
  `).all(tenant, limit) as CodeListRow[];

  const data = rows.map((r) => ({
    id: r.id,
    code: r.code,
    referrerLeadId: r.referrer_lead_id,
    referrerName: r.referrer_name,
    referrerPhone: r.referrer_phone,
    invitedCount: r.invited_count,
    convertedCount: r.converted_count,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  }));
  res.json({ success: true, data, error: null });
});

// 内部 helper 导出别名
export { getCodeByLeadId };
