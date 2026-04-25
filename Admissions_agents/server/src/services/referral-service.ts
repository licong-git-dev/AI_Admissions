/**
 * 学员转介绍裂变服务
 *
 * 业务流：
 * 1. 已成交学员 (lead.status='enrolled') 调 issueOrGetReferralCode 拿到自己的推荐码
 * 2. 学员把推荐码分享出去（H5 测评 ?ref=CODE / 海报二维码）
 * 3. 新人提交测评带 ref=CODE → bindReferralOnLead 把 referred_by_code 写入新 lead
 * 4. 新人最终成交（创建 deal） → triggerRewardOnDeal 写入 referral_rewards 两条记录（推荐人 + 被推荐人）
 * 5. 后台「转介绍管理」可看到所有奖励，标记「已发放」
 *
 * 设计要点：
 * - 推荐码 8 位大写字母数字（去除 0/O/1/I 易混淆字符），冲突重试
 * - 同一被推荐人只能绑定一次（去重保护）
 * - 默认奖励：推荐人 ¥200 / 被推荐人 ¥100（首单），可后续做成可配置
 * - reward 写入时为 pending 状态，财务确认后改 paid
 */

import { db } from '../db';

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉 0/O/1/I

const REFERRER_REWARD_FEN = Number(process.env.REFERRAL_REFERRER_REWARD_FEN ?? 20000);  // ¥200
const REFEREE_REWARD_FEN = Number(process.env.REFERRAL_REFEREE_REWARD_FEN ?? 10000);    // ¥100

const generateCode = (length = 8): string => {
  let s = '';
  for (let i = 0; i < length; i += 1) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
};

export type ReferralCode = {
  id: number;
  tenant: string;
  code: string;
  referrerLeadId: number;
  referrerName: string;
  referrerPhone: string | null;
  invitedCount: number;
  convertedCount: number;
  isActive: boolean;
  createdAt: string;
};

type ReferralCodeRow = {
  id: number;
  tenant: string;
  code: string;
  referrer_lead_id: number;
  referrer_name: string;
  referrer_phone: string | null;
  invited_count: number;
  converted_count: number;
  is_active: number;
  created_at: string;
};

const rowToCode = (row: ReferralCodeRow): ReferralCode => ({
  id: row.id,
  tenant: row.tenant,
  code: row.code,
  referrerLeadId: row.referrer_lead_id,
  referrerName: row.referrer_name,
  referrerPhone: row.referrer_phone,
  invitedCount: row.invited_count,
  convertedCount: row.converted_count,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
});

/**
 * 根据 leadId 拿推荐码（如果没有则生成）
 * 仅 enrolled 状态的 lead 才能签发推荐码
 */
