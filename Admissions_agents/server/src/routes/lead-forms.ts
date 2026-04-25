import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { db } from '../db';
import { config } from '../config';
import { loadActiveViolationWords } from './violation-words';
import { enqueueJob } from '../../worker/job-queue';
import { bindReferralOnLead } from '../services/referral-service';

type LeadFormRow = {
  id: number;
  type: string;
  name: string;
  fields_json: string;
  agreement_id: number;
  is_active: number;
  tenant: string;
  created_at: string;
  updated_at: string;
};

const MODEL = 'gemini-2.5-flash-preview-04-17';
const PHONE_REGEX = /^1[3-9]\d{9}$/;

const toForm = (row: LeadFormRow) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  fields: JSON.parse(row.fields_json),
  agreementId: row.agreement_id,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getClient = () => {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY 未配置');
  }
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
};

const buildAssessmentPrompt = (answers: Record<string, string>): string => {
  return `你是招生顾问"废才"，基于学员的测评答案，生成一份个性化的专业匹配报告。

学员答案：
${JSON.stringify(answers, null, 2)}

要求：
1. 直接输出 JSON，不要使用 markdown 围栏。
2. 报告必须诚恳，不使用"包过""100%通过""保录取"等违规词。
3. 字段约定：
{
  "matchedMajors": [{"name": "专业名", "reason": "推荐理由（不超过 50 字）"}],
  "suggestedSchoolLevel": "建议报考的院校层次（开放大学 / 普通本科 / 211 等）",
  "timeline": "建议的学习时间规划",
  "concerns": ["基于答案识别出的 2-3 个主要顾虑"],
  "nextStep": "一句话建议下一步动作"
}

只输出合法 JSON，不要任何前后文。`;
};

const sanitize = (text: string, words: string[]): string => {
  let result = text;
  for (const word of words) {
    if (!word) continue;
    result = result.split(word).join('[已过滤]');
  }
  return result;
};

const sanitizeObject = <T>(value: T, words: string[]): T => {
  if (typeof value === 'string') {
    return sanitize(value, words) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item, words)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeObject(val, words);
    }
    return result as unknown as T;
  }
  return value;
};

export const leadFormsRouter = Router();

// 软转化 CTA 记录（H5 测评三档漏斗的第 2/3 档，不触达支付）
// 公开端点：学员测评完后可调用
leadFormsRouter.post('/soft-cta', (req, res) => {
  const body = req.body as { phone?: string; leadId?: number; action?: string };
  if (!body.phone || !body.action) {
    return res.status(400).json({ success: false, data: null, error: 'phone 和 action 必填' });
  }
  if (!/^1[3-9]\d{9}$/.test(body.phone)) {
    return res.status(400).json({ success: false, data: null, error: '手机号格式非法' });
  }

  const validActions = new Set(['add_advisor_wechat', 'subscribe_newsletter']);
  if (!validActions.has(body.action)) {
    return res.status(400).json({ success: false, data: null, error: 'action 非法' });
  }

  const lead = body.leadId
    ? db.prepare(`SELECT id, tenant, last_message FROM leads WHERE id = ?`).get(body.leadId) as { id: number; tenant: string; last_message: string } | undefined
    : db.prepare(`SELECT id, tenant, last_message FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`).get(body.phone) as { id: number; tenant: string; last_message: string } | undefined;

  if (lead) {
    const actionLabel = body.action === 'add_advisor_wechat' ? '软转化 · 申请加顾问微信' : '软转化 · 订阅政策提醒';
    db.prepare(`
      INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
      VALUES (?, 'system', ?, ?, datetime('now', '+1 day'), datetime('now'))
    `).run(lead.id, actionLabel, body.action === 'add_advisor_wechat' ? '主动电话 / 企微添加好友' : '下次政策更新时短信推送');

    // 如果是加微信，提升意向等级到 high
    if (body.action === 'add_advisor_wechat') {
      db.prepare(`UPDATE leads SET intent = 'high', updated_at = datetime('now') WHERE id = ? AND intent != 'high'`).run(lead.id);
    }
  }

  res.json({ success: true, data: { action: body.action, leadUpdated: Boolean(lead) }, error: null });
});

leadFormsRouter.get('/', (req, res) => {
  const { type, active } = req.query;
  const filters: string[] = [];
  const params: string[] = [];

  if (typeof type === 'string' && type) {
    filters.push('type = ?');
    params.push(type);
  }
  if (active === 'true') {
    filters.push('is_active = 1');
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM lead_forms ${where} ORDER BY id DESC`).all(...params) as LeadFormRow[];

  res.json({ success: true, data: rows.map(toForm), error: null });
});

leadFormsRouter.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM lead_forms WHERE id = ?`).get(req.params.id) as LeadFormRow | undefined;
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '表单不存在' });
  }

  const agreement = db.prepare(`SELECT type, version, content FROM agreements WHERE id = ?`).get(row.agreement_id) as {
    type: string;
    version: string;
    content: string;
  } | undefined;

  res.json({
    success: true,
    data: { ...toForm(row), agreement },
    error: null,
  });
});

