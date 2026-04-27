/**
 * Agent Runtime · AI 招生数字员工核心循环
 *
 * 设计：ReAct 模式，Gemini Function Calling 驱动
 *
 * 循环：
 *   1. 拉取 mission 最新状态
 *   2. 如果是 queued → 初始化 system prompt + goal，转为 running
 *   3. 读取已有 steps 恢复对话历史
 *   4. 调 Gemini 选择下一步动作（function call）
 *   5. 分发：
 *      - terminal tool → 写 step，mission 完成
 *      - needs_approval tool → 写 step status=waiting_approval，mission 暂停
 *      - 其他 tool → 直接执行，写 tool_call + tool_result step
 *   6. 达到 MAX_STEPS 或 超时 → mission failed
 *
 * 由 jobs 作业驱动（每个 mission 对应一个 agent.run_mission 作业）
 */

import { db } from '../src/db';
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config';
import { logger } from './logger';
import {
  ALL_TOOLS,
  getToolByName,
  toGeminiFunctionDeclarations,
  needsApproval,
  isTerminal,
  type ToolContext,
} from '../src/services/agent-tools';

type MissionRow = {
  id: number;
  tenant: string;
  type: string;
  title: string;
  goal_json: string;
  status: string;
  created_by: number | null;
  step_count: number;
  approval_count: number;
  started_at: string | null;
};

type StepRow = {
  id: number;
  mission_id: number;
  step_index: number;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_args_json: string | null;
  tool_result_json: string | null;
  needs_approval: number;
  approved_by: number | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
};

const MODEL = 'gemini-2.5-flash-preview-04-17';
const MAX_STEPS = 20;
const MAX_APPROVALS = 5;
const MAX_DURATION_MS = 30 * 60 * 1000;

let aiClient: GoogleGenAI | null = null;
const getAi = (): GoogleGenAI => {
  if (!aiClient) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY 未配置，agent 无法运行');
    }
    aiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return aiClient;
};

const SYSTEM_PROMPT = `你是一个严谨、自主的招生运营 AI 数字员工。

# 你的身份
- 服务于「招生智能体集群」平台
- 遵守中国教培行业监管（广告法、小红书治理公告）
- 所有写操作走 function call，不能绕过工具直接操作数据库

# 工作方式
1. 收到目标后，先用 query_* 工具拉当前状态
2. 用 generate_content_draft / suggest_reply_script 等 analyze 工具制作方案
3. compliance_scan 必须在任何 submit_content_for_review 前调用
4. 危险操作（write_high）会触发人工审批，你继续执行到审批点即可
5. 任务完成时必须调用 finish_mission 并总结
6. 遇到死锁或无法推进时调用 give_up_mission 并说明原因

# 硬规则
- 禁止生成"包过"、"100%通过"、"内部名额"等违规词
- 生成内容必须先 compliance_scan，不通过则改
- 每次 function call 只做一步，不要一次 call 多个
- 回复简洁，不要长篇大论
`;

const updateMission = (id: number, patch: Record<string, unknown>): void => {
  const fields = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const values = Object.values(patch);
  db.prepare(`UPDATE agent_missions SET ${fields}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
};

const recordStep = (missionId: number, step: Omit<StepRow, 'id' | 'mission_id' | 'created_at'>): number => {
  const result = db.prepare(`
    INSERT INTO agent_steps (mission_id, step_index, role, content, tool_name, tool_args_json, tool_result_json,
                             needs_approval, approved_by, approved_at, rejected_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    missionId,
    step.step_index,
    step.role,
    step.content,
    step.tool_name,
    step.tool_args_json,
    step.tool_result_json,
    step.needs_approval,
    step.approved_by,
    step.approved_at,
    step.rejected_reason
  );
  return Number(result.lastInsertRowid);
};

const getMission = (id: number): MissionRow | null =>
  (db.prepare(`SELECT * FROM agent_missions WHERE id = ?`).get(id) as MissionRow | undefined) ?? null;

const getSteps = (missionId: number): StepRow[] =>
  db.prepare(`SELECT * FROM agent_steps WHERE mission_id = ? ORDER BY step_index ASC`).all(missionId) as StepRow[];

/**
 * 把已有的 steps 重构成 Gemini contents（conversation history）
 */
const buildContents = (mission: MissionRow, steps: StepRow[]): Array<Record<string, unknown>> => {
  const contents: Array<Record<string, unknown>> = [];

  // v3.7.a · 数据飞轮：按 mission type 注入对应 best-practice few-shot
  let fewShot = '';
  try {
    const { buildFewShotBlock } = require('../src/services/best-practice-miner') as {
      buildFewShotBlock: (kind: string, limit?: number) => string;
    };
    if (mission.type === 'daily_content_sprint') {
      fewShot = buildFewShotBlock('content_top', 3);
    } else if (mission.type === 'lead_followup_sweep') {
      fewShot = buildFewShotBlock('script_top', 3);
    }
  } catch {
    fewShot = '';
  }

  // user 发起：goal（带 few-shot）
  contents.push({
    role: 'user',
    parts: [
      {
        text: `【任务】${mission.title}\n\n【目标参数】\n${mission.goal_json}${fewShot ? '\n\n' + fewShot : ''}\n\n请开始执行。`,
      },
    ],
  });

  for (const step of steps) {
    if (step.role === 'assistant' && step.content) {
      contents.push({ role: 'model', parts: [{ text: step.content }] });
    } else if (step.role === 'tool_call' && step.tool_name) {
      const args = step.tool_args_json ? JSON.parse(step.tool_args_json) : {};
      contents.push({
        role: 'model',
        parts: [{ functionCall: { name: step.tool_name, args } }],
      });
    } else if (step.role === 'tool_result' && step.tool_name) {
      const result = step.tool_result_json ? JSON.parse(step.tool_result_json) : {};
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: step.tool_name, response: result } }],
      });
    }
  }

  return contents;
};

