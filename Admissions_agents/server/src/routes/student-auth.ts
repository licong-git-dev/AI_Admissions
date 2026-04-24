import { Router, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { signJwt, verifyJwt, type JwtPayload } from '../services/jwt';
import { sendOtpSms, getAliyunSmsConfig } from '../services/sms';
import type { AuthedRequest } from '../middleware/auth';

const PHONE_REGEX = /^1[3-9]\d{9}$/;
const CODE_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const STUDENT_SESSION_TTL_SECONDS = 12 * 60 * 60;

const generateCode = (): string => {
  return String(100000 + crypto.randomInt(900000));
};

export const studentAuthRouter = Router();

studentAuthRouter.post('/request-code', async (req, res) => {
  const body = req.body as { phone?: string };
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

  if (!PHONE_REGEX.test(phone)) {
    return res.status(400).json({ success: false, data: null, error: '手机号格式非法' });
  }

  const recent = db.prepare(`
    SELECT COUNT(*) as count FROM student_otp_codes
    WHERE phone = ? AND datetime(created_at) > datetime('now', '-1 minute')
  `).get(phone) as { count: number };

  if (recent.count > 0) {
    return res.status(429).json({ success: false, data: null, error: '发送频率过高，请 1 分钟后再试' });
  }

  const code = generateCode();
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
  const ua = (req.headers['user-agent'] as string) || null;

  db.prepare(`
    INSERT INTO student_otp_codes (phone, code, expires_at, ip, ua, created_at)
    VALUES (?, ?, datetime('now', '+5 minutes'), ?, ?, datetime('now'))
  `).run(phone, code, ip, ua);

  const smsResult = await sendOtpSms(phone, code, CODE_TTL_SECONDS);
  const isStub = smsResult.stub === true;

  if (!isStub && !smsResult.success) {
    console.warn('[student-auth] SMS 发送失败，已写入验证码可手动查询验证', { phone, error: smsResult.error });
  }

  res.json({
    success: true,
    data: {
      phone,
      stub: isStub,
      gateway: getAliyunSmsConfig() ? 'aliyun' : 'stub',
      hint: isStub
        ? `stub 模式：验证码已打印到服务器日志，ttl=${CODE_TTL_SECONDS}s`
        : smsResult.success
          ? '验证码已发送到您的手机'
          : `验证码已生成但短信网关异常：${smsResult.error}`,
    },
    error: null,
  });
});

studentAuthRouter.post('/verify-code', (req, res) => {
  const body = req.body as { phone?: string; code?: string };
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';

  if (!PHONE_REGEX.test(phone) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, data: null, error: '手机号或验证码格式非法' });
  }

  const latest = db.prepare(`
    SELECT id, code, expires_at, attempts, consumed_at
    FROM student_otp_codes
    WHERE phone = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(phone) as { id: number; code: string; expires_at: string; attempts: number; consumed_at: string | null } | undefined;

  if (!latest) {
    return res.status(400).json({ success: false, data: null, error: '请先请求验证码' });
  }

  if (latest.consumed_at) {
    return res.status(400).json({ success: false, data: null, error: '验证码已使用，请重新请求' });
  }

  if (new Date(latest.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ success: false, data: null, error: '验证码已过期，请重新请求' });
  }

  if (latest.attempts >= MAX_ATTEMPTS) {
    return res.status(400).json({ success: false, data: null, error: '验证码错误次数过多，请重新请求' });
  }

  if (latest.code !== code) {
    db.prepare(`UPDATE student_otp_codes SET attempts = attempts + 1 WHERE id = ?`).run(latest.id);
    return res.status(400).json({ success: false, data: null, error: '验证码错误' });
  }

  db.prepare(`UPDATE student_otp_codes SET consumed_at = datetime('now') WHERE id = ?`).run(latest.id);

  type LeadSlim = { id: number; nickname: string; tenant: string };
  const lead = db.prepare(
    `SELECT id, nickname, tenant FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`
  ).get(phone) as LeadSlim | undefined;

  const token = signJwt(
    {
      sub: lead?.id ?? 0,
      username: phone,
      role: 'student',
      name: lead?.nickname ?? `学员-${phone.slice(-4)}`,
      tenant: lead?.tenant ?? 'default',
      kind: 'student',
      leadId: lead?.id ?? 0,
      phone,
    },
    STUDENT_SESSION_TTL_SECONDS
  );

  res.json({
    success: true,
    data: {
      token,
      profile: {
        phone,
        leadId: lead?.id ?? null,
        name: lead?.nickname ?? `学员-${phone.slice(-4)}`,
        tenant: lead?.tenant ?? 'default',
        hasLead: Boolean(lead),
      },
    },
    error: null,
  });
});

export const requireStudent = (req: AuthedRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    res.status(401).json({ success: false, data: null, error: '缺少登录凭证' });
    return;
  }

  const payload = verifyJwt(token);
  if (!payload || payload.kind !== 'student' || !payload.phone) {
    res.status(401).json({ success: false, data: null, error: '登录凭证无效或已过期' });
    return;
  }

  req.user = payload as JwtPayload;
  next();
};

studentAuthRouter.get('/profile', requireStudent, (req: AuthedRequest, res) => {
  const phone = req.user!.phone!;
  const lead = db.prepare(
    `SELECT id, nickname, tenant, status, source, contact FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`
  ).get(phone) as { id: number; nickname: string; tenant: string; status: string; source: string; contact: string } | undefined;

  const enrollment = lead
    ? db.prepare(
        `SELECT school_name as schoolName, major_name as majorName, stage, note FROM enrollments WHERE lead_id = ?`
      ).get(lead.id)
    : null;

  const payment = lead
    ? db.prepare(
        `SELECT total_amount as totalAmount, paid_amount as paidAmount, method, first_paid_at as firstPaidAt, next_payment_due_at as nextPaymentDueAt FROM payment_records WHERE lead_id = ? ORDER BY id DESC LIMIT 1`
      ).get(lead.id)
    : null;

  const materials = lead
    ? db.prepare(
        `SELECT id, name, status, uploaded_at as uploadedAt, note FROM student_materials WHERE lead_id = ? ORDER BY id ASC`
      ).all(lead.id)
    : [];

  const deposits = db.prepare(
    `SELECT id, out_trade_no as outTradeNo, amount, status, paid_at as paidAt, created_at as createdAt FROM deposits WHERE phone = ? ORDER BY id DESC`
  ).all(phone);

  res.json({
    success: true,
    data: {
      phone,
      lead,
      enrollment,
      payment,
      materials,
      deposits,
    },
    error: null,
  });
});