export const issueOrGetReferralCode = (leadId: number): ReferralCode => {
  type LeadRow = { id: number; nickname: string; contact: string | null; status: string; tenant: string };
  const lead = db.prepare(
    `SELECT id, nickname, contact, status, tenant FROM leads WHERE id = ?`
  ).get(leadId) as LeadRow | undefined;

  if (!lead) throw new Error('lead 不存在');
  if (lead.status !== 'enrolled') throw new Error('仅成交学员可签发推荐码');

  const existing = db.prepare(
    `SELECT * FROM referral_codes WHERE referrer_lead_id = ? AND is_active = 1 LIMIT 1`
  ).get(leadId) as ReferralCodeRow | undefined;
  if (existing) return rowToCode(existing);

  // 生成唯一码（最多重试 5 次）
  let code = generateCode();
  for (let i = 0; i < 5; i += 1) {
    const conflict = db.prepare(`SELECT id FROM referral_codes WHERE code = ?`).get(code);
    if (!conflict) break;
    code = generateCode();
  }

  const result = db.prepare(`
    INSERT INTO referral_codes (tenant, code, referrer_lead_id, referrer_name, referrer_phone, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(lead.tenant, code, lead.id, lead.nickname, lead.contact);

  const row = db.prepare(`SELECT * FROM referral_codes WHERE id = ?`).get(Number(result.lastInsertRowid)) as ReferralCodeRow;
  return rowToCode(row);
};

export const getCodeByValue = (code: string): ReferralCode | null => {
  const row = db.prepare(`SELECT * FROM referral_codes WHERE code = ? AND is_active = 1`).get(code.toUpperCase()) as ReferralCodeRow | undefined;
  return row ? rowToCode(row) : null;
};

export const getCodeByLeadId = (leadId: number): ReferralCode | null => {
  const row = db.prepare(`SELECT * FROM referral_codes WHERE referrer_lead_id = ? AND is_active = 1 LIMIT 1`).get(leadId) as ReferralCodeRow | undefined;
  return row ? rowToCode(row) : null;
};

/**
 * 在新 lead 上绑定推荐码（只在 lead 创建时调用一次）
 * - 校验 code 存在
 * - 校验不能自己推荐自己（contact 重复）
 * - 写 leads.referred_by_code，递增 referral_codes.invited_count
 */
export const bindReferralOnLead = (leadId: number, code: string): { bound: boolean; reason?: string; codeRecord?: ReferralCode } => {
  const codeRecord = getCodeByValue(code);
  if (!codeRecord) return { bound: false, reason: 'invalid_code' };

  type LeadRow = { id: number; contact: string | null; referred_by_code: string | null };
  const lead = db.prepare(`SELECT id, contact, referred_by_code FROM leads WHERE id = ?`).get(leadId) as LeadRow | undefined;
  if (!lead) return { bound: false, reason: 'lead_not_found' };

  if (lead.referred_by_code) return { bound: false, reason: 'already_bound' };

  // 防止自荐：被推荐人 contact == 推荐人 contact
  if (lead.contact && codeRecord.referrerPhone && lead.contact === codeRecord.referrerPhone) {
    return { bound: false, reason: 'self_referral' };
  }

  db.prepare(`UPDATE leads SET referred_by_code = ?, updated_at = datetime('now') WHERE id = ?`).run(codeRecord.code, leadId);
  db.prepare(`UPDATE referral_codes SET invited_count = invited_count + 1 WHERE id = ?`).run(codeRecord.id);

  return { bound: true, codeRecord };
};

/**
 * 在 deal 创建后调用，触发奖励
 * - 只在 lead 有 referred_by_code 且对应 referee 还没领过此 deal 的奖励时触发
 * - 写两笔 referral_rewards（referrer + referee 各一笔），状态 pending
 */
export const triggerRewardOnDeal = (dealId: number): { triggered: boolean; rewardIds?: number[]; reason?: string } => {
  type DealRow = { id: number; lead_id: number; tenant: string };
  const deal = db.prepare(`SELECT id, lead_id, tenant FROM deals WHERE id = ?`).get(dealId) as DealRow | undefined;
  if (!deal) return { triggered: false, reason: 'deal_not_found' };

  type LeadRow = { id: number; referred_by_code: string | null };
  const lead = db.prepare(`SELECT id, referred_by_code FROM leads WHERE id = ?`).get(deal.lead_id) as LeadRow | undefined;
  if (!lead || !lead.referred_by_code) return { triggered: false, reason: 'no_referral' };

  const codeRecord = getCodeByValue(lead.referred_by_code);
  if (!codeRecord) return { triggered: false, reason: 'code_inactive' };

  // 防重：同一 deal 不重复触发
  const existing = db.prepare(
    `SELECT id FROM referral_rewards WHERE deal_id = ? LIMIT 1`
  ).get(dealId) as { id: number } | undefined;
  if (existing) return { triggered: false, reason: 'already_rewarded' };

  const insert = db.prepare(`
    INSERT INTO referral_rewards (
      tenant, referral_code_id, referrer_lead_id, referee_lead_id, deal_id,
      reward_for, amount_fen, reward_type, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'pending', datetime('now'))
  `);

  const referrerResult = insert.run(
    deal.tenant, codeRecord.id, codeRecord.referrerLeadId, lead.id, dealId,
    'referrer', REFERRER_REWARD_FEN
  );
  const refereeResult = insert.run(
    deal.tenant, codeRecord.id, codeRecord.referrerLeadId, lead.id, dealId,
    'referee', REFEREE_REWARD_FEN
  );

  // 同时把推荐人的 converted_count + 1
  db.prepare(`UPDATE referral_codes SET converted_count = converted_count + 1 WHERE id = ?`).run(codeRecord.id);

  return {
    triggered: true,
    rewardIds: [Number(referrerResult.lastInsertRowid), Number(refereeResult.lastInsertRowid)],
  };
};

export type ReferralReward = {
  id: number;
  tenant: string;
  referralCodeId: number;
  referralCodeValue: string;
  referrerLeadId: number;
  referrerName: string;
  refereeLeadId: number;
  refereeName: string;
  dealId: number | null;
  rewardFor: 'referrer' | 'referee';
  amountFen: number;
  rewardType: string;
  status: 'pending' | 'paid' | 'voided';
  paidAt: string | null;
  paidBy: number | null;
  note: string | null;
  createdAt: string;
};

type ReferralRewardJoinRow = {
  id: number;
  tenant: string;
  referral_code_id: number;
  code: string;
  referrer_lead_id: number;
  referrer_name: string;
  referee_lead_id: number;
  referee_name: string;
  deal_id: number | null;
  reward_for: string;
  amount_fen: number;
  reward_type: string;
  status: string;
  paid_at: string | null;
  paid_by: number | null;
  note: string | null;
  created_at: string;
};

const rowToReward = (row: ReferralRewardJoinRow): ReferralReward => ({
  id: row.id,
  tenant: row.tenant,
  referralCodeId: row.referral_code_id,
  referralCodeValue: row.code,
  referrerLeadId: row.referrer_lead_id,
  referrerName: row.referrer_name,
  refereeLeadId: row.referee_lead_id,
  refereeName: row.referee_name,
  dealId: row.deal_id,
  rewardFor: (row.reward_for === 'referrer' || row.reward_for === 'referee') ? row.reward_for : 'referrer',
  amountFen: row.amount_fen,
  rewardType: row.reward_type,
  status: (row.status === 'paid' || row.status === 'voided') ? row.status : 'pending',
  paidAt: row.paid_at,
  paidBy: row.paid_by,
  note: row.note,
  createdAt: row.created_at,
});

export const listRewards = (tenant: string, opts: { status?: string; limit?: number } = {}): ReferralReward[] => {
  const status = opts.status;
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const where: string[] = ['rr.tenant = ?'];
  const params: unknown[] = [tenant];
  if (status) { where.push('rr.status = ?'); params.push(status); }

  const rows = db.prepare(`
    SELECT rr.id, rr.tenant, rr.referral_code_id, rc.code,
           rr.referrer_lead_id, l1.nickname as referrer_name,
           rr.referee_lead_id, l2.nickname as referee_name,
           rr.deal_id, rr.reward_for, rr.amount_fen, rr.reward_type,
           rr.status, rr.paid_at, rr.paid_by, rr.note, rr.created_at
    FROM referral_rewards rr
    JOIN referral_codes rc ON rc.id = rr.referral_code_id
    JOIN leads l1 ON l1.id = rr.referrer_lead_id
    JOIN leads l2 ON l2.id = rr.referee_lead_id
    WHERE ${where.join(' AND ')}
    ORDER BY rr.created_at DESC
    LIMIT ?
  `).all(...params, limit) as ReferralRewardJoinRow[];

  return rows.map(rowToReward);
};

export const listRewardsForReferrer = (referrerLeadId: number): ReferralReward[] => {
  const rows = db.prepare(`
    SELECT rr.id, rr.tenant, rr.referral_code_id, rc.code,
           rr.referrer_lead_id, l1.nickname as referrer_name,
           rr.referee_lead_id, l2.nickname as referee_name,
           rr.deal_id, rr.reward_for, rr.amount_fen, rr.reward_type,
           rr.status, rr.paid_at, rr.paid_by, rr.note, rr.created_at
    FROM referral_rewards rr
    JOIN referral_codes rc ON rc.id = rr.referral_code_id
    JOIN leads l1 ON l1.id = rr.referrer_lead_id
    JOIN leads l2 ON l2.id = rr.referee_lead_id
    WHERE rr.referrer_lead_id = ? AND rr.reward_for = 'referrer'
    ORDER BY rr.created_at DESC
    LIMIT 200
  `).all(referrerLeadId) as ReferralRewardJoinRow[];
  return rows.map(rowToReward);
};

export const markRewardPaid = (rewardId: number, paidByUserId: number, note?: string): boolean => {
  const result = db.prepare(`
    UPDATE referral_rewards
    SET status = 'paid', paid_at = datetime('now'), paid_by = ?, note = COALESCE(?, note)
    WHERE id = ? AND status = 'pending'
  `).run(paidByUserId, note ?? null, rewardId);
  return result.changes > 0;
};

export const getReferralStatsForTenant = (tenant: string): {
  totalCodes: number;
  totalInvited: number;
  totalConverted: number;
  pendingRewardsCount: number;
  pendingRewardsFen: number;
  paidRewardsFen: number;
} => {
  type CodeAgg = { c: number; invited: number; converted: number };
  const codes = db.prepare(
    `SELECT COUNT(*) as c, COALESCE(SUM(invited_count), 0) as invited, COALESCE(SUM(converted_count), 0) as converted
       FROM referral_codes WHERE tenant = ? AND is_active = 1`
  ).get(tenant) as CodeAgg;

  type RewardAgg = { c: number; total: number };
  const pending = db.prepare(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_fen), 0) as total FROM referral_rewards WHERE tenant = ? AND status = 'pending'`
  ).get(tenant) as RewardAgg;
  const paid = db.prepare(
    `SELECT COUNT(*) as c, COALESCE(SUM(amount_fen), 0) as total FROM referral_rewards WHERE tenant = ? AND status = 'paid'`
  ).get(tenant) as RewardAgg;

  return {
    totalCodes: codes.c,
    totalInvited: codes.invited,
    totalConverted: codes.converted,
    pendingRewardsCount: pending.c,
    pendingRewardsFen: pending.total,
    paidRewardsFen: paid.total,
  };
};
