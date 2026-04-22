/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 统一 AI 服务层（通过后端代理）
 */

import type { GeneratedContent, IntentAnalysis, AiScriptResult, StudentProfileResult } from "./types";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

export async function generateContent(
  contentType: string,
  platforms: string[],
  requirements: string
): Promise<Record<string, GeneratedContent>> {
  return postJson<Record<string, GeneratedContent>>('/api/ai/generate-content', {
    contentType,
    platforms,
    requirements,
  });
}

export async function analyzeIntent(
  nickname: string,
  source: string,
  message: string,
  leadId?: string
): Promise<IntentAnalysis> {
  return postJson<IntentAnalysis>('/api/ai/analyze-intent', {
    nickname,
    source,
    message,
    leadId: leadId ? Number(leadId) : undefined,
  });
}

export async function recommendScripts(
  studentProfile: string,
  lastMessages: string,
  concern: string,
  leadId?: string
): Promise<AiScriptResult> {
  return postJson<AiScriptResult>('/api/ai/recommend-scripts', {
    studentProfile,
    lastMessages,
    concern,
    leadId: leadId ? Number(leadId) : undefined,
  });
}

export async function generateStudentProfile(
  studentData: string,
  chatHistory: string,
  leadId?: string
): Promise<StudentProfileResult> {
  return postJson<StudentProfileResult>('/api/ai/student-profile', {
    studentData,
    chatHistory,
    leadId: leadId ? Number(leadId) : undefined,
  });
}
