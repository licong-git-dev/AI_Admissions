/**
 * 每日战报生成器
 *
 * 给乙方老板的「今日 AI 员工战报」：
 * - 聚合 24h 核心指标
 * - 用「小报」的口吻生成第一人称叙事
 * - 写入 tenant_briefings 表，供 HomePanel 读取 + 企微推送
 *
 * 设计要点：
 * 1. Gemini 可用时走 AI（情绪价值 + 自然表达）
 * 2. Gemini 不可用时走模板（保证 Day-1 就有故事，不因配置而空白）
 * 3. 即使全部指标是 0，也要给出有人情味的话（例：「今天数据是 0，别急，我明天加把劲」）
 */

import { GoogleGenAI } from '@google/genai';
import { db } from '../db';
import { getPersona } from './agent-personas';

const MODEL = 'gemini-2.5-flash-preview-04-17';

export type BriefingStats = {
  leadsNew: number;            // 24h 新线索
  leadsHighIntentNew: number;  // 24h 新增高意向
  contentDrafted: number;       // 24h 新生成内容草稿
  contentApproved: number;      // 24h 通过审核
  contentPublished: number;     // 24h 已发布（RPA 完成）
  missionsRun: number;          // 24h mission 执行数
  missionsSucceeded: number;    // 24h 成功数
  missionsFailed: number;       // 24h 失败数
  autoApproved: number;         // 24h 自动审批次数
  dealsLast7d: number;          // 近 7 天成交（用于对照）
  rpaLoggedIn: number;          // 当前在线 RPA 账号数
  dmsScanned: number;           // 24h 私信/评论扫描总数
};

export type Briefing = {
  tenant: string;
  date: string;
  narrative: string;
  stats: BriefingStats;
  personaId: string;
  source: 'ai' | 'template';
  generatedAt: string;
};

const countOne = (sql: string, ...params: unknown[]): number => {
  const row = db.prepare(sql).get(...params) as { c: number } | undefined;
  return row?.c ?? 0;
};

export const collectTenantStats = (tenant: string): BriefingStats => {
  return {
    leadsNew: countOne(
      `SELECT COUNT(*) as c FROM leads WHERE tenant = ? AND datetime(created_at) > datetime('now', '-1 day')`,
      tenant
    ),
    leadsHighIntentNew: countOne(
      `SELECT COUNT(*) as c FROM leads WHERE tenant = ? AND intent = 'high' AND datetime(created_at) > datetime('now', '-1 day')`,
      tenant
    ),
    contentDrafted: countOne(
      `SELECT COUNT(*) as c FROM content_items WHERE tenant = ? AND datetime(created_at) > datetime('now', '-1 day')`,
      tenant
    ),
    contentApproved: countOne(
      `SELECT COUNT(*) as c FROM content_items WHERE tenant = ? AND status IN ('approved', 'published') AND datetime(updated_at) > datetime('now', '-1 day')`,
      tenant
    ),
    contentPublished: countOne(
      `SELECT COUNT(*) as c FROM content_items WHERE tenant = ? AND status = 'published' AND datetime(updated_at) > datetime('now', '-1 day')`,
      tenant
    ),
    missionsRun: countOne(
      `SELECT COUNT(*) as c FROM agent_missions WHERE tenant = ? AND datetime(created_at) > datetime('now', '-1 day')`,
      tenant
    ),
    missionsSucceeded: countOne(
      `SELECT COUNT(*) as c FROM agent_missions WHERE tenant = ? AND status = 'succeeded' AND datetime(finished_at) > datetime('now', '-1 day')`,
      tenant
    ),
    missionsFailed: countOne(
      `SELECT COUNT(*) as c FROM agent_missions WHERE tenant = ? AND status = 'failed' AND datetime(finished_at) > datetime('now', '-1 day')`,
      tenant
    ),
    autoApproved: countOne(
      `SELECT COUNT(*) as c FROM agent_steps s
         JOIN agent_missions m ON m.id = s.mission_id
         WHERE m.tenant = ? AND s.approved_by = -1 AND datetime(s.approved_at) > datetime('now', '-1 day')`,
      tenant
    ),
    dealsLast7d: countOne(
      `SELECT COUNT(*) as c FROM deals WHERE tenant = ? AND datetime(signed_at) > datetime('now', '-7 days')`,
      tenant
    ),
    rpaLoggedIn: countOne(
      `SELECT COUNT(*) as c FROM rpa_accounts WHERE tenant = ? AND cookies_json IS NOT NULL AND status = 'active'`,
      tenant
    ),
    dmsScanned: countOne(
      `SELECT COUNT(*) as c FROM rpa_messages m
         JOIN rpa_accounts a ON a.id = m.account_id
         WHERE a.tenant = ? AND datetime(m.created_at) > datetime('now', '-1 day')`,
      tenant
    ),
  };
};

