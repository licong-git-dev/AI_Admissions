/**
 * 学员人设推断
 *
 * 输入：lead 的 last_message + 历史 followups + 私信记录（如有）
 * 输出：学历阶段 / 年龄段 / 职业 / 主痛点 / 价格敏感度 / 决策周期 / 推荐话术
 *
 * 设计：Gemini 优先，规则回退，永远返回结构化 JSON。
 */

import { GoogleGenAI } from '@google/genai';
import { db } from '../db';

const MODEL = 'gemini-2.5-flash-preview-04-17';

export type LeadPersona = {
  ageBand: '20s' | '30s' | '40s+' | 'unknown';
  educationStage: 'highschool' | 'associate' | 'bachelor' | 'unknown';
  occupation: string;
  primaryPainPoint: string;
  priceSensitivity: 'low' | 'medium' | 'high' | 'unknown';
  decisionWindow: 'within_week' | 'within_month' | 'browsing' | 'unknown';
  recommendedScript: string;
  redFlags: string[];
  confidence: 'high' | 'medium' | 'low';
  source: 'ai' | 'rule';
  inferredAt: string;
};

const collectLeadContext = (leadId: number): string => {
  type LeadRow = { source: string; nickname: string; last_message: string; intent: string };
  const lead = db.prepare(
    `SELECT source, nickname, last_message, intent FROM leads WHERE id = ?`
  ).get(leadId) as LeadRow | undefined;
  if (!lead) return '';

  type FollowupRow = { content: string; channel: string; created_at: string };
  const followups = db.prepare(
    `SELECT content, channel, created_at FROM followups WHERE lead_id = ? ORDER BY id DESC LIMIT 10`
  ).all(leadId) as FollowupRow[];

  const lines: string[] = [];
  lines.push(`【线索基本信息】`);
  lines.push(`昵称：${lead.nickname}`);
  lines.push(`来源：${lead.source}`);
  lines.push(`最后一条消息：${lead.last_message}`);
  lines.push(`AI 已分类意向：${lead.intent}`);

  if (followups.length > 0) {
    lines.push(``);
    lines.push(`【历史跟进 (近 ${followups.length} 条)】`);
    followups.forEach((f, i) => {
      lines.push(`${i + 1}. [${f.channel}] ${f.content.slice(0, 120)}`);
    });
  }

  return lines.join('\n');
};

const buildPrompt = (context: string): string => `你是一名资深招生顾问，擅长从碎片化的私信和跟进记录里推断学员画像。

请基于以下线索信息推断该学员的画像，输出严格 JSON：

${context}

输出 JSON schema（必须严格符合）：
{
  "ageBand": "20s" | "30s" | "40s+" | "unknown",
  "educationStage": "highschool" | "associate" | "bachelor" | "unknown",
  "occupation": "（一句话职业描述，如 '工厂普工'/'外贸销售'/'宝妈待业'，最多 12 字）",
  "primaryPainPoint": "（最主要的诉求，如 '找份正经工作'/'孩子上学要本科背景'/'升职卡学历'，最多 25 字）",
  "priceSensitivity": "low" | "medium" | "high" | "unknown",
  "decisionWindow": "within_week" | "within_month" | "browsing" | "unknown",
  "recommendedScript": "（给招生顾问的下一句话术建议，35-60 字，要落到具体卖点而不是套话）",
  "redFlags": ["（疑似不诚信/同行刺探/竞品对比中等风险点的简短列表，没有就给空数组）"],
  "confidence": "high" | "medium" | "low"
}

判断要点：
- 词汇线索：'通过率''学费'高频 → 价格敏感度 high；'学习时间''课程内容'多 → low
- '什么时候报名''怎么报' → decisionWindow=within_week
- '了解了解''看一下' → browsing
- '本科'相关诉求 → educationStage=associate（要升本）
- '专升本''升本'诉求 + 询问考试科目 → bachelor（已经是大专要继续）
- 文字风格年轻化（"姐妹""哥们"）→ 20s；提到孩子/家庭 → 30s+
- 信息不足时用 'unknown'，不要瞎猜

只输出 JSON，不要 Markdown 代码块、不要注释。`;

