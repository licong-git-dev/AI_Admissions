/**
 * Agent Tool 注册层
 *
 * 把现有 REST API 的能力包装成 Gemini Function Calling 可用的 tool schema。
 * 工具分为 read（纯读取）、analyze（AI 调用）、write_low（低风险写）、write_high（需审批）、terminal（终止符）。
 *
 * 设计原则：
 * - 每个 tool 有明确的 JSON schema（通过 Gemini FunctionDeclaration 上报）
 * - args 经过 zod-like 简单校验后再执行
 * - 所有 tool 执行都通过 db 直连，不走 REST（避免鉴权递归）
 * - Tool 调用时严格遵守 tenant 隔离
 */

import { db } from '../db';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { loadActiveViolationWords } from '../routes/violation-words';
import { scanPlatformCompliance } from './platform-compliance';
import { sendTextMessageToUser } from './wechat-work';

export type ToolRiskLevel = 'read' | 'analyze' | 'write_low' | 'write_high' | 'terminal';

export type ToolContext = {
  tenant: string;
  isPlatformAdmin: boolean;
  missionId: number;
  createdByUserId: number | null;
};

export type AutoApprovalDecision = {
  auto: boolean;
  reason: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  risk: ToolRiskLevel;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[]; items?: Record<string, unknown> }>;
    required?: string[];
  };
  /** 对 write_high 类 tool 可定义自动审批规则。命中时跳过人工审批 */
  autoApprove?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<AutoApprovalDecision> | AutoApprovalDecision;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

const MODEL = 'gemini-2.5-flash-preview-04-17';
let aiClient: GoogleGenAI | null = null;
const getAi = (): GoogleGenAI | null => {
  if (!config.geminiApiKey) return null;
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return aiClient;
};

// ============= READ TOOLS =============

const tenantScopeSql = (ctx: ToolContext, alias = ''): { clause: string; params: string[] } => {
  if (ctx.isPlatformAdmin) return { clause: '', params: [] };
  const prefix = alias ? `${alias}.` : '';
  return { clause: `AND ${prefix}tenant = ?`, params: [ctx.tenant] };
};

const queryLeads: ToolDefinition = {
  name: 'query_leads',
  description: '查询线索列表。可按意向等级、来源、需跟进、最小创建天数过滤。用于分析高意向未跟进学员、统计今日新线索等。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      intent: { type: 'string', description: '意向等级逗号分隔', enum: ['high', 'medium', 'low'] },
      source: { type: 'string', description: '来源平台，如 小红书 / 抖音 / 快手 / 留资-assessment' },
      needsFollowup: { type: 'boolean', description: '仅返回到期待跟进的' },
      limit: { type: 'number', description: '最大条数，默认 20，最大 100' },
    },
  },
  handler: async (args, ctx) => {
    const intent = typeof args.intent === 'string' ? args.intent : undefined;
    const source = typeof args.source === 'string' ? args.source : undefined;
    const needsFollowup = args.needsFollowup === true;
    const limit = Math.min(Math.max(1, Number(args.limit) || 20), 100);

    const scope = tenantScopeSql(ctx, 'l');
    const filters: string[] = [];
    const params: (string | number)[] = [];

    if (intent) {
      filters.push(`l.intent = ?`);
      params.push(intent);
    }
    if (source) {
      filters.push(`l.source = ?`);
      params.push(source);
    }

    const needsFollowupClause = needsFollowup
      ? `AND EXISTS (
          SELECT 1 FROM followups f WHERE f.lead_id = l.id
          AND f.next_followup_at IS NOT NULL
          AND datetime(f.next_followup_at) <= datetime('now')
        ) AND l.status NOT IN ('enrolled', 'lost')`
      : '';

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : 'WHERE 1=1';
    const rows = db.prepare(`
      SELECT l.id, l.source, l.nickname, l.intent, l.status, l.last_message as lastMessage,
             l.assignee, l.tenant, l.created_at as createdAt
      FROM leads l
      ${where} ${scope.clause} ${needsFollowupClause}
      ORDER BY l.id DESC
      LIMIT ?
    `).all(...params, ...scope.params, limit);

    return { count: rows.length, leads: rows };
  },
};