const isPlatformAdminUser = (userId: number | null): boolean => {
  if (!userId) return false;
  const row = db.prepare(`SELECT role, tenant FROM users WHERE id = ?`).get(userId) as { role: string; tenant: string } | undefined;
  return Boolean(row && row.role === 'admin' && row.tenant === 'platform');
};

const buildToolContext = (mission: MissionRow): ToolContext => ({
  tenant: mission.tenant,
  isPlatformAdmin: isPlatformAdminUser(mission.created_by),
  missionId: mission.id,
  createdByUserId: mission.created_by,
});

type RuntimeStep =
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'no_action' };

const callGemini = async (mission: MissionRow, steps: StepRow[]): Promise<RuntimeStep> => {
  const ai = getAi();
  const contents = buildContents(mission, steps);
  const functionDeclarations = toGeminiFunctionDeclarations(ALL_TOOLS);

  // Gemini SDK 的 functionDeclarations 类型在不同版本有差异，用宽松类型保证跨版本可用
  const request = {
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations }],
    },
  };
  const callFn = ai.models.generateContent as unknown as (req: unknown) => Promise<unknown>;
  const response = await callFn(request);

  const candidates = (response as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> }).candidates ?? [];
  const parts = candidates[0]?.content?.parts ?? [];

  for (const part of parts) {
    const functionCall = (part as { functionCall?: { name: string; args?: Record<string, unknown> } }).functionCall;
    if (functionCall?.name) {
      return { type: 'tool_call', name: functionCall.name, args: functionCall.args ?? {} };
    }
    const text = (part as { text?: string }).text;
    if (typeof text === 'string' && text.trim()) {
      return { type: 'assistant_text', text: text.trim() };
    }
  }

  return { type: 'no_action' };
};