const buildPrompt = (stats: BriefingStats, tenant: string, date: string): string => {
  const xz = getPersona('xiaozhao');
  const xx = getPersona('xiaoxian');
  const xb = getPersona('xiaobao');
  return `你是"${xb.name}"，作为团队主笔，要协调写一份「${date}」三人小队的日报。

团队成员：
- 🎯 ${xz.name}（${xz.role}）：${xz.tagline}。语气：${xz.tone}
- 🕸️ ${xx.name}（${xx.role}）：${xx.tagline}。语气：${xx.tone}
- 📊 ${xb.name}（${xb.role}）：${xb.tagline}。语气：${xb.tone}

今日（过去 24 小时）数据：
- 新增线索：${stats.leadsNew} 条（高意向 ${stats.leadsHighIntentNew} 条）
- 私信/评论扫描：${stats.dmsScanned} 条
- 内容草稿：${stats.contentDrafted} 条 / 通过 ${stats.contentApproved} / 发布 ${stats.contentPublished}
- 任务执行：${stats.missionsRun} 个（成功 ${stats.missionsSucceeded}，失败 ${stats.missionsFailed}）
- 自动审批：${stats.autoApproved} 次
- 近 7 天成交：${stats.dealsLast7d} 单 · 在线 RPA：${stats.rpaLoggedIn} 个

输出要求：
- 格式：纯文本（不要代码块、不要 Markdown 表格），180-320 字
- 三段式：
  1. 「🎯 小招说：」用小招的口吻汇报内容相关数据 + 1 句明天打算（30-60 字）
  2. 「🕸️ 小线说：」用小线的口吻汇报私信/线索数据 + 1 句明天打算（30-60 字）
  3. 「📊 小报说：」用小报的口吻做综合点评 + 给老板 1 个建议（40-80 字）
- 数据为 0 时要诚实，不要假装热闹
- 失败数 > 0 必须在小报段提到
- 不要"综上所述""总而言之"这类套话
- 三段必须各自有"明天我打算"或"建议"的句子，体现"会思考"

只输出三段正文。`;
};