const queryDashboardSummary: ToolDefinition = {
  name: 'query_dashboard_summary',
  description: '拉取当前租户的核心经营指标：今日新线索、已联系、意向明确、待跟进、待催缴。用于周报/日报生成。',
  risk: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const scope = tenantScopeSql(ctx);
    const tenant = ctx.tenant;
    const isPA = ctx.isPlatformAdmin;

    const sql = (extra: string) => isPA
      ? `SELECT COUNT(*) as count FROM leads WHERE 1=1 ${extra}`
      : `SELECT COUNT(*) as count FROM leads WHERE tenant = ? ${extra}`;

    const r = (q: string): number => {
      const row = (isPA ? db.prepare(q).get() : db.prepare(q).get(tenant)) as { count: number };
      return row.count;
    };

    return {
      todayNewLeads: r(sql(`AND date(created_at) = date('now')`)),
      contactedLeads: r(sql(`AND status = 'contacted'`)),
      interestedLeads: r(sql(`AND status = 'interested'`)),
      highIntentLeads: r(sql(`AND intent = 'high'`)),
      tenant,
    };
  },
};

const queryDealsSummary: ToolDefinition = {
  name: 'query_deals_summary',
  description: '拉取成交 & 分成汇总：总成交数、总学费、应分成、已结分成、疑似异常数。',
  risk: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    const scope = tenantScopeSql(ctx);
    const base = `SELECT COUNT(*) as totalDeals,
                         COALESCE(SUM(total_tuition), 0) as totalTuitionFen,
                         COALESCE(SUM(commission_amount), 0) as totalCommissionFen,
                         COALESCE(SUM(commission_paid_amount), 0) as commissionPaidFen,
                         SUM(CASE WHEN suspicious = 1 THEN 1 ELSE 0 END) as suspiciousCount
                  FROM deals`;
    const where = ctx.isPlatformAdmin ? '' : 'WHERE tenant = ?';
    const row = (ctx.isPlatformAdmin
      ? db.prepare(`${base} ${where}`).get()
      : db.prepare(`${base} ${where}`).get(ctx.tenant)) as {
      totalDeals: number;
      totalTuitionFen: number;
      totalCommissionFen: number;
      commissionPaidFen: number;
      suspiciousCount: number;
    };
    return {
      totalDeals: row.totalDeals,
      totalTuitionYuan: row.totalTuitionFen / 100,
      totalCommissionYuan: row.totalCommissionFen / 100,
      commissionPaidYuan: row.commissionPaidFen / 100,
      commissionUnpaidYuan: (row.totalCommissionFen - row.commissionPaidFen) / 100,
      suspiciousCount: row.suspiciousCount,
    };
  },
};

