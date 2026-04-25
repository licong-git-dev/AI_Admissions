/**
 * 月度价值账单生成器
 *
 * 给乙方老板的「上月价值账单」：
 * - 聚合上月业务指标（线索 / 成交 / 学费 / 分成 / AI 任务 / 节省人力 / 推荐裂变贡献）
 * - 计算续费健康分（4 个维度，0-100）
 * - 用「小报」的口吻生成第一人称价值复盘
 * - 写入 monthly_value_statements 表，月初自动推送 + 后台可查
 *
 * 设计要点：
 * 1. 账单只对「已完结的月份」生成（不写入半截月份），保证数据稳定
 * 2. 健康分维度：lead_growth / conversion / ai_engagement / active_days
 * 3. Gemini 可用走 AI 叙事，否则走规则模板（保证账单一定生成）
 */

import { GoogleGenAI } from '@google/genai';
import { db } from '../db';
import { getPersona } from './agent-personas';

const MODEL = 'gemini-2.5-flash-preview-04-17';

export type ValueStatementBreakdown = {
  // 营收侧
  leadsTotal: number;
  leadsHighIntent: number;
  leadsFromReferral: number;
  dealsCount: number;
  tuitionTotalYuan: number;
  commissionTotalYuan: number;
  commissionPaidYuan: number;
  commissionUnpaidYuan: number;
  // 内容 / RPA
  contentDrafted: number;
  contentPublished: number;
  contentViews: number;
  // AI 员工
  aiMissionsRun: number;
  aiMissionsSucceeded: number;
  aiAutoApproved: number;
  // 人力节省
  savedMinutes: number;
  savedHours: number;
  // 健康度子分
  healthBreakdown: {
    leadGrowthRate: number;     // 环比增长 (-100 到 +inf %)
    conversionRate: number;     // 线索 → 成交（百分比）
    aiEngagementScore: number;  // AI 任务调用密度 (0-100)
    activeDaysScore: number;    // 本月活跃天数（满分 30）
  };
};

export type ValueStatement = {
  tenant: string;
  period: string;                  // YYYY-MM
  leadsTotal: number;
  leadsHighIntent: number;
  leadsFromReferral: number;
  dealsCount: number;
  tuitionTotalFen: number;
  commissionTotalFen: number;
  commissionPaidFen: number;
  contentPublished: number;
  contentViews: number;
  aiMissionsSucceeded: number;
  aiAutoApproved: number;
  savedMinutes: number;
  healthScore: number;             // 0-100
  healthGrade: 'S' | 'A' | 'B' | 'C' | 'D';
  narrative: string;
  breakdown: ValueStatementBreakdown;
  generatedAt: string;
};

const countOne = (sql: string, ...params: unknown[]): number => {
  const row = db.prepare(sql).get(...params) as { c: number } | undefined;
  return row?.c ?? 0;
};

const sumOne = (sql: string, ...params: unknown[]): number => {
  const row = db.prepare(sql).get(...params) as { s: number } | undefined;
  return row?.s ?? 0;
};

const monthBoundary = (period: string): { start: string; end: string; prevStart: string; prevEnd: string } => {
  // period: YYYY-MM
  const [y, m] = period.split('-').map((s) => Number(s));
  const start = `${y}-${String(m).padStart(2, '0')}-01 00:00:00`;
  const nextMonthY = m === 12 ? y + 1 : y;
  const nextMonthM = m === 12 ? 1 : m + 1;
  const end = `${nextMonthY}-${String(nextMonthM).padStart(2, '0')}-01 00:00:00`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevStart = `${prevY}-${String(prevM).padStart(2, '0')}-01 00:00:00`;
  return { start, end, prevStart, prevEnd: start };
};