const buildTemplate = (stats: BriefingStats, _tenant: string, date: string): string => {
  const xb = getPersona('xiaobao');
  const lines: string[] = [];

  // 🎯 小招说
  if (stats.contentDrafted > 0 || stats.contentApproved > 0) {
    const parts = [`今天我起草了 ${stats.contentDrafted} 条内容`];
    if (stats.contentApproved > 0) parts.push(`通过审核 ${stats.contentApproved} 条`);
    if (stats.contentPublished > 0) parts.push(`真发出去 ${stats.contentPublished} 条`);
    lines.push(`🎯 小招说：${parts.join('，')}。明天我打算多写 1 条「学员逆袭案例」型，转化通常更高。`);
  } else {
    lines.push(`🎯 小招说：今天没出新内容。明天我打算补上 3 条，先把账户活跃起来。`);
  }
  lines.push('');

  // 🕸️ 小线说
  if (stats.dmsScanned > 0) {
    lines.push(`🕸️ 小线说：今天扫了 ${stats.dmsScanned} 条私信和评论，${stats.leadsNew > 0 ? `圈出 ${stats.leadsNew} 条新线索（高意向 ${stats.leadsHighIntentNew} 条）` : '没圈到新线索'}。明天我重点盯 18:00-22:00 的高峰时段。`);
  } else {
    lines.push(`🕸️ 小线说：今天没扫到东西，可能 RPA 账号没登录。建议先去补一个，我才能干活。`);
  }
  lines.push('');

  // 📊 小报说
  const summary: string[] = [];
  if (stats.missionsSucceeded > 0) summary.push(`完成 ${stats.missionsSucceeded} 个任务`);
  if (stats.autoApproved > 0) summary.push(`自动审批省了 ${stats.autoApproved} 次点按`);
  if (stats.dealsLast7d > 0) summary.push(`近 7 天成交 ${stats.dealsLast7d} 单`);
  const summaryText = summary.length > 0 ? `综合看：${summary.join('，')}。` : '今天数据不算热闹。';

  let advice = '';
  if (stats.missionsFailed > 0) {
    advice = `建议：去 AI 员工 → 失败 mission 接手区看一眼，有 ${stats.missionsFailed} 个任务失败了。`;
  } else if (stats.rpaLoggedIn < 3) {
    advice = `建议：在线 RPA 只剩 ${stats.rpaLoggedIn} 个，至少补到 3 个再说。`;
  } else if (stats.leadsHighIntentNew >= 3) {
    advice = `建议：今天来了 ${stats.leadsHighIntentNew} 条高意向，赶紧让小线扫一遍跟进话术，趁热打铁。`;
  } else {
    advice = `建议：明天先看看今天的内容数据回流，找出哪条最好用。`;
  }
  lines.push(`📊 小报说：${summaryText}${advice}`);

  lines.push('');
  lines.push(xb.signature);
  return lines.join('\n');
};

let aiClient: GoogleGenAI | null = null;
const getAi = (): GoogleGenAI | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
};

export const generateBriefing = async (tenant: string): Promise<Briefing> => {
  const date = new Date().toISOString().slice(0, 10);
  const stats = collectTenantStats(tenant);

  const ai = getAi();
  let narrative: string;
  let source: 'ai' | 'template' = 'template';

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(stats, tenant, date),
      });
      const text = (response.text ?? '').trim();
      if (text.length > 20) {
        narrative = text;
        source = 'ai';
      } else {
        narrative = buildTemplate(stats, tenant, date);
      }
    } catch {
      narrative = buildTemplate(stats, tenant, date);
    }
  } else {
    narrative = buildTemplate(stats, tenant, date);
  }

  // UPSERT：同一天只保留一条
  db.prepare(`
    INSERT INTO tenant_briefings (tenant, date, narrative, stats_json, persona, source, generated_at)
    VALUES (?, ?, ?, ?, 'xiaobao', ?, datetime('now'))
    ON CONFLICT(tenant, date) DO UPDATE SET
      narrative = excluded.narrative,
      stats_json = excluded.stats_json,
      source = excluded.source,
      generated_at = excluded.generated_at
  `).run(tenant, date, narrative, JSON.stringify(stats), source);

  return {
    tenant,
    date,
    narrative,
    stats,
    personaId: 'xiaobao',
    source,
    generatedAt: new Date().toISOString(),
  };
};

export const getLatestBriefing = (tenant: string): Briefing | null => {
  type Row = {
    tenant: string; date: string; narrative: string;
    stats_json: string; persona: string; source: string;
    generated_at: string;
  };
  const row = db.prepare(`
    SELECT tenant, date, narrative, stats_json, persona, source, generated_at
    FROM tenant_briefings
    WHERE tenant = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(tenant) as Row | undefined;
  if (!row) return null;
  return {
    tenant: row.tenant,
    date: row.date,
    narrative: row.narrative,
    stats: JSON.parse(row.stats_json) as BriefingStats,
    personaId: row.persona,
    source: (row.source === 'ai' ? 'ai' : 'template'),
    generatedAt: row.generated_at,
  };
};

export const markBriefingPushed = (tenant: string, date: string): void => {
  db.prepare(`UPDATE tenant_briefings SET pushed_at = datetime('now') WHERE tenant = ? AND date = ?`).run(tenant, date);
};
