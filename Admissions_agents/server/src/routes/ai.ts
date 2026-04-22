import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { db } from '../db';
import { aiPrompts } from '../services/ai-prompts';

const aiRouter = Router();
const MODEL = 'gemini-2.5-flash-preview-04-17';
const VALID_INTENTS = new Set(['high', 'medium', 'low']);

const getClient = () => {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY 未配置');
  }

  return new GoogleGenAI({ apiKey: config.geminiApiKey });
};

const logInteraction = (leadId: number | null, scene: string, input: unknown, output: unknown) => {
  db.prepare(
    `INSERT INTO ai_logs (lead_id, scene, input_payload, output_payload, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(leadId, scene, JSON.stringify(input), JSON.stringify(output));
};

const parseModelJson = (text: string | undefined, scene: string) => {
  try {
    const parsed = JSON.parse(text || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${scene} 返回结果不是合法 JSON`);
  }
};

const toStringValue = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const toStringArray = (value: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter((item): item is string => typeof item === 'string');
};

const normalizeGeneratedContentResult = (payload: Record<string, unknown>) => {
  const result: Record<string, { title: string; content: string; image_desc: string }> = {};

  for (const [platform, value] of Object.entries(payload)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const item = value as Record<string, unknown>;
    result[platform] = {
      title: toStringValue(item.title),
      content: toStringValue(item.content),
      image_desc: toStringValue(item.image_desc),
    };
  }

  return result;
};

const normalizeIntentAnalysisResult = (payload: Record<string, unknown>) => {
  const intent = toStringValue(payload.intent, 'low');

  return {
    intent: VALID_INTENTS.has(intent) ? intent : 'low',
    analysis: toStringValue(payload.analysis, '暂未获取到有效分析结果'),
    concerns: toStringArray(payload.concerns),
    suggestion: toStringValue(payload.suggestion, '建议先进一步确认学员核心问题'),
    urgency: toStringValue(payload.urgency, '今天'),
  };
};

const normalizeScriptResult = (payload: Record<string, unknown>) => {
  const scripts = Array.isArray(payload.scripts)
    ? payload.scripts
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          text: toStringValue(item.text, '暂未生成有效话术'),
          type: toStringValue(item.type, 'guide'),
        }))
    : [];

  return {
    scripts: scripts.length > 0 ? scripts : [{ text: '暂未生成有效话术，请人工继续跟进。', type: 'guide' }],
    keyPoints: toStringArray(payload.keyPoints),
  };
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
};

const toLeadId = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
};

const isRecordBody = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const normalizeStudentProfileResult = (payload: Record<string, unknown>) => {
  const profile = payload.profile && typeof payload.profile === 'object'
    ? payload.profile as Record<string, unknown>
    : {};
  const callPrep = payload.callPrep && typeof payload.callPrep === 'object'
    ? payload.callPrep as Record<string, unknown>
    : {};
  const objectionHandling = Array.isArray(callPrep.objectionHandling)
    ? callPrep.objectionHandling
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          objection: toStringValue(item.objection, '待确认异议'),
          response: toStringValue(item.response, '建议先进一步追问后再回应'),
        }))
    : [];

  return {
    profile: {
      intentMajor: toStringValue(profile.intentMajor, '待确认'),
      mainConcerns: toStringValue(profile.mainConcerns, '待确认'),
      stage: toStringValue(profile.stage, '待确认'),
      decisionFactor: toStringValue(profile.decisionFactor, '待补充'),
    },
    callPrep: {
      openingTopic: toStringValue(callPrep.openingTopic, '先确认学员当前最关心的问题'),
      keyPoints: toStringArray(callPrep.keyPoints),
      objectionHandling,
      closingAction: toStringValue(callPrep.closingAction, '约定下一步沟通动作'),
    },
  };
};

