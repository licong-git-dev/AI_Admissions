/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Send,
  Smile,
  Paperclip,
  Copy,
  Edit,
  BrainCircuit,
  User,
  CheckCircle2,
  MoreVertical,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateStudentProfile, recommendScripts } from '../gemini-services';
import type { AiScriptResult, Lead, FollowUpRecord, LeadStatus, StudentProfileResult } from '../types';
import { cn } from '../lib/cn';

type AssistantLead = Lead & {
  avatar: string;
  profile: {
    concern: string;
    stage: string;
  };
  unread: number;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

const toAssistantLead = (lead: Lead): AssistantLead => ({
  ...lead,
  avatar: lead.nickname.slice(0, 1).toUpperCase(),
  unread: 0,
  profile: {
    concern: lead.lastMessage || '暂无沟通摘要',
    stage: lead.status,
  },
});

export default function WeChatAssistant() {
  const [leads, setLeads] = useState<AssistantLead[]>([]);
  const [activeLead, setActiveLead] = useState<AssistantLead | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [inputText, setInputText] = useState('');
  const [nextAction, setNextAction] = useState('继续微信跟进');
  const [nextFollowupAt, setNextFollowupAt] = useState('');
  const [nextStatus, setNextStatus] = useState<LeadStatus>('contacted');
  const [submitting, setSubmitting] = useState(false);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [aiScripts, setAiScripts] = useState<AiScriptResult | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfileResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLeadIdRef = useRef<string | null>(null);
  const activeLeadLoadIdRef = useRef(0);
  const followUpsRequestIdRef = useRef(0);
  const aiRequestIdRef = useRef(0);

  const showError = useCallback((msg: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrorMsg(msg);
    errorTimerRef.current = setTimeout(() => setErrorMsg(''), 4000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessMsg(msg);
    successTimerRef.current = setTimeout(() => setSuccessMsg(''), 2500);
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      const data = await fetchJson<Lead[]>('/api/leads');
      const mapped = data.map(toAssistantLead);
      setLeads(mapped);
      setActiveLead((current) => {
        if (current || mapped.length === 0) {
          return current;
        }

        setNextStatus(mapped[0].status);
        return mapped[0];
      });
    } catch {
      showError('线索列表加载失败，请确认后端服务已启动');
    }
  }, [showError]);

  const loadFollowUps = useCallback(async (leadId: string) => {
    const requestId = ++followUpsRequestIdRef.current;

    try {
      const data = await fetchJson<FollowUpRecord[]>(`/api/leads/${leadId}/follow-ups`);
      if (requestId !== followUpsRequestIdRef.current || activeLeadIdRef.current !== leadId) {
        return null;
      }

      setFollowUps(data);
      setHistoryLoadFailed(false);
      return data;
    } catch {
      if (requestId !== followUpsRequestIdRef.current || activeLeadIdRef.current !== leadId) {
        return null;
      }

      setHistoryLoadFailed(true);
      showError('跟进记录加载失败，请稍后重试');
      return null;
    }
  }, [showError]);

  const loadAiCapabilities = useCallback(async (lead: AssistantLead, history: FollowUpRecord[]) => {
    const requestId = ++aiRequestIdRef.current;
    setAiLoading(true);
    setAiScripts(null);
    setStudentProfile(null);
    try {
      const lastMsgs = history
        .map((item) => `${item.channel === 'manual' ? '顾问' : item.channel === 'wechat' ? '微信跟进' : '系统'}：${item.content}`)
        .join('\n') || `学员：${lead.lastMessage}`;
      const studentData = `昵称：${lead.nickname}\n来源：${lead.source}\n当前阶段：${lead.profile.stage}\n最近沟通摘要：${lead.profile.concern}`;
      const [profileResult, scriptResult] = await Promise.all([
        generateStudentProfile(studentData, lastMsgs, lead.id),
        recommendScripts(`${lead.nickname}，当前阶段：${lead.profile.stage}`, lastMsgs, lead.profile.concern, lead.id),
      ]);
      if (requestId !== aiRequestIdRef.current || activeLeadIdRef.current !== lead.id) {
        return;
      }

      setStudentProfile(profileResult);
      setAiScripts(scriptResult);
    } catch {
      if (requestId !== aiRequestIdRef.current || activeLeadIdRef.current !== lead.id) {
        return;
      }
      showError('AI 辅助生成失败，请稍后重试');
      setStudentProfile({
        profile: {
          intentMajor: '待进一步确认',
          mainConcerns: lead.profile.concern,
          stage: lead.profile.stage,
          decisionFactor: '需要补充更多沟通信息',
        },
        callPrep: {
          openingTopic: '先确认对方当前最关心的问题',
          keyPoints: ['确认学员当前问题', '避免承诺未确认信息', '记录新的关键信息'],
          objectionHandling: [
            { objection: '对方案仍有疑虑', response: '先确认顾虑点，再给出对应说明与下一步建议' },
          ],
          closingAction: '约定下一次沟通动作并及时记录',
        },
      });
      setAiScripts({
        scripts: [
          { text: '暂时无法生成推荐话术，请根据当前沟通内容手动回复，并保存本次跟进记录。', type: 'guide' },
        ],
        keyPoints: ['确认学员当前问题', '避免承诺未确认信息', '保存本次沟通记录'],
      });
    } finally {
      if (requestId === aiRequestIdRef.current && activeLeadIdRef.current === lead.id) {
        setAiLoading(false);
      }
    }
  }, [showError]);

  useEffect(() => {
    loadLeads();
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [loadLeads]);

  useEffect(() => {
    if (!activeLead) return;

    activeLeadIdRef.current = activeLead.id;
    const loadId = ++activeLeadLoadIdRef.current;
    setAiScripts(null);
    setStudentProfile({
      profile: {
        intentMajor: '待确认',
        mainConcerns: activeLead.profile.concern,
        stage: activeLead.profile.stage,
        decisionFactor: '待补充',
      },
      callPrep: {
        openingTopic: '先确认学员当前最关心的问题',
        keyPoints: ['等待跟进记录加载完成后生成建议'],
        objectionHandling: [],
        closingAction: '约定下一步沟通动作',
      },
    });

    void (async () => {
      const history = await loadFollowUps(activeLead.id);
      if (!history) {
        if (activeLeadIdRef.current !== activeLead.id || activeLeadLoadIdRef.current !== loadId) {
          return;
        }

        setAiScripts({
          scripts: [
            { text: '跟进记录加载失败，请先确认当前线索信息后再手动沟通。', type: 'guide' },
          ],
          keyPoints: ['刷新后重试', '避免沿用上一位线索的话术', '确认当前线索的核心问题'],
        });
        return;
      }
      await loadAiCapabilities(activeLead, history);
    })();
  }, [activeLead, loadFollowUps, loadAiCapabilities]);

  const handleLeadSelect = (lead: AssistantLead) => {
    setActiveLead(lead);
    setInputText('');
    setNextAction('继续微信跟进');
    setNextFollowupAt('');
    setNextStatus(lead.status);
  };

  const handleUseScript = (text: string) => {
    setInputText(text);
  };

  const handleCopyScript = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('话术已复制，可粘贴到微信发送');
    } catch {
      showError('复制失败，请手动复制');
    }
  };

  const handleSaveFollowUp = async () => {
    if (!activeLead || !inputText.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      const nextFollowupAtIso = nextFollowupAt ? new Date(nextFollowupAt).toISOString() : null;
      const result = await fetchJson<{ lead: Lead; followUp: FollowUpRecord }>(`/api/leads/${activeLead.id}/follow-up-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'wechat',
          content: inputText.trim(),
          nextAction: nextAction.trim() || '继续微信跟进',
          nextFollowupAt: nextFollowupAtIso,
          status: nextStatus,
          lastMessage: inputText.trim(),
        }),
      });

      const updatedLead = toAssistantLead(result.lead);
      setFollowUps((current) => [result.followUp, ...current]);
      setLeads((current) => [updatedLead, ...current.filter((lead) => lead.id !== activeLead.id)]);
      setActiveLead(updatedLead);
      setInputText('');
      setNextAction('继续微信跟进');
      setNextFollowupAt('');
      setNextStatus(result.lead.status);
      showSuccess('微信沟通记录已保存');
      window.dispatchEvent(new Event('dashboard-summary-refresh'));
    } catch {
      showError('沟通记录保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeLead) {
    return <div className="h-full flex items-center justify-center text-gray-400">暂无可用线索</div>;
  }

  return (
    <div className="h-full flex bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl shadow-lg"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">{errorMsg}</span>
          </motion.div>
        )}
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl shadow-lg"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-[300px] border-r border-gray-100 flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="搜索线索..." className="w-full pl-10 pr-4 py-2 bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm transition-all" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {leads.map((lead) => (
            <button
              key={lead.id}
              onClick={() => handleLeadSelect(lead)}
              className={cn(
                'w-full p-4 flex items-center gap-3 transition-all hover:bg-gray-50',
                activeLead.id === lead.id ? 'bg-emerald-50/50 border-r-2 border-emerald-500' : ''
              )}
            >
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
                {lead.avatar}
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-gray-900 truncate">{lead.nickname}</span>
                  <span className="text-[10px] text-gray-400">{lead.createdAt}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{lead.lastMessage}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 border-r border-gray-100">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
              {activeLead.avatar}
            </div>
            <div>
              <h3 className="font-bold text-sm text-gray-900">{activeLead.nickname}</h3>
              <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {activeLead.profile.stage}
              </div>
            </div>
          </div>
          <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
          {followUps.map((msg) => (
            <div key={msg.id} className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 bg-emerald-500 text-white">
                我
              </div>
              <div className="max-w-[80%] p-3 rounded-2xl text-sm shadow-sm bg-white text-gray-700 border border-gray-100">
                {msg.content}
                <p className="text-[10px] mt-1 opacity-50 text-left">{msg.createdAt}</p>
              </div>
            </div>
          ))}
          {historyLoadFailed && <p className="text-sm text-red-500">跟进记录加载失败，请稍后重试</p>}
          {!historyLoadFailed && followUps.length === 0 && <p className="text-sm text-gray-400">暂无跟进记录</p>}
        </div>

        <div className="p-4 bg-white border-t border-gray-100 space-y-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
            <input
              type="text"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="下一步动作"
              className="rounded-xl border-gray-200 bg-gray-50 px-3 py-2 text-xs focus:border-emerald-500 focus:bg-white focus:ring-0"
            />
            <input
              type="datetime-local"
              value={nextFollowupAt}
              onChange={(event) => setNextFollowupAt(event.target.value)}
              className="rounded-xl border-gray-200 bg-gray-50 px-3 py-2 text-xs focus:border-emerald-500 focus:bg-white focus:ring-0"
            />
            <select
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as LeadStatus)}
              className="rounded-xl border-gray-200 bg-gray-50 px-3 py-2 text-xs focus:border-emerald-500 focus:bg-white focus:ring-0"
            >
              <option value="contacted">已联系</option>
              <option value="following">跟进中</option>
              <option value="interested">意向明确</option>
              <option value="enrolled">已报名</option>
              <option value="lost">已流失</option>
            </select>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors"><Smile className="w-5 h-5" /></button>
            <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors"><Paperclip className="w-5 h-5" /></button>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入或采用 AI 话术，保存为微信沟通记录..."
              className="flex-1 min-h-[40px] max-h-[120px] p-2 bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm transition-all resize-none"
              rows={1}
            />
            <button
              onClick={handleSaveFollowUp}
              disabled={submitting || !inputText.trim()}
              className="p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-200 transition-all shadow-lg shadow-emerald-500/20 disabled:shadow-none"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="w-[350px] bg-gray-50/50 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-2 text-emerald-700 mb-4">
            <BrainCircuit className="w-5 h-5" />
            <h2 className="font-bold text-sm uppercase tracking-wider">AI 辅助面板</h2>
          </div>
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-3">
            <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">线索画像摘要</h3>
            <div className="grid grid-cols-2 gap-y-2 text-[11px]">
              <div className="text-emerald-600">意向专业</div>
              <div className="text-emerald-800 font-bold">{studentProfile?.profile?.intentMajor ?? '待确认'}</div>
              <div className="text-emerald-600">主要顾虑</div>
              <div className="text-emerald-800 font-bold">{studentProfile?.profile?.mainConcerns ?? activeLead.profile.concern}</div>
              <div className="text-emerald-600">沟通阶段</div>
              <div className="text-emerald-800 font-bold">{studentProfile?.profile?.stage ?? activeLead.profile.stage}</div>
              <div className="text-emerald-600">决策关键</div>
              <div className="text-emerald-800 font-bold">{studentProfile?.profile?.decisionFactor ?? '待补充'}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">AI 推荐回复</label>
            {aiLoading ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <div className="w-8 h-8 border-3 border-emerald-100 border-t-emerald-500 rounded-full animate-spin" />
                <p className="text-xs text-gray-400">AI 正在生成话术...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(aiScripts?.scripts ?? []).map((rec, i) => (
                  <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 group hover:border-emerald-200 transition-all">
                    <p className="text-sm text-gray-700 leading-relaxed">{rec.text}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">
                        {rec.type === 'direct' ? '直接回应' : rec.type === 'value' ? '增值信息' : rec.type === 'action' ? '行动引导' : '引导话术'}
                      </span>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={() => handleUseScript(rec.text)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 text-[10px] font-bold hover:bg-gray-100 transition-all"
                        >
                          <Edit className="w-3 h-3" /> 带入输入框
                        </button>
                        <button
                          onClick={() => void handleCopyScript(rec.text)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[10px] font-bold hover:bg-emerald-600 transition-all shadow-sm"
                        >
                          <Copy className="w-3 h-3" /> 复制话术
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">沟通要点清单</label>
            <div className="space-y-2">
              {(studentProfile?.callPrep?.keyPoints ?? aiScripts?.keyPoints ?? []).map((point, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  {point}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">电话沟通建议</label>
            <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 text-xs text-gray-600 shadow-sm">
              <div>
                <span className="font-bold text-gray-500">开场建议：</span>
                {studentProfile?.callPrep?.openingTopic ?? '先确认对方当前最关心的问题'}
              </div>
              <div>
                <span className="font-bold text-gray-500">收尾动作：</span>
                {studentProfile?.callPrep?.closingAction ?? '约定下一步沟通动作'}
              </div>
              {(studentProfile?.callPrep?.objectionHandling ?? []).map((item, index) => (
                <div key={`${item.objection}-${index}`} className="space-y-1 rounded-xl bg-gray-50 p-3">
                  <div><span className="font-bold text-gray-500">可能异议：</span>{item.objection}</div>
                  <div><span className="font-bold text-gray-500">建议回应：</span>{item.response}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