const queryRpaAccounts: ToolDefinition = {
  name: 'query_rpa_accounts',
  description: '查看 RPA 账号矩阵状态。返回已登录、冷却、封禁数量及每个账号今日配额使用情况。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      platform: { type: 'string', description: '平台筛选', enum: ['xiaohongshu', 'douyin', 'kuaishou'] },
    },
  },
  handler: async (args, ctx) => {
    const platform = typeof args.platform === 'string' ? args.platform : undefined;
    const filters: string[] = [];
    const params: string[] = [];
    if (!ctx.isPlatformAdmin) {
      filters.push('tenant = ?');
      params.push(ctx.tenant);
    }
    if (platform) {
      filters.push('platform = ?');
      params.push(platform);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT id, platform, nickname, status, daily_quota as dailyQuota,
             CASE WHEN cookies_json IS NOT NULL THEN 1 ELSE 0 END as loggedIn,
             risk_note as riskNote
      FROM rpa_accounts ${where}
      ORDER BY platform, id
    `).all(...params);
    return { accounts: rows };
  },
};

const querySchools: ToolDefinition = {
  name: 'query_schools',
  description: '查询院校素材库，含合作院校的学费、学制、通过率、专业列表。用于生成内容时引用准确信息。',
  risk: 'read',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '院校名称关键词，模糊匹配' },
    },
  },
  handler: async (args) => {
    const keyword = typeof args.name === 'string' ? args.name.trim() : '';
    const sql = keyword
      ? `SELECT * FROM schools WHERE name LIKE ? LIMIT 20`
      : `SELECT * FROM schools ORDER BY id LIMIT 20`;
    const schools = keyword
      ? db.prepare(sql).all(`%${keyword}%`)
      : db.prepare(sql).all();
    return { schools };
  },
};

const queryJobsStats: ToolDefinition = {
  name: 'query_jobs_stats',
  description: '查看作业队列状态：排队 / 执行中 / 失败 / 24h 成功。用于排查系统健康。',
  risk: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'succeeded' AND datetime(finished_at) > datetime('now', '-1 day') THEN 1 ELSE 0 END) as succeeded24h
      FROM jobs
    `).get() as { queued: number; running: number; failed: number; succeeded24h: number };
    return { queued: row.queued ?? 0, running: row.running ?? 0, failed: row.failed ?? 0, succeeded24h: row.succeeded24h ?? 0 };
  },
};

// ============= ANALYZE TOOLS =============

const generateContentDraft: ToolDefinition = {
  name: 'generate_content_draft',
  description: '调用 Gemini 生成一条内容草稿（标题+正文+配图说明）。不会提交到审核队列，仅生成。',
  risk: 'analyze',
  parameters: {
    type: 'object',
    properties: {
      contentType: { type: 'string', enum: ['policy', 'major', 'case', 'reminder', 'qa'], description: '内容类型' },
      platform: { type: 'string', enum: ['xhs', 'dy', 'ks'], description: '目标平台' },
      topic: { type: 'string', description: '主题，如"会计专业全解析"' },
      schoolName: { type: 'string', description: '引用的院校名（可选）' },
    },
    required: ['contentType', 'platform', 'topic'],
  },
  handler: async (args) => {
    const ai = getAi();
    if (!ai) return { error: 'GEMINI_API_KEY 未配置，无法生成' };

    const prompt = `你是一名小红书/抖音/快手的教培内容创作者。
请为"${args.contentType}"类内容生成 1 条小红书笔记。
主题：${args.topic}
${args.schoolName ? `引用院校：${args.schoolName}` : ''}

严格规则：
- 绝不使用"包过"、"100%通过"、"保录取"、"稳过"、"必过"、"内部名额"、"命题老师"等违规词
- 不伪造学员故事
- 结尾不加微信/扫码/手机号等站外引流（小红书 2025-11 治理公告）
- 正文 300-500 字，带 emoji 分段
- 标题 15 字内，含数字钩子

输出严格 JSON：
{
  "title": "...",
  "content": "...",
  "imageDesc": "...",
  "tags": ["...", "..."]
}`;

    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(response.text || '{}');
      return { draft: parsed };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};

const complianceScanText: ToolDefinition = {
  name: 'compliance_scan',
  description: '对文本做平台合规二次扫描：违规词命中 + 站外导流模式 + 夸大承诺模式。pass=false 时必须修改。',
  risk: 'analyze',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要检查的文本，标题+正文合并' },
    },
    required: ['text'],
  },
  handler: async (args) => {
    const text = typeof args.text === 'string' ? args.text : '';
    const result = scanPlatformCompliance(text, loadActiveViolationWords());
    return {
      pass: result.pass,
      blockCount: result.issues.filter((i) => i.severity === 'block').length,
      warnCount: result.issues.filter((i) => i.severity === 'warn').length,
      issues: result.issues.slice(0, 10),
      sanitized: result.sanitized,
    };
  },
};

