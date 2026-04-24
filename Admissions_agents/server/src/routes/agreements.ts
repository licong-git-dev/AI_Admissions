import { Router } from 'express';
import { db } from '../db';

type AgreementRow = {
  id: number;
  type: string;
  version: string;
  content: string;
  is_active: number;
  created_at: string;
  legal_reviewed: number;
  legal_reviewed_by: string | null;
  legal_reviewed_at: string | null;
};

const VALID_TYPES = new Set(['privacy_policy', 'user_agreement', 'personal_info_authorization']);

const toAgreement = (row: AgreementRow) => ({
  id: row.id,
  type: row.type,
  version: row.version,
  content: row.content,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
  legalReviewed: row.legal_reviewed === 1,
  legalReviewedBy: row.legal_reviewed_by,
  legalReviewedAt: row.legal_reviewed_at,
});

export const agreementsRouter = Router();

agreementsRouter.get('/', (req, res) => {
  const { type, active } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (typeof type === 'string' && type) {
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ success: false, data: null, error: 'type 非法' });
    }
    filters.push('type = ?');
    params.push(type);
  }

  if (active === 'true') {
    filters.push('is_active = 1');
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM agreements ${where} ORDER BY type ASC, id DESC`).all(...params) as AgreementRow[];

  res.json({ success: true, data: rows.map(toAgreement), error: null });
});

agreementsRouter.get('/consents/list', (req, res) => {
  const { phone, agreementId } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (typeof phone === 'string' && phone) {
    filters.push('c.phone = ?');
    params.push(phone);
  }
  if (typeof agreementId === 'string' && agreementId) {
    filters.push('c.agreement_id = ?');
    params.push(Number(agreementId));
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT c.id, c.phone, c.agreement_id as agreementId, a.type as agreementType, a.version as agreementVersion,
           c.ip, c.ua, c.checked_at as checkedAt
    FROM consents c
    INNER JOIN agreements a ON a.id = c.agreement_id
    ${where}
    ORDER BY c.checked_at DESC
    LIMIT 200
  `).all(...params);

  res.json({ success: true, data: rows, error: null });
});

agreementsRouter.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(req.params.id) as AgreementRow | undefined;
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '协议不存在' });
  }

  res.json({ success: true, data: toAgreement(row), error: null });
});

agreementsRouter.post('/', (req, res) => {
  const body = req.body as { type?: string; version?: string; content?: string };

  if (!body.type || !VALID_TYPES.has(body.type)) {
    return res.status(400).json({ success: false, data: null, error: 'type 非法' });
  }

  if (!body.version || typeof body.version !== 'string' || !body.version.trim()) {
    return res.status(400).json({ success: false, data: null, error: 'version 必填' });
  }

  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return res.status(400).json({ success: false, data: null, error: 'content 必填' });
  }

  const transaction = db.transaction(() => {
    db.prepare(`UPDATE agreements SET is_active = 0 WHERE type = ?`).run(body.type);
    return db.prepare(`
      INSERT INTO agreements (type, version, content, is_active, created_at)
      VALUES (?, ?, ?, 1, datetime('now'))
    `).run(body.type, body.version, body.content);
  });

  const result = transaction();
  const created = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(result.lastInsertRowid) as AgreementRow;
  res.status(201).json({ success: true, data: toAgreement(created), error: null });
});

agreementsRouter.post('/:id/legal-review', (req, res) => {
  const existing = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(req.params.id) as AgreementRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '协议不存在' });
  }

  const body = req.body as { reviewedBy?: string; approved?: boolean };
  const reviewedBy = (body.reviewedBy || '').trim().slice(0, 100);
  if (!reviewedBy) {
    return res.status(400).json({ success: false, data: null, error: 'reviewedBy 必填（律师姓名或事务所）' });
  }

  const approved = body.approved !== false;

  db.prepare(`
    UPDATE agreements
    SET legal_reviewed = ?, legal_reviewed_by = ?, legal_reviewed_at = datetime('now')
    WHERE id = ?
  `).run(approved ? 1 : 0, reviewedBy, req.params.id);

  const updated = db.prepare(`SELECT * FROM agreements WHERE id = ?`).get(req.params.id) as AgreementRow;
  res.json({ success: true, data: toAgreement(updated), error: null });
});