const collectBreakdown = (tenant: string, period: string): ValueStatementBreakdown => {
  const { start, end, prevStart, prevEnd } = monthBoundary(period);

  const leadsTotal = countOne(
    `SELECT COUNT(*) as c FROM leads WHERE tenant = ? AND created_at >= ? AND created_at < ?`,
    tenant, start, end
  );
  const leadsHighIntent = countOne(
    `SELECT COUNT(*) as c FROM leads WHERE tenant = ? AND intent = 'high' AND created_at >= ? AND created_at < ?`,
    tenant, start, end
  );
  const leadsFromReferral = countOne(
    `SELECT COUNT(*) as c FROM leads WHERE tenant = ? AND referred_by_code IS NOT NULL AND created_at >= ? AND created_at < ?`,
    tenant, start, end
  );
  const prevLeadsTotal = countOne(
    `SELECT COUNT(*) as c FROM leads WHERE tenant = ? AND created_at >= ? AND created_at < ?`,
    tenant, prevStart, prevEnd
  );

  const dealsCount = countOne(
    `SELECT COUNT(*) as c FROM deals WHERE tenant = ? AND signed_at >= ? AND signed_at < ?`,
    tenant, start, end
  );
  const tuitionTotalFen = sumOne(
    `SELECT COALESCE(SUM(total_tuition), 0) as s FROM deals WHERE tenant = ? AND signed_at >= ? AND signed_at < ?`,
    tenant, start, end
  );
  const commissionTotalFen = sumOne(
    `SELECT COALESCE(SUM(commission_amount), 0) as s FROM deals WHERE tenant = ? AND signed_at >= ? AND signed_at < ?`,
    tenant, start, end
  );
  const commissionPaidFen = sumOne(
    `SELECT COALESCE(SUM(commission_paid_amount), 0) as s FROM deals WHERE tenant = ? AND signed_at >= ? AND signed_at < ?`,
    tenant, start, end
  );

  const contentDrafted = countOne(
    `SELECT COUNT(*) as c FROM content_items WHERE tenant = ? AND created_at >= ? AND created_at < ?`,
    tenant, start, end
  );
  const contentPublished = countOne(
    `SELECT COUNT(*) as c FROM content_items WHERE tenant = ? AND status = 'published' AND updated_at >= ? AND updated_at < ?`,
    tenant, start, end
  );
  const contentViews = sumOne(
    `SELECT COALESCE(SUM(views), 0) as s FROM content_items WHERE tenant = ? AND status = 'published' AND updated_at >= ? AND updated_at < ?`,
    tenant, start, end
  );

  const aiMissionsRun = countOne(
    `SELECT COUNT(*) as c FROM agent_missions WHERE tenant = ? AND created_at >= ? AND created_at < ?`,
    tenant, start, end
  );
  const aiMissionsSucceeded = countOne(
    `SELECT COUNT(*) as c FROM agent_missions WHERE tenant = ? AND status = 'succeeded' AND finished_at >= ? AND finished_at < ?`,
    tenant, start, end
  );
  const aiAutoApproved = countOne(
    `SELECT COUNT(*) as c FROM agent_steps s
       JOIN agent_missions m ON m.id = s.mission_id
       WHERE m.tenant = ? AND s.approved_by = -1 AND s.approved_at >= ? AND s.approved_at < ?`,
    tenant, start, end
  );

  // 节省人力估算：每条内容写作 5 分钟、每次自动审批 30 秒、每条线索意向分析 30 秒
  const savedMinutes = Math.round(contentDrafted * 5 + (aiAutoApproved * 0.5) + (leadsTotal * 0.5));
  const savedHours = Math.round(savedMinutes / 6) / 10; // 一位小数

  // 健康度计算
  const leadGrowthRate = prevLeadsTotal === 0
    ? (leadsTotal > 0 ? 100 : 0)
    : Math.round(((leadsTotal - prevLeadsTotal) / prevLeadsTotal) * 100);

  const conversionRate = leadsTotal === 0 ? 0 : Math.round((dealsCount / leadsTotal) * 1000) / 10;

  // AI engagement: 1 个 mission ≈ 5 分。封顶 100。
  const aiEngagementScore = Math.min(100, aiMissionsRun * 5);

  // 活跃天数：本月有任意写入操作的天数（按 leads / content / missions 的 distinct day 计）
  const activeDaysRaw = countOne(
    `SELECT COUNT(*) as c FROM (
       SELECT date(created_at) AS d FROM leads WHERE tenant = ? AND created_at >= ? AND created_at < ?
       UNION SELECT date(created_at) AS d FROM content_items WHERE tenant = ? AND created_at >= ? AND created_at < ?
       UNION SELECT date(created_at) AS d FROM agent_missions WHERE tenant = ? AND created_at >= ? AND created_at < ?
     )`,
    tenant, start, end, tenant, start, end, tenant, start, end
  );
  const activeDaysScore = Math.min(30, activeDaysRaw);

  return {
    leadsTotal,
    leadsHighIntent,
    leadsFromReferral,
    dealsCount,
    tuitionTotalYuan: Math.round(tuitionTotalFen / 100),
    commissionTotalYuan: Math.round(commissionTotalFen / 100),
    commissionPaidYuan: Math.round(commissionPaidFen / 100),
    commissionUnpaidYuan: Math.round((commissionTotalFen - commissionPaidFen) / 100),
    contentDrafted,
    contentPublished,
    contentViews,
    aiMissionsRun,
    aiMissionsSucceeded,
    aiAutoApproved,
    savedMinutes,
    savedHours,
    healthBreakdown: {
      leadGrowthRate,
      conversionRate,
      aiEngagementScore,
      activeDaysScore,
    },
  };
};