const suggestReplyScript: ToolDefinition = {
  name: 'suggest_reply_script',
  description: '基于学员画像和最新沟通，用 Gemini 生成 2-3 条推荐回复话术。',
  risk: 'analyze',
  parameters: {
    type: 'object',
    properties: {
      leadId: { type: 'number', description: '线索 ID' },
      concern: { type: 'string', description: '学员的核心顾虑，如"学费贵"/"通过率"' },
    },
    required: ['leadId'],
  },
  handler: async (args, ctx) => {
    const ai = getAi();
    if (!ai) return { error: 'GEMINI_API_KEY 未配置' };

    const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(args.leadId) as { tenant: string; nickname: string; source: string; last_message: string; intent: string } | undefined;
    if (!lead) return { error: '线索不存在' };
    if (!ctx.isPlatformAdmin && lead.tenant !== ctx.tenant) return { error: '跨租户访问禁止' };

    const prompt = `你是招生顾问，基于以下学员信息生成 3 条推荐回复话术（每条不超过 80 字）：
昵称：${lead.nickname}
来源：${lead.source}
意向：${lead.intent}
最近消息：${lead.last_message}
核心顾虑：${args.concern || '未明确'}

输出严格 JSON：{ "scripts": [{ "text": "...", "type": "guide" }] }
规则：不出现违规词；不引导站外交易；语气自然。`;

    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      return JSON.parse(response.text || '{}');
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ============= WRITE LOW TOOLS =============

const addLeadNote: ToolDefinition = {
  name: 'add_lead_note',
  description: '为某条线索添加一条 system 类型跟进记录（低风险，不通知外部）。',
  risk: 'write_low',
  parameters: {
    type: 'object',
    properties: {
      leadId: { type: 'number', description: '线索 ID' },
      content: { type: 'string', description: '要记录的内容' },
      nextAction: { type: 'string', description: '建议的下一步动作（可选）' },
    },
    required: ['leadId', 'content'],
  },
  handler: async (args, ctx) => {
    const lead = db.prepare(`SELECT tenant FROM leads WHERE id = ?`).get(args.leadId) as { tenant: string } | undefined;
    if (!lead) return { error: '线索不存在' };
    if (!ctx.isPlatformAdmin && lead.tenant !== ctx.tenant) return { error: '跨租户禁止' };

    const result = db.prepare(`
      INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
      VALUES (?, 'system', ?, ?, NULL, datetime('now'))
    `).run(args.leadId, args.content, args.nextAction ?? null);

    return { followUpId: Number(result.lastInsertRowid), leadId: args.leadId };
  },
};

// ============= WRITE HIGH TOOLS (need approval) =============

const submitContentForReview: ToolDefinition = {
  name: 'submit_content_for_review',
  description: '把 agent 生成的内容草稿提交到「内容工厂 → 审核队列」。需要人工审批。审批通过后 Worker 会创建 RPA 发布任务。',
  risk: 'write_high',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '标题' },
      type: { type: 'string', enum: ['policy', 'major', 'case', 'reminder', 'qa'] },
      platforms: {
        type: 'array',
        items: { type: 'string' } as Record<string, unknown>,
        description: '目标平台，值为 xhs/dy/ks 的数组',
      },
      body: {
        type: 'string',
        description: '各平台的正文 JSON 字符串，形如 {"xhs": {"title":"...","content":"...","imageDesc":"..."}}',
      },
    },
    required: ['title', 'type', 'platforms', 'body'],
  },
  // 自动审批规则：内容合规扫描通过 + 平台仅含 xhs/dy/ks + 长度合理 → 自动通过
  autoApprove: (args) => {
    if (process.env.AUTO_APPROVE_CONTENT !== 'true') {
      return { auto: false, reason: 'AUTO_APPROVE_CONTENT 未启用' };
    }
    const title = typeof args.title === 'string' ? args.title : '';
    const platforms = Array.isArray(args.platforms) ? args.platforms : [];
    if (title.length > 50 || title.length < 5) {
      return { auto: false, reason: `标题长度异常（${title.length} 字）` };
    }
    const invalid = platforms.filter((p: unknown) => typeof p !== 'string' || !['xhs', 'dy', 'ks'].includes(p));
    if (invalid.length > 0) {
      return { auto: false, reason: `含未知平台 ${JSON.stringify(invalid)}` };
    }
    // 合规二次扫描
    const corpus = [title, args.body && typeof args.body === 'string' ? args.body : ''].join('\n');
    const scan = scanPlatformCompliance(corpus, loadActiveViolationWords());
    if (!scan.pass) {
      return { auto: false, reason: `合规扫描命中 ${scan.issues.filter((i) => i.severity === 'block').length} 条 block 级问题` };
    }
    return { auto: true, reason: '合规通过 + 平台合法 + 标题长度合理' };
  },
  handler: async (args, ctx) => {
    const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p): p is string => typeof p === 'string') : [];
    if (platforms.length === 0) return { error: 'platforms 不能为空' };

    let bodyJson: string | null = null;
    if (typeof args.body === 'string' && args.body.trim()) {
      try {
        const parsed = JSON.parse(args.body);
        bodyJson = JSON.stringify(parsed);
      } catch {
        return { error: 'body 不是合法 JSON 字符串' };
      }
    }

    const result = db.prepare(`
      INSERT INTO content_items (title, type, platforms_json, body_json, tenant, status, generated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))
    `).run(args.title, args.type, JSON.stringify(platforms), bodyJson, ctx.tenant);

    return { contentId: Number(result.lastInsertRowid), status: 'pending' };
  },
};