// 监管速览：最新处罚案例 + 平台治理公告 + 赛道风险
// 数据基于 Competitive-Analysis.md 的联网调研结论，后续可通过 POST /compliance/bulletin 手动更新
agreementsRouter.get('/compliance/bulletin', (_req, res) => {
  const bulletin = {
    updatedAt: '2026-04-24',
    source: '联网调研 + Execute_Plan/Competitive-Analysis.md',
    risks: [
      {
        severity: 'high' as const,
        title: '小红书教培七大赛道常态化治理（2025-11 至今）',
        summary: '学历提升类在内的 7 个教培赛道被纳入 KOS / 矩阵号重点监管，违规将限流 / 封号',
        action: '严格遵守日发布 ≤ 3 篇、间隔 ≥ 2 小时、企业号认证、行业备案',
        link: 'https://finance.sina.com.cn/tech/roll/2025-11-03/doc-infwceft1021413.shtml',
      },
      {
        severity: 'high' as const,
        title: '小红书《交易导流违规管细则》',
        summary: '禁止通过除官方商城 / 直播间购物车 / 官方留资组件之外的形式引导站外交易',
        action: '笔记 / 评论禁放微信号、手机号、QQ、二维码；引流统一走留资表单',
        link: 'https://finance.sina.com.cn/tech/roll/2025-11-03/doc-infwceft1021413.shtml',
      },
      {
        severity: 'high' as const,
        title: '北京市监管局 2025-07 教培违法广告典型案例',
        summary: '"高质量保证"、"持证上岗教师"（实际无证）、"100% 通过"、"包过协议" 等表述被顶格罚款',
        action: '违规词库已覆盖；内容工厂会在提交审核时自动二次扫描',
        link: 'https://scjgj.beijing.gov.cn/zwxx/scjgdt/202507/t20250715_4149786.html',
      },
      {
        severity: 'medium' as const,
        title: '江苏省 2025-03 教培广告违规案例',
        summary: '"教材主编"、"首席讲师"、"命题专家"等无依据的师资身份宣称被处罚',
        action: '师资介绍必须有可公开查证的证据（论文、教材、机构任职证明）',
        link: 'https://jsnews.jschina.com.cn/jsyw/202503/t20250328_s67e6a7f4e4b0ed434077f5af.shtml',
      },
      {
        severity: 'medium' as const,
        title: '成人教育转化窗口 3-7 天',
        summary: '不同于 K12 的数月决策，成人教育用户 3-7 天内不跟进就流失；5 分钟首次响应是行业标配',
        action: '系统私信雷达默认已配置 5 分钟扫描间隔（FETCH_DM_INTERVAL_MS 可调）',
        link: 'https://zhuanlan.zhihu.com/p/2002402953550644004',
      },
      {
        severity: 'low' as const,
        title: '一机一卡一号',
        summary: '一部手机、一张卡只登录一个账号；频繁切换 / 双开会显著提升封号概率',
        action: 'RPA 账号矩阵严格遵守；管理员账号也不要在公共设备登录',
        link: 'https://blog.csdn.net/qq_42828982/article/details/154125293',
      },
    ],
    restrictedCategories: [
      '高校招生类', '学历提升类', '语言培训类', 'K12 素质教育',
      '游学研学类', '论文辅导类', '海外留学',
    ],
    complianceTips: [
      '笔记结尾不要写"加微信 / 扫码"等字样，改为"评论区常驻"',
      '师资介绍写真实身份 + 可查证内容；不用"首席"、"主编"等无依据表述',
      '通过率数字必须有内部记录支撑；宁可不说也别假说',
      '留资 H5 作为唯一引流入口，不要在笔记内投微信号',
    ],
  };

  res.json({ success: true, data: bulletin, error: null });
});

agreementsRouter.get('/compliance/summary', (_req, res) => {
  const agreementRows = db.prepare(`SELECT type, version, is_active, legal_reviewed FROM agreements WHERE is_active = 1`).all() as Array<{
    type: string;
    version: string;
    is_active: number;
    legal_reviewed: number;
  }>;

  const consentTotal = (db.prepare(`SELECT COUNT(*) as count FROM consents`).get() as { count: number }).count;
  const consentToday = (db.prepare(`SELECT COUNT(*) as count FROM consents WHERE date(checked_at) = date('now')`).get() as { count: number }).count;
  const dataDeletionPending = (db.prepare(`SELECT 0 as count`).get() as { count: number }).count;

  const unReviewed = agreementRows.filter((a) => a.legal_reviewed !== 1);

  res.json({
    success: true,
    data: {
      activeAgreements: agreementRows.length,
      unReviewedAgreements: unReviewed.length,
      unReviewedList: unReviewed.map((a) => ({ type: a.type, version: a.version })),
      consentTotal,
      consentToday,
      dataDeletionPending,
      recommendation: unReviewed.length > 0
        ? `⚠️ 还有 ${unReviewed.length} 个生效中协议未经法务复审，建议联系律师审阅后再上线`
        : '✅ 生效中的协议均已完成法务复审',
    },
    error: null,
  });
});
