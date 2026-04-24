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
  const persona = getPersona('xiaobao');
  return `你是"${persona.name}"，${persona.role}，${persona.tagline}。
你的语气风格：${persona.tone}。

请为租户「${tenant}」生成今日（${date}）工作战报，用第一人称写给老板看。

今日（过去 24 小时）关键数据：
- 新增线索：${stats.leadsNew} 条（其中高意向 ${stats.leadsHighIntentNew} 条）
- 我扫描的私信/评论：${stats.dmsScanned} 条
- 我起草的内容：${stats.contentDrafted} 条
- 通过审核的内容：${stats.contentApproved} 条
- 已发布的内容：${stats.contentPublished} 条
- 我（或其他 AI 同事）执行的任务：${stats.missionsRun} 个（成功 ${stats.missionsSucceeded}，失败 ${stats.missionsFailed}）
- 自动审批通过的动作：${stats.autoApproved} 次
- 近 7 天成交：${stats.dealsLast7d} 单
- 当前在线 RPA 账号：${stats.rpaLoggedIn} 个

输出要求：
1. 格式：Markdown，80-200 字
2. 开头一句问候，语气自然不做作（不要用"尊敬的""您好"这类客套话）
3. 中间用 2-4 个简短小段汇报重点（数字只引用最突出的 3-5 个，不要流水账）
4. 结尾给出 1 个明天打算做的事情，或一个需要老板关注的隐患（有就说，没有就说"今天没什么意外"）
5. 全零时不要假装热闹，要诚实：例如"今天数据是 0，我明天加把劲"
6. 失败数 > 0 时必须在最后提一下
7. 不要使用"综上所述""总而言之"这类书面套话

只输出战报正文，不要代码块、不要 JSON。`;
};

const buildTemplate = (stats: BriefingStats, _tenant: string, date: string): string => {
  const p = getPersona('xiaobao');
  const lines: string[] = [];

  // 第一句：问候 + 今日定调
  if (stats.leadsNew === 0 && stats.contentDrafted === 0 && stats.missionsRun === 0) {
    lines.push(`老板，${date} 这一天安静得有点过分。`);
  } else if (stats.leadsHighIntentNew >= 3) {
    lines.push(`老板，${date} 有料，来了 **${stats.leadsHighIntentNew}** 条高意向线索。`);
  } else {
    lines.push(`老板，${date} 的战报来了。`);
  }

  // 中段：数据重点
  if (stats.dmsScanned > 0) {
    lines.push(`\n**小线今天扫了 ${stats.dmsScanned} 条**私信 / 评论，${stats.leadsNew > 0 ? `圈出 ${stats.leadsNew} 条转成了线索` : '今天还没成线索'}。`);
  }
  if (stats.contentDrafted > 0 || stats.contentApproved > 0) {
    const seg = [`**小招**写了 ${stats.contentDrafted} 条内容`];
    if (stats.contentApproved > 0) seg.push(`通过审核 ${stats.contentApproved} 条`);
    if (stats.contentPublished > 0) seg.push(`真正发出去 ${stats.contentPublished} 条`);
    lines.push('\n' + seg.join('，') + '。');
  }
  if (stats.autoApproved > 0) {
    lines.push(`\n自动审批帮你省下 **${stats.autoApproved}** 次点按。`);
  }
  if (stats.missionsSucceeded > 0 || stats.missionsFailed > 0) {
    lines.push(`\n今天我们跑了 ${stats.missionsRun} 个任务（成功 ${stats.missionsSucceeded}${stats.missionsFailed > 0 ? `、失败 ${stats.missionsFailed}` : ''}）。`);
  }

  // 结尾：明日计划 / 告警
  if (stats.missionsFailed > 0) {
    lines.push(`\n⚠️ 有 **${stats.missionsFailed}** 个任务失败了，去 AI 员工详情页看一眼。`);
  } else if (stats.rpaLoggedIn < 3) {
    lines.push(`\n⚠️ 在线 RPA 账号只剩 **${stats.rpaLoggedIn}** 个，建议补登录（至少 3 个才经得起一次封号）。`);
  } else if (stats.leadsNew === 0) {
    lines.push(`\n明天我打算让小招多写 1 条内容，看看能不能把流量搞起来。`);
  } else {
    lines.push(`\n今天整体顺利，明天继续。`);
  }

  lines.push(`\n\n${p.signature}`);
  return lines.join('');
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