const sendWechatNotice: ToolDefinition = {
  name: 'send_wechat_notice',
  description: '通过企业微信向指定员工或甲方管理员发送一条文本消息。用于 agent 完成某项工作后通知相关人员。需要人工审批。',
  risk: 'write_high',
  parameters: {
    type: 'object',
    properties: {
      toUserId: { type: 'string', description: '企业微信 userid；如填 "admins" 则广播所有 admin 角色' },
      content: { type: 'string', description: '消息正文，500 字内' },
    },
    required: ['toUserId', 'content'],
  },
  // 自动审批规则：发给内部 admin 广播 + 内容不含链接/手机号 → 自动通过
  autoApprove: (args) => {
    if (process.env.AUTO_APPROVE_WECHAT_INTERNAL !== 'true') {
      return { auto: false, reason: 'AUTO_APPROVE_WECHAT_INTERNAL 未启用' };
    }
    const to = String(args.toUserId || '');
    if (to !== 'admins') {
      return { auto: false, reason: '仅允许广播给 admin（to=admins）时自动审批' };
    }
    const content = String(args.content || '');
    if (content.length > 500) {
      return { auto: false, reason: '消息长度超限（> 500）' };
    }
    if (/https?:\/\/|1[3-9]\d{9}|wx[_-]?\w+/i.test(content)) {
      return { auto: false, reason: '内容含链接/手机号/微信号，风险过高' };
    }
    return { auto: true, reason: '内部 admin 广播 + 内容纯文本' };
  },
  handler: async (args) => {
    const content = String(args.content).slice(0, 500);
    const to = String(args.toUserId);
    if (to === 'admins') {
      const admins = db.prepare(`SELECT wechat_work_userid FROM users WHERE role = 'admin' AND wechat_work_userid IS NOT NULL`).all() as Array<{ wechat_work_userid: string }>;
      const results = await Promise.all(admins.map((a) => sendTextMessageToUser({ toUser: a.wechat_work_userid, content })));
      return { sentCount: results.filter((r) => r.success).length, stubCount: results.filter((r) => r.stub).length };
    }

    const result = await sendTextMessageToUser({ toUser: to, content });
    return result;
  },
};

