import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';

const MODEL = 'gemini-2.5-flash-preview-04-17';

const PROMPT = (source: string, nickname: string, message: string): string => `你是一名招生意向分析助手。基于用户在社交平台的私信/评论内容，判断其招生意向等级。

来源：${source}
昵称：${nickname}
内容：${message}

意向等级规则：
- high: 明确提到想报名、问价格、问条件、问具体院校专业
- medium: 咨询了解、犹豫中、对比中、主动提问
- low: 表情、无关内容、客套话、"哦""知道了"

只输出合法 JSON，字段：
{
  "intent": "high" | "medium" | "low",
  "analysis": "简要判断理由（30 字内）",
  "suggestion": "给招生专员的下一步建议（30 字内）"
}`;

let client: GoogleGenAI | null = null;

const getClient = (): GoogleGenAI | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
};

export type IntentAnalysis = {
  intent: 'high' | 'medium' | 'low';
  analysis: string;
  suggestion: string;
};

export const analyzeIntent = async (
  source: string,
  nickname: string,
  message: string
): Promise<IntentAnalysis> => {
  const c = getClient();
  if (!c) {
    logger.warn('intent', 'GEMINI_API_KEY 未配置，降级为规则匹配');
    return ruleBasedFallback(message);
  }

  try {
    const response = await c.models.generateContent({
      model: MODEL,
      contents: PROMPT(source, nickname, message),
      config: { responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(response.text || '{}') as Partial<IntentAnalysis>;
    return {
      intent: ['high', 'medium', 'low'].includes(parsed.intent || '') ? parsed.intent as IntentAnalysis['intent'] : 'low',
      analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '暂无分析',
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '请人工跟进',
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.warn('intent', 'AI 调用失败，降级为规则匹配', { error: errMessage });
    return ruleBasedFallback(message);
  }
};

const HIGH_KEYWORDS = ['怎么报', '多少钱', '学费', '什么条件', '报名', '考试', '通过率', '加微信', '加wx'];
const MEDIUM_KEYWORDS = ['了解', '咨询', '问一下', '有什么专业', '靠谱吗', '对比', '推荐'];

const ruleBasedFallback = (message: string): IntentAnalysis => {
  const text = message.toLowerCase();
  for (const kw of HIGH_KEYWORDS) {
    if (text.includes(kw)) {
      return { intent: 'high', analysis: `命中高意向关键词：${kw}`, suggestion: '立即推送给专员跟进' };
    }
  }
  for (const kw of MEDIUM_KEYWORDS) {
    if (text.includes(kw)) {
      return { intent: 'medium', analysis: `命中中意向关键词：${kw}`, suggestion: '创建线索，AI 引导回复' };
    }
  }
  return { intent: 'low', analysis: '未匹配明确意向关键词', suggestion: '自动回复标准话术' };
};