const computeHealthScore = (b: ValueStatementBreakdown): { score: number; grade: ValueStatement['healthGrade'] } => {
  // 4 个维度，加权后映射到 100：
  // 增长 30% / 转化 25% / AI 调用 20% / 活跃天 25%
  const growthSub = Math.max(0, Math.min(100, 50 + b.healthBreakdown.leadGrowthRate * 0.5)); // -100% → 0；0% → 50；+100% → 100
  const conversionSub = Math.min(100, b.healthBreakdown.conversionRate * 10);                  // 10% 即满
  const aiSub = b.healthBreakdown.aiEngagementScore;                                            // 0-100
  const activeDaysSub = (b.healthBreakdown.activeDaysScore / 30) * 100;                         // 30 天满分

  const score = Math.round(
    growthSub * 0.30 +
    conversionSub * 0.25 +
    aiSub * 0.20 +
    activeDaysSub * 0.25
  );

  let grade: ValueStatement['healthGrade'];
  if (score >= 85) grade = 'S';
  else if (score >= 70) grade = 'A';
  else if (score >= 55) grade = 'B';
  else if (score >= 40) grade = 'C';
  else grade = 'D';

  return { score, grade };
};

const buildPrompt = (b: ValueStatementBreakdown, tenant: string, period: string, score: number, grade: string): string => {
  const persona = getPersona('xiaobao');
  return `你是"${persona.name}"，${persona.role}，${persona.tagline}。
你的语气风格：${persona.tone}。

请为租户「${tenant}」生成 ${period} 月度价值账单的复盘叙事，写给老板看。

本月数据：
- 新增线索：${b.leadsTotal} 条（其中高意向 ${b.leadsHighIntent} 条，转介绍带来的 ${b.leadsFromReferral} 条）
- 成交：${b.dealsCount} 单，学费总额 ${b.tuitionTotalYuan} 元
- 平台分成：应付 ${b.commissionTotalYuan} 元，已付 ${b.commissionPaidYuan} 元（未结 ${b.commissionUnpaidYuan} 元）
- 内容生产：起草 ${b.contentDrafted} 条，发布 ${b.contentPublished} 条，累计阅读 ${b.contentViews} 次
- AI 任务：完成 ${b.aiMissionsSucceeded} 个，自动审批节省 ${b.aiAutoApproved} 次点按
- 节省人力：约 ${b.savedHours} 小时（${b.savedMinutes} 分钟）
- 环比线索增长率：${b.healthBreakdown.leadGrowthRate}%
- 线索→成交转化率：${b.healthBreakdown.conversionRate}%
- 续费健康分：${score} 分，等级 ${grade}

输出要求：
1. Markdown 格式，150-300 字
2. 以「老板，${period} 这一个月给你交个账」起手
3. 明确说出「你给平台 ${b.commissionTotalYuan} 元，平台给你创造了 ${b.tuitionTotalYuan} 元营收」这层 ROI 关系
4. 给数据穿上场景：例如内容阅读不要光说次数，要说"相当于 X 个朋友圈广告位"
5. 健康分 < 55 时要诚实说出"不太行"，并给具体建议；> 70 时可以适度鼓励
6. 结尾给 1-2 条下月可执行的建议（基于数据短板）
7. 不要"综上所述""总而言之"这类套话

只输出账单正文，不要代码块或 JSON。`;
};