aiRouter.post('/generate-content', async (req, res, next) => {
  try {
    if (!isRecordBody(req.body)) {
      return res.status(400).json({ success: false, data: null, error: '请求体必须为 JSON 对象' });
    }

    const { contentType, platforms, requirements } = req.body;

    if (typeof contentType !== 'string' || !contentType.trim() || !isStringArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ success: false, data: null, error: 'contentType 必须为非空字符串，platforms 必须为非空字符串数组' });
    }

    if (requirements !== undefined && typeof requirements !== 'string') {
      return res.status(400).json({ success: false, data: null, error: 'requirements 必须为字符串' });
    }

    const normalizedRequirements = typeof requirements === 'string' ? requirements : '';
    const prompt = aiPrompts.contentGeneration(contentType, platforms, normalizedRequirements);
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const parsed = normalizeGeneratedContentResult(parseModelJson(response.text, 'generate-content'));
    logInteraction(null, 'generate-content', req.body, parsed);
    res.json({ success: true, data: parsed, error: null });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/analyze-intent', async (req, res, next) => {
  try {
    if (!isRecordBody(req.body)) {
      return res.status(400).json({ success: false, data: null, error: '请求体必须为 JSON 对象' });
    }

    const { nickname, source, message, leadId } = req.body;

    if (typeof nickname !== 'string' || typeof source !== 'string' || typeof message !== 'string' || !nickname.trim() || !source.trim() || !message.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'nickname、source、message 必须为非空字符串' });
    }

    if (message.length > 1000) {
      return res.status(400).json({ success: false, data: null, error: 'message 长度不能超过 1000 个字符' });
    }

    const prompt = aiPrompts.intentAnalysis(nickname, source, message);
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const parsed = normalizeIntentAnalysisResult(parseModelJson(response.text, 'analyze-intent'));
    logInteraction(toLeadId(leadId), 'analyze-intent', req.body, parsed);
    res.json({ success: true, data: parsed, error: null });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/recommend-scripts', async (req, res, next) => {
  try {
    if (!isRecordBody(req.body)) {
      return res.status(400).json({ success: false, data: null, error: '请求体必须为 JSON 对象' });
    }

    const { studentProfile, lastMessages, concern, leadId } = req.body;

    if (typeof studentProfile !== 'string' || typeof lastMessages !== 'string' || typeof concern !== 'string' || !studentProfile.trim() || !lastMessages.trim() || !concern.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'studentProfile、lastMessages、concern 必须为非空字符串' });
    }

    if (lastMessages.length > 3000) {
      return res.status(400).json({ success: false, data: null, error: 'lastMessages 长度不能超过 3000 个字符' });
    }

    const prompt = aiPrompts.scriptRecommendation(studentProfile, lastMessages, concern);
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const parsed = normalizeScriptResult(parseModelJson(response.text, 'recommend-scripts'));
    logInteraction(toLeadId(leadId), 'recommend-scripts', req.body, parsed);
    res.json({ success: true, data: parsed, error: null });
  } catch (error) {
    next(error);
  }
});

aiRouter.post('/student-profile', async (req, res, next) => {
  try {
    if (!isRecordBody(req.body)) {
      return res.status(400).json({ success: false, data: null, error: '请求体必须为 JSON 对象' });
    }

    const { studentData, chatHistory, leadId } = req.body;

    if (typeof studentData !== 'string' || typeof chatHistory !== 'string' || !studentData.trim() || !chatHistory.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'studentData、chatHistory 必须为非空字符串' });
    }

    if (studentData.length > 2000) {
      return res.status(400).json({ success: false, data: null, error: 'studentData 长度不能超过 2000 个字符' });
    }

    if (chatHistory.length > 5000) {
      return res.status(400).json({ success: false, data: null, error: 'chatHistory 长度不能超过 5000 个字符' });
    }

    const prompt = aiPrompts.studentProfile(studentData, chatHistory);
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const parsed = normalizeStudentProfileResult(parseModelJson(response.text, 'student-profile'));
    logInteraction(toLeadId(leadId), 'student-profile', req.body, parsed);
    res.json({ success: true, data: parsed, error: null });
  } catch (error) {
    next(error);
  }
});

export { aiRouter };