leadFormsRouter.post('/:id/submit', async (req, res, next) => {
  try {
    const form = db.prepare(`SELECT * FROM lead_forms WHERE id = ?`).get(req.params.id) as LeadFormRow | undefined;
    if (!form) {
      return res.status(404).json({ success: false, data: null, error: '表单不存在' });
    }

    if (form.is_active !== 1) {
      return res.status(400).json({ success: false, data: null, error: '表单已下线' });
    }

    const body = req.body as {
      phone?: string;
      answers?: Record<string, string>;
      consentChecked?: boolean;
      referralCode?: string;
    };

    if (!body.phone || !PHONE_REGEX.test(body.phone)) {
      return res.status(400).json({ success: false, data: null, error: '手机号格式非法' });
    }

    if (!body.answers || typeof body.answers !== 'object') {
      return res.status(400).json({ success: false, data: null, error: 'answers 必填' });
    }

    if (body.consentChecked !== true) {
      return res.status(400).json({ success: false, data: null, error: '必须勾选授权协议' });
    }

    const fields = JSON.parse(form.fields_json) as Array<{ key: string; label: string; options: string[] }>;
    for (const field of fields) {
      if (!body.answers[field.key] || !field.options.includes(body.answers[field.key])) {
        return res.status(400).json({ success: false, data: null, error: `字段 ${field.key} 答案非法或缺失` });
      }
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    const transaction = db.transaction(() => {
      const consentResult = db.prepare(`
        INSERT INTO consents (phone, agreement_id, ip, ua, checked_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(body.phone, form.agreement_id, ip, ua);

      const leadResult = db.prepare(`
        INSERT INTO leads (source, nickname, contact, intent, last_message, status, assignee, tenant, created_at, updated_at)
        VALUES (?, ?, ?, 'medium', ?, 'new', NULL, ?, datetime('now'), datetime('now'))
      `).run(
        `留资-${form.type}`,
        body.phone!.slice(-4),
        body.phone!,
        `通过「${form.name}」提交留资`,
        form.tenant || 'default'
      );

      const submissionResult = db.prepare(`
        INSERT INTO lead_submissions (form_id, phone, answers_json, consent_id, lead_id, ip, ua, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        form.id,
        body.phone!,
        JSON.stringify(body.answers),
        consentResult.lastInsertRowid,
        leadResult.lastInsertRowid,
        ip,
        ua
      );

      return {
        consentId: Number(consentResult.lastInsertRowid),
        leadId: Number(leadResult.lastInsertRowid),
        submissionId: Number(submissionResult.lastInsertRowid),
      };
    });

    const { consentId, leadId, submissionId } = transaction();

    // v3.3.c · 转介绍：携带 referralCode 时尝试绑定（失败不影响主流程）
    let referralBound: { code: string; referrerName: string } | null = null;
    if (body.referralCode) {
      try {
        const trimmed = String(body.referralCode).trim().toUpperCase();
        if (trimmed.length >= 4) {
          const result = bindReferralOnLead(leadId, trimmed);
          if (result.bound && result.codeRecord) {
            referralBound = { code: result.codeRecord.code, referrerName: result.codeRecord.referrerName };
          }
        }
      } catch (err) {
        console.warn('[lead-forms] 绑定推荐码失败', err);
      }
    }

    let report: Record<string, unknown> = {};
    const violationWords = loadActiveViolationWords();
    try {
      const prompt = buildAssessmentPrompt(body.answers!);
      const response = await getClient().models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(response.text || '{}') as Record<string, unknown>;
      report = sanitizeObject(parsed, violationWords);
    } catch (error) {
      report = {
        matchedMajors: [{ name: '待人工顾问确认', reason: 'AI 暂时不可用，我们已收到你的信息' }],
        suggestedSchoolLevel: '待人工顾问确认',
        timeline: '稍后顾问会与您联系',
        concerns: ['AI 生成暂不可用'],
        nextStep: '等待专员联系',
      };
      console.error('[lead-forms] 生成测评报告失败', error);
    }

    db.prepare(`UPDATE lead_submissions SET report_json = ? WHERE id = ?`).run(JSON.stringify(report), submissionId);

    // 入队 24h 后的第一轮定金催付提醒（若学员在此期间支付，handler 会自动 skip）
    try {
      enqueueJob({
        name: 'deposit.remind_unpaid',
        payload: { phone: body.phone, leadId, sequenceIndex: 0 },
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        singletonKey: `deposit-remind:${body.phone}:0`,
      });
    } catch (err) {
      console.warn('[lead-forms] 入队催付任务失败', err);
    }

    res.status(201).json({
      success: true,
      data: { leadId, consentId, submissionId, report, referral: referralBound },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});