const buildTemplate = (b: ValueStatementBreakdown, tenant: string, period: string, score: number, grade: string): string => {
  const p = getPersona('xiaobao');
  const lines: string[] = [];

  lines.push(`老板，${period} 这一个月给你交个账。`);

  if (b.dealsCount > 0) {
    lines.push(
      `\n本月成交 **${b.dealsCount}** 单，学费总额 **${b.tuitionTotalYuan} 元**。` +
      `按 30% 分成你需要付平台 **${b.commissionTotalYuan} 元**`+
      `（已付 ${b.commissionPaidYuan} 元${b.commissionUnpaidYuan > 0 ? `，未结 ${b.commissionUnpaidYuan} 元` : ''}）。`
    );
    lines.push(
      `\n换句话说：每 1 元平台费给你产出了 **${(b.tuitionTotalYuan / Math.max(b.commissionTotalYuan, 1)).toFixed(1)} 元**学费。`
    );
  } else {
    lines.push(`\n本月没有成交单。账面是 0 — 但还有 ${b.leadsHighIntent} 条高意向待跟进，下个月有机会。`);
  }

  if (b.leadsTotal > 0) {
    const refSeg = b.leadsFromReferral > 0
      ? `（其中 **${b.leadsFromReferral}** 条来自学员转介绍 — 这部分获客成本几乎为 0）`
      : '';
    lines.push(
      `\n线索方面：本月 **${b.leadsTotal}** 条新线索${refSeg}，` +
      `线索→成交转化率 ${b.healthBreakdown.conversionRate}%，环比 ${b.healthBreakdown.leadGrowthRate >= 0 ? '+' : ''}${b.healthBreakdown.leadGrowthRate}%。`
    );
  }

  if (b.contentPublished > 0) {
    lines.push(
      `\n内容方面：发布 ${b.contentPublished} 条，累计阅读 **${b.contentViews}** 次。`
    );
  }

  if (b.aiMissionsSucceeded > 0 || b.aiAutoApproved > 0) {
    lines.push(
      `\nAI 同事们干了什么：完成任务 ${b.aiMissionsSucceeded} 个，自动审批 ${b.aiAutoApproved} 次，` +
      `算下来给你省了大约 **${b.savedHours} 小时**人力。`
    );
  }

  // 健康分
  lines.push(`\n\n**续费健康分：${score} / 100（${grade} 级）**`);
  if (score >= 85) {
    lines.push(`\n这是 S 级状态 — 增长、转化、活跃度都很顶。下个月维持就行。`);
  } else if (score >= 70) {
    lines.push(`\nA 级，状态稳定。再补一手转介绍就能冲 S。`);
  } else if (score >= 55) {
    lines.push(`\nB 级中游。下个月建议：让 AI 多跑几个任务，转化漏斗也复盘一下。`);
  } else if (score >= 40) {
    lines.push(`\nC 级偏低。说明运营投入不够，建议把每日内容冲刺定时打开。`);
  } else {
    lines.push(`\nD 级 — 系统几乎没用起来。下个月不调整的话，平台费就是浪费。`);
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

export const generateValueStatement = async (tenant: string, period: string): Promise<ValueStatement> => {
  const breakdown = collectBreakdown(tenant, period);
  const { score, grade } = computeHealthScore(breakdown);

  const ai = getAi();
  let narrative: string;

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(breakdown, tenant, period, score, grade),
      });
      const text = (response.text ?? '').trim();
      narrative = text.length > 50 ? text : buildTemplate(breakdown, tenant, period, score, grade);
    } catch {
      narrative = buildTemplate(breakdown, tenant, period, score, grade);
    }
  } else {
    narrative = buildTemplate(breakdown, tenant, period, score, grade);
  }

  // UPSERT
  db.prepare(`
    INSERT INTO monthly_value_statements (
      tenant, period, leads_total, leads_high_intent, leads_from_referral,
      deals_count, tuition_total_fen, commission_total_fen, commission_paid_fen,
      content_published, content_views, ai_missions_succeeded, ai_auto_approved,
      saved_minutes, health_score, health_grade, narrative, breakdown_json, generated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant, period) DO UPDATE SET
      leads_total = excluded.leads_total,
      leads_high_intent = excluded.leads_high_intent,
      leads_from_referral = excluded.leads_from_referral,
      deals_count = excluded.deals_count,
      tuition_total_fen = excluded.tuition_total_fen,
      commission_total_fen = excluded.commission_total_fen,
      commission_paid_fen = excluded.commission_paid_fen,
      content_published = excluded.content_published,
      content_views = excluded.content_views,
      ai_missions_succeeded = excluded.ai_missions_succeeded,
      ai_auto_approved = excluded.ai_auto_approved,
      saved_minutes = excluded.saved_minutes,
      health_score = excluded.health_score,
      health_grade = excluded.health_grade,
      narrative = excluded.narrative,
      breakdown_json = excluded.breakdown_json,
      generated_at = excluded.generated_at
  `).run(
    tenant, period,
    breakdown.leadsTotal, breakdown.leadsHighIntent, breakdown.leadsFromReferral,
    breakdown.dealsCount, Math.round(breakdown.tuitionTotalYuan * 100), Math.round(breakdown.commissionTotalYuan * 100), Math.round(breakdown.commissionPaidYuan * 100),
    breakdown.contentPublished, breakdown.contentViews,
    breakdown.aiMissionsSucceeded, breakdown.aiAutoApproved,
    breakdown.savedMinutes, score, grade, narrative, JSON.stringify(breakdown)
  );

  return {
    tenant,
    period,
    leadsTotal: breakdown.leadsTotal,
    leadsHighIntent: breakdown.leadsHighIntent,
    leadsFromReferral: breakdown.leadsFromReferral,
    dealsCount: breakdown.dealsCount,
    tuitionTotalFen: Math.round(breakdown.tuitionTotalYuan * 100),
    commissionTotalFen: Math.round(breakdown.commissionTotalYuan * 100),
    commissionPaidFen: Math.round(breakdown.commissionPaidYuan * 100),
    contentPublished: breakdown.contentPublished,
    contentViews: breakdown.contentViews,
    aiMissionsSucceeded: breakdown.aiMissionsSucceeded,
    aiAutoApproved: breakdown.aiAutoApproved,
    savedMinutes: breakdown.savedMinutes,
    healthScore: score,
    healthGrade: grade,
    narrative,
    breakdown,
    generatedAt: new Date().toISOString(),
  };
};