/** 执行单步循环；返回 true 表示还要继续，false 表示 mission 终止 */
const runOneIteration = async (missionId: number): Promise<boolean> => {
  const mission = getMission(missionId);
  if (!mission) return false;

  // 状态检查
  if (mission.status === 'succeeded' || mission.status === 'failed' || mission.status === 'canceled') return false;
  if (mission.status === 'waiting_approval') return false; // 等待外部触发

  // 首次运行初始化
  if (mission.status === 'queued') {
    updateMission(missionId, { status: 'running', started_at: new Date().toISOString() });
    // 记录 system step 标记开始
    recordStep(missionId, {
      step_index: 0,
      role: 'system',
      content: `Mission started · type=${mission.type} · tenant=${mission.tenant}`,
      tool_name: null,
      tool_args_json: null,
      tool_result_json: null,
      needs_approval: 0,
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
    });
  }

  // 超限检查
  if (mission.step_count >= MAX_STEPS) {
    updateMission(missionId, { status: 'failed', last_error: `达到最大步数 ${MAX_STEPS}`, finished_at: new Date().toISOString() });
    return false;
  }
  if (mission.approval_count >= MAX_APPROVALS) {
    updateMission(missionId, { status: 'failed', last_error: `审批次数超限 ${MAX_APPROVALS}`, finished_at: new Date().toISOString() });
    return false;
  }
  if (mission.started_at && Date.now() - new Date(mission.started_at).getTime() > MAX_DURATION_MS) {
    updateMission(missionId, { status: 'failed', last_error: '超出最大运行时间 30 分钟', finished_at: new Date().toISOString() });
    return false;
  }

  const steps = getSteps(missionId);
  const nextStepIndex = (steps[steps.length - 1]?.step_index ?? 0) + 1;

  // 调 Gemini
  let action: RuntimeStep;
  try {
    action = await callGemini(mission, steps);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('agent', 'Gemini 调用失败', { missionId, error: msg });
    updateMission(missionId, { status: 'failed', last_error: `Gemini 调用失败：${msg}`, finished_at: new Date().toISOString() });
    return false;
  }

  if (action.type === 'no_action') {
    recordStep(missionId, {
      step_index: nextStepIndex,
      role: 'assistant',
      content: '(Gemini 返回空动作)',
      tool_name: null,
      tool_args_json: null,
      tool_result_json: null,
      needs_approval: 0,
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
    });
    updateMission(missionId, { status: 'failed', last_error: 'Gemini 未返回任何动作', finished_at: new Date().toISOString(), step_count: nextStepIndex });
    return false;
  }

  if (action.type === 'assistant_text') {
    recordStep(missionId, {
      step_index: nextStepIndex,
      role: 'assistant',
      content: action.text,
      tool_name: null,
      tool_args_json: null,
      tool_result_json: null,
      needs_approval: 0,
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
    });
    updateMission(missionId, { step_count: nextStepIndex });
    return true;
  }

  // action.type === 'tool_call'
  const tool = getToolByName(action.name);
  if (!tool) {
    recordStep(missionId, {
      step_index: nextStepIndex,
      role: 'tool_result',
      content: null,
      tool_name: action.name,
      tool_args_json: JSON.stringify(action.args),
      tool_result_json: JSON.stringify({ error: `未知工具 ${action.name}` }),
      needs_approval: 0,
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
    });
    updateMission(missionId, { step_count: nextStepIndex });
    return true;
  }

  // 判断是否自动审批：只对 write_high 类型的 tool 检查 autoApprove 规则
  let autoApproved: { auto: boolean; reason: string } | null = null;
  if (needsApproval(tool) && tool.autoApprove) {
    try {
      const ctx = buildToolContext(mission);
      const decision = await tool.autoApprove(action.args, ctx);
      autoApproved = decision;
    } catch (error) {
      autoApproved = { auto: false, reason: `autoApprove 规则异常：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // 写 tool_call step
  const needsHumanApproval = needsApproval(tool) && !(autoApproved?.auto === true);
  recordStep(missionId, {
    step_index: nextStepIndex,
    role: 'tool_call',
    content: autoApproved?.auto
      ? `[自动审批] ${autoApproved.reason}`
      : (autoApproved ? `[规则未命中] ${autoApproved.reason}` : null),
    tool_name: action.name,
    tool_args_json: JSON.stringify(action.args),
    tool_result_json: null,
    needs_approval: needsHumanApproval ? 1 : 0,
    approved_by: autoApproved?.auto ? -1 : null,
    approved_at: autoApproved?.auto ? new Date().toISOString() : null,
    rejected_reason: null,
  });

  // 需要人工审批 → 暂停（write_high 且未自动批准）
  if (needsHumanApproval) {
    updateMission(missionId, {
      status: 'waiting_approval',
      step_count: nextStepIndex,
      approval_count: mission.approval_count + 1,
    });
    logger.info('agent', 'mission 暂停等待审批', { missionId, tool: action.name, rejectedAutoReason: autoApproved?.reason });
    return false;
  }

  if (autoApproved?.auto) {
    logger.info('agent', '命中自动审批白名单', { missionId, tool: action.name, reason: autoApproved.reason });
  }

  // 直接执行
  let result: unknown;
  try {
    const ctx = buildToolContext(mission);
    result = await tool.handler(action.args, ctx);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result = { error: msg };
  }

  const toolResultIndex = nextStepIndex + 1;
  recordStep(missionId, {
    step_index: toolResultIndex,
    role: 'tool_result',
    content: null,
    tool_name: action.name,
    tool_args_json: JSON.stringify(action.args),
    tool_result_json: JSON.stringify(result).slice(0, 8000),
    needs_approval: 0,
    approved_by: null,
    approved_at: null,
    rejected_reason: null,
  });
  updateMission(missionId, { step_count: toolResultIndex });

  // 终止类 tool
  if (isTerminal(tool)) {
    const summary = (result as { summary?: string; reason?: string }).summary
      ?? (result as { summary?: string; reason?: string }).reason
      ?? '';
    const finalStatus = action.name === 'finish_mission' ? 'succeeded' : 'canceled';
    updateMission(missionId, {
      status: finalStatus,
      summary,
      finished_at: new Date().toISOString(),
    });
    return false;
  }

  return true;
};

/** 执行 mission 直到暂停 / 终止；可被多次调用（恢复） */
export const runAgentMission = async (missionId: number): Promise<void> => {
  while (true) {
    const shouldContinue = await runOneIteration(missionId);
    if (!shouldContinue) break;
  }
};

/** 审批通过后恢复执行 mission（由 API 触发入队作业） */
export const resumeAgentMission = async (missionId: number): Promise<void> => {
  const mission = getMission(missionId);
  if (!mission || mission.status !== 'running') return;
  await runAgentMission(missionId);
};