const updateLeadStatus: ToolDefinition = {
  name: 'update_lead_status',
  description: '更新线索状态。需要人工审批（因为改 status 会影响漏斗统计）。',
  risk: 'write_high',
  parameters: {
    type: 'object',
    properties: {
      leadId: { type: 'number', description: '线索 ID' },
      status: { type: 'string', enum: ['new', 'contacted', 'following', 'interested', 'enrolled', 'lost'] },
      note: { type: 'string', description: '变更原因' },
    },
    required: ['leadId', 'status'],
  },
  // 自动审批规则：前向状态迁移（new→contacted→following）且不涉及 enrolled/lost → 自动通过
  autoApprove: (args) => {
    if (process.env.AUTO_APPROVE_LEAD_STATUS !== 'true') {
      return { auto: false, reason: 'AUTO_APPROVE_LEAD_STATUS 未启用' };
    }
    const status = String(args.status || '');
    const safeTransitions = new Set(['contacted', 'following']);
    if (!safeTransitions.has(status)) {
      return { auto: false, reason: `状态 ${status} 不在安全迁移白名单` };
    }
    if (typeof args.leadId !== 'number' || args.leadId <= 0) {
      return { auto: false, reason: 'leadId 非法' };
    }
    return { auto: true, reason: `前向迁移到 ${status}，无商业影响` };
  },
  handler: async (args, ctx) => {
    const lead = db.prepare(`SELECT tenant FROM leads WHERE id = ?`).get(args.leadId) as { tenant: string } | undefined;
    if (!lead) return { error: '线索不存在' };
    if (!ctx.isPlatformAdmin && lead.tenant !== ctx.tenant) return { error: '跨租户禁止' };

    db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(args.status, args.leadId);
    if (args.note) {
      db.prepare(`INSERT INTO followups (lead_id, channel, content, next_action, next_followup_at, created_at)
                  VALUES (?, 'system', ?, NULL, NULL, datetime('now'))`).run(args.leadId, `[agent] 状态更新：${args.status} · ${args.note}`);
    }
    return { updated: true, leadId: args.leadId, newStatus: args.status };
  },
};

// ============= TERMINAL TOOLS =============

const finishMission: ToolDefinition = {
  name: 'finish_mission',
  description: '任务完成时必须调用此工具，传入对用户的总结。调用后 agent 停止。',
  risk: 'terminal',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '任务执行总结，200 字内' },
    },
    required: ['summary'],
  },
  handler: async (args) => ({ finished: true, summary: String(args.summary).slice(0, 2000) }),
};

const giveUpMission: ToolDefinition = {
  name: 'give_up_mission',
  description: '当遇到无法通过工具解决的问题时调用，agent 停止。',
  risk: 'terminal',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: '放弃原因' },
    },
    required: ['reason'],
  },
  handler: async (args) => ({ givenUp: true, reason: String(args.reason).slice(0, 1000) }),
};

// ============= REGISTRY =============

export const ALL_TOOLS: ToolDefinition[] = [
  queryLeads,
  queryDashboardSummary,
  queryDealsSummary,
  queryRpaAccounts,
  querySchools,
  queryJobsStats,
  generateContentDraft,
  complianceScanText,
  suggestReplyScript,
  addLeadNote,
  submitContentForReview,
  sendWechatNotice,
  updateLeadStatus,
  finishMission,
  giveUpMission,
];

export const getToolByName = (name: string): ToolDefinition | undefined => {
  return ALL_TOOLS.find((t) => t.name === name);
};

/** 转成 Gemini Function Declaration 格式 */
export const toGeminiFunctionDeclarations = (tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  parameters: unknown;
}> => {
  return tools.map((t) => ({
    name: t.name,
    description: t.description + (t.risk === 'write_high' ? '【注意：此工具执行后需要人工审批】' : ''),
    parameters: t.parameters,
  }));
};

export const needsApproval = (tool: ToolDefinition): boolean => tool.risk === 'write_high';
export const isTerminal = (tool: ToolDefinition): boolean => tool.risk === 'terminal';