type StatementRow = {
  tenant: string;
  period: string;
  leads_total: number;
  leads_high_intent: number;
  leads_from_referral: number;
  deals_count: number;
  tuition_total_fen: number;
  commission_total_fen: number;
  commission_paid_fen: number;
  content_published: number;
  content_views: number;
  ai_missions_succeeded: number;
  ai_auto_approved: number;
  saved_minutes: number;
  health_score: number;
  health_grade: string;
  narrative: string;
  breakdown_json: string;
  generated_at: string;
};

const rowToStatement = (row: StatementRow): ValueStatement => ({
  tenant: row.tenant,
  period: row.period,
  leadsTotal: row.leads_total,
  leadsHighIntent: row.leads_high_intent,
  leadsFromReferral: row.leads_from_referral,
  dealsCount: row.deals_count,
  tuitionTotalFen: row.tuition_total_fen,
  commissionTotalFen: row.commission_total_fen,
  commissionPaidFen: row.commission_paid_fen,
  contentPublished: row.content_published,
  contentViews: row.content_views,
  aiMissionsSucceeded: row.ai_missions_succeeded,
  aiAutoApproved: row.ai_auto_approved,
  savedMinutes: row.saved_minutes,
  healthScore: row.health_score,
  healthGrade: (row.health_grade as ValueStatement['healthGrade']) ?? 'B',
  narrative: row.narrative,
  breakdown: JSON.parse(row.breakdown_json) as ValueStatementBreakdown,
  generatedAt: row.generated_at,
});

export const getLatestValueStatement = (tenant: string): ValueStatement | null => {
  const row = db.prepare(`
    SELECT * FROM monthly_value_statements WHERE tenant = ? ORDER BY period DESC LIMIT 1
  `).get(tenant) as StatementRow | undefined;
  return row ? rowToStatement(row) : null;
};

export const listValueStatements = (tenant: string, limit = 12): ValueStatement[] => {
  const rows = db.prepare(`
    SELECT * FROM monthly_value_statements WHERE tenant = ? ORDER BY period DESC LIMIT ?
  `).all(tenant, limit) as StatementRow[];
  return rows.map(rowToStatement);
};

export const markStatementPushed = (tenant: string, period: string): void => {
  db.prepare(`UPDATE monthly_value_statements SET pushed_at = datetime('now') WHERE tenant = ? AND period = ?`).run(tenant, period);
};

export const previousMonthPeriod = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-12
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
};

export const listTenantsWithActivity = (): string[] => {
  const rows = db.prepare(`
    SELECT DISTINCT tenant FROM leads WHERE tenant != 'platform'
    UNION
    SELECT DISTINCT tenant FROM users WHERE tenant != 'platform' AND role IN ('admin', 'tenant_admin')
  `).all() as Array<{ tenant: string }>;
  return rows.map((r) => r.tenant);
};