const ruleBasedFallback = (context: string): LeadPersona => {
  const text = context.toLowerCase();
  let priceSensitivity: LeadPersona['priceSensitivity'] = 'unknown';
  if (text.includes('学费') || text.includes('多少钱') || text.includes('便宜') || text.includes('分期')) {
    priceSensitivity = 'high';
  } else if (text.includes('保过') || text.includes('通过率')) {
    priceSensitivity = 'medium';
  }

  let decisionWindow: LeadPersona['decisionWindow'] = 'unknown';
  if (text.includes('怎么报') || text.includes('怎么交') || text.includes('什么时候')) {
    decisionWindow = 'within_week';
  } else if (text.includes('了解') || text.includes('咨询')) {
    decisionWindow = 'browsing';
  }

  let educationStage: LeadPersona['educationStage'] = 'unknown';
  if (text.includes('专升本') || text.includes('升本')) {
    educationStage = 'associate';
  } else if (text.includes('成考') || text.includes('自考') || text.includes('网教')) {
    educationStage = 'highschool';
  }

  return {
    ageBand: 'unknown',
    educationStage,
    occupation: '待人工补充',
    primaryPainPoint: '提升学历用于就业 / 升职',
    priceSensitivity,
    decisionWindow,
    recommendedScript: '先简短问对方目标院校 / 专业偏好，再用 1 个学员案例对应推荐方案，避免直接发价格表',
    redFlags: [],
    confidence: 'low',
    source: 'rule',
    inferredAt: new Date().toISOString(),
  };
};

let aiClient: GoogleGenAI | null = null;
const getAi = (): GoogleGenAI | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
};

const VALID = {
  ageBand: ['20s', '30s', '40s+', 'unknown'],
  educationStage: ['highschool', 'associate', 'bachelor', 'unknown'],
  priceSensitivity: ['low', 'medium', 'high', 'unknown'],
  decisionWindow: ['within_week', 'within_month', 'browsing', 'unknown'],
  confidence: ['high', 'medium', 'low'],
};

const sanitize = (raw: Partial<LeadPersona>, source: 'ai' | 'rule'): LeadPersona => ({
  ageBand: VALID.ageBand.includes(raw.ageBand as string) ? raw.ageBand as LeadPersona['ageBand'] : 'unknown',
  educationStage: VALID.educationStage.includes(raw.educationStage as string) ? raw.educationStage as LeadPersona['educationStage'] : 'unknown',
  occupation: typeof raw.occupation === 'string' ? raw.occupation.slice(0, 30) : '未知',
  primaryPainPoint: typeof raw.primaryPainPoint === 'string' ? raw.primaryPainPoint.slice(0, 60) : '提升学历',
  priceSensitivity: VALID.priceSensitivity.includes(raw.priceSensitivity as string) ? raw.priceSensitivity as LeadPersona['priceSensitivity'] : 'unknown',
  decisionWindow: VALID.decisionWindow.includes(raw.decisionWindow as string) ? raw.decisionWindow as LeadPersona['decisionWindow'] : 'unknown',
  recommendedScript: typeof raw.recommendedScript === 'string' ? raw.recommendedScript.slice(0, 200) : '',
  redFlags: Array.isArray(raw.redFlags) ? raw.redFlags.slice(0, 5).map((s) => String(s).slice(0, 40)) : [],
  confidence: VALID.confidence.includes(raw.confidence as string) ? raw.confidence as LeadPersona['confidence'] : 'low',
  source,
  inferredAt: new Date().toISOString(),
});

export const inferLeadPersona = async (leadId: number): Promise<LeadPersona> => {
  const context = collectLeadContext(leadId);
  if (!context) {
    throw new Error('lead 不存在');
  }

  let persona: LeadPersona;
  const ai = getAi();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(context),
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(response.text || '{}') as Partial<LeadPersona>;
      persona = sanitize(parsed, 'ai');
    } catch {
      persona = sanitize(ruleBasedFallback(context), 'rule');
    }
  } else {
    persona = sanitize(ruleBasedFallback(context), 'rule');
  }

  // 写入 leads.persona_json
  db.prepare(
    `UPDATE leads SET persona_json = ?, persona_inferred_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(persona), persona.inferredAt, leadId);

  return persona;
};

export const getStoredPersona = (leadId: number): LeadPersona | null => {
  type Row = { persona_json: string | null };
  const row = db.prepare(`SELECT persona_json FROM leads WHERE id = ?`).get(leadId) as Row | undefined;
  if (!row || !row.persona_json) return null;
  try {
    return JSON.parse(row.persona_json) as LeadPersona;
  } catch {
    return null;
  }
};
