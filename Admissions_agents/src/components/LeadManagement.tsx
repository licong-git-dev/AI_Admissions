/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Filter,
  Search,
  MessageCircle,
  Phone,
  History,
  BrainCircuit,
  X,
  AlertCircle,
  Copy,
  FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { INTENT_COLORS, LEAD_STATUS_OPTIONS, STATUS_LABELS } from '../constants';
import type { Lead, IntentAnalysis, FollowUpRecord, LeadStatus, EnrollmentRecord, PaymentSummary, ProposalCard, StudentProfileResult } from '../types';
import { analyzeIntent, generateStudentProfile } from '../gemini-services';
import { cn } from '../lib/cn';

interface LeadManagementProps {
  preset?: {
    searchText?: string;
    sourceFilter?: string;
    intentFilter?: string;
    statusFilter?: string;
    onlyNeedsFollowup?: boolean;
    sortBy?: 'latest' | 'priority' | 'intent';
  };
}

// v3.6.b
type JourneyEvent = { stage: string; label: string; at: string; detail: string | null };
type LeadJourney = {
  leadId: number;
  currentStage: string;
  currentStatus: string;
  events: JourneyEvent[];
  stagnantDays: number;
  isStuck: boolean;
};

const JOURNEY_STAGE_ICON: Record<string, string> = {
  submission: '📝',
  first_contact: '👋',
  high_intent: '🔥',
  deposit_paid: '💰',
  deal_signed: '✅',
  enrolled: '🎓',
  evaluation: '⭐',
};

const defaultAnalysis = (lead: Lead): IntentAnalysis => ({
  intent: lead.intent,
  analysis: '该用户询问了具体报名流程，表现出较强的转化意愿。建议重点介绍当前优惠政策并引导添加微信。',
  concerns: ['学费', '通过率'],
  suggestion: '建议立即跟进，发送专业介绍资料。',
  urgency: '立即'
});

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.replace('T', ' ');
  }

  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDateTimeLocalInput(value?: string | null): string {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.length >= 16 ? value.slice(0, 16) : value;
  }

  const localValue = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return localValue.toISOString().slice(0, 16);
}

function isDue(value?: string | null): boolean {
  return Boolean(value && Date.parse(value) <= Date.now());
}

export default function LeadManagement({ preset }: LeadManagementProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchText, setSearchText] = useState(preset?.searchText ?? '');
  const [sourceFilter, setSourceFilter] = useState(preset?.sourceFilter ?? 'all');
  const [intentFilter, setIntentFilter] = useState(preset?.intentFilter ?? 'all');
  const [statusFilter, setStatusFilter] = useState(preset?.statusFilter ?? 'all');
  const [onlyNeedsFollowup, setOnlyNeedsFollowup] = useState(preset?.onlyNeedsFollowup ?? false);
  const [sortBy, setSortBy] = useState<'latest' | 'priority' | 'intent'>(preset?.sortBy ?? 'priority');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [enrollment, setEnrollment] = useState<EnrollmentRecord | null>(null);
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [proposalCard, setProposalCard] = useState<ProposalCard | null>(null);
  const [followUpText, setFollowUpText] = useState('');
  const [followUpChannel, setFollowUpChannel] = useState<'wechat' | 'phone'>('wechat');
  const [nextAction, setNextAction] = useState('继续跟进');
  const [nextFollowupAt, setNextFollowupAt] = useState('');
  const [nextStatus, setNextStatus] = useState<LeadStatus>('contacted');
  const [schoolName, setSchoolName] = useState('');
  const [majorName, setMajorName] = useState('');
  const [enrollmentStage, setEnrollmentStage] = useState('consulting');
  const [enrollmentNote, setEnrollmentNote] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'全款' | '分期'>('全款');
  const [proposalPaymentMethod, setProposalPaymentMethod] = useState<'全款' | '分期'>('全款');
  const [firstPaidAt, setFirstPaidAt] = useState('');
  const [nextPaymentDueAt, setNextPaymentDueAt] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [proposalDuration, setProposalDuration] = useState('');
  const [proposalTuitionAmount, setProposalTuitionAmount] = useState('');
  const [proposalServiceAmount, setProposalServiceAmount] = useState('');
  const [proposalInstallmentsNote, setProposalInstallmentsNote] = useState('');
  const [proposalSuitableFor, setProposalSuitableFor] = useState('');
  const [proposalRiskNote, setProposalRiskNote] = useState('');
  const [proposalText, setProposalText] = useState('');
  const [proposalCopyText, setProposalCopyText] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<IntentAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [callPrep, setCallPrep] = useState<StudentProfileResult | null>(null);
  const [callPrepLoading, setCallPrepLoading] = useState(false);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaError, setPersonaError] = useState('');
  const [journey, setJourney] = useState<LeadJourney | null>(null);
  const [callOutcome, setCallOutcome] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadRequestIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const selectedLeadIdRef = useRef<string | null>(null);

  const showError = useCallback((msg: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrorMsg(msg);
    errorTimerRef.current = setTimeout(() => setErrorMsg(''), 4000);
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (searchText.trim()) {
        query.set('search', searchText.trim());
      }
      if (sourceFilter !== 'all') {
        query.set('source', sourceFilter);
      }
      if (intentFilter !== 'all') {
        query.set('intent', intentFilter);
      }
      if (statusFilter !== 'all' && statusFilter !== 'needsPayment') {
        query.set('status', statusFilter);
      }
      if (onlyNeedsFollowup) {
        query.set('needsFollowup', 'true');
      }
      if (statusFilter === 'needsPayment') {
        query.set('needsPayment', 'true');
      }
      query.set('sortBy', sortBy);
      const queryString = query.toString();
      const data = await fetchJson<Lead[]>(`/api/leads${queryString ? `?${queryString}` : ''}`);
      setLeads(data);
    } catch {
      showError('线索列表加载失败，请确认后端服务已启动');
    }
  }, [intentFilter, onlyNeedsFollowup, searchText, showError, sortBy, sourceFilter, statusFilter]);

  useEffect(() => {
    void loadLeads();
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [loadLeads]);

  useEffect(() => {
    if (!preset) {
      return;
    }

    setSearchText(preset.searchText ?? '');
    setSourceFilter(preset.sourceFilter ?? 'all');
    setIntentFilter(preset.intentFilter ?? 'all');
    setStatusFilter(preset.statusFilter ?? 'all');
    setOnlyNeedsFollowup(preset.onlyNeedsFollowup ?? false);
    setSortBy(preset.sortBy ?? 'priority');
  }, [preset]);

  const availableSources = useMemo(() => Array.from(new Set(leads.map((lead) => lead.source))), [leads]);

  const selectedSchoolSummary = useMemo(() => {
    const schoolLabel = schoolName.trim() || proposalCard?.schoolName || enrollment?.schoolName || '待推荐院校';
    const majorLabel = majorName.trim() || proposalCard?.majorName || enrollment?.majorName || '待推荐专业';
    return `${schoolLabel} / ${majorLabel}`;
  }, [enrollment?.majorName, enrollment?.schoolName, majorName, proposalCard?.majorName, proposalCard?.schoolName, schoolName]);

  const proposalTotalAmount = useMemo(() => {
    const tuition = Number(proposalTuitionAmount || 0);
    const service = Number(proposalServiceAmount || 0);
    return tuition + service;
  }, [proposalServiceAmount, proposalTuitionAmount]);

  const handleLeadClick = async (lead: Lead) => {
    const requestId = leadRequestIdRef.current + 1;
    leadRequestIdRef.current = requestId;
    selectedLeadIdRef.current = lead.id;

    setSelectedLead(lead);
    setIsPanelOpen(true);
    setFollowUps([]);
    setEnrollment(null);
    setPayment(null);
    setProposalCard(null);
    setFollowUpText('');
    setFollowUpChannel('wechat');
    setNextAction('继续跟进');
    setNextFollowupAt('');
    setNextStatus(lead.status);
    setSchoolName('');
    setMajorName('');
    setEnrollmentStage('consulting');
    setEnrollmentNote('');
    setTotalAmount('');
    setPaidAmount('');
    setPaymentMethod('全款');
    setProposalPaymentMethod('全款');
    setFirstPaidAt('');
    setNextPaymentDueAt('');
    setPaymentNote('');
    setProposalDuration('');
    setProposalTuitionAmount('');
    setProposalServiceAmount('');
    setProposalInstallmentsNote('');
    setProposalSuitableFor('');
    setProposalRiskNote('');
    setProposalText('');
    setProposalCopyText('');
    setAiAnalysis(null);
    setAiLoading(true);
    setJourney(null);

    // v3.6.b · 异步加载旅程时间线（不阻塞主流程）
    void fetchJson<LeadJourney>(`/api/leads/${lead.id}/journey`)
      .then((j) => { if (leadRequestIdRef.current === requestId) setJourney(j); })
      .catch(() => { /* ignore */ });

    let detail = lead;

    try {
      detail = await fetchJson<Lead>(`/api/leads/${lead.id}`);
      if (leadRequestIdRef.current !== requestId) {
        return;
      }
      setSelectedLead(detail);
      setNextStatus(detail.status);
    } catch {
      if (leadRequestIdRef.current !== requestId) {
        return;
      }
      showError('线索详情加载失败，已显示列表中的基础信息');
    }

    try {
      const [followUpsResult, enrollmentResult, paymentResult, proposalResult] = await Promise.allSettled([
        fetchJson<FollowUpRecord[]>(`/api/leads/${lead.id}/follow-ups`),
        fetchJson<EnrollmentRecord | null>(`/api/leads/${lead.id}/enrollment`),
        fetchJson<PaymentSummary | null>(`/api/leads/${lead.id}/payment`),
        fetchJson<ProposalCard | null>(`/api/leads/${lead.id}/proposal-card`),
      ]);
      if (leadRequestIdRef.current !== requestId) {
        return;
      }

      const followUpData = followUpsResult.status === 'fulfilled' ? followUpsResult.value : [];
      const enrollmentData = enrollmentResult.status === 'fulfilled' ? enrollmentResult.value : null;
      const paymentData = paymentResult.status === 'fulfilled' ? paymentResult.value : null;
      const proposalCardData = proposalResult.status === 'fulfilled' ? proposalResult.value : null;

      setFollowUps(followUpData);
      setEnrollment(enrollmentData);
      setPayment(paymentData);
      setProposalCard(proposalCardData);
      setSchoolName(enrollmentData?.schoolName ?? proposalCardData?.schoolName ?? '');
      setMajorName(enrollmentData?.majorName ?? proposalCardData?.majorName ?? '');
      setEnrollmentStage(enrollmentData?.stage ?? 'consulting');
      setEnrollmentNote(enrollmentData?.note ?? '');
      setTotalAmount(paymentData ? String(paymentData.totalAmount) : proposalCardData ? String(proposalCardData.totalAmount) : '');
      setPaidAmount(paymentData ? String(paymentData.paidAmount) : '');
      setPaymentMethod(paymentData?.method ?? '全款');
      setProposalPaymentMethod(proposalCardData?.paymentMethod ?? paymentData?.method ?? '全款');
      setFirstPaidAt(toDateTimeLocalInput(paymentData?.firstPaidAt));
      setNextPaymentDueAt(toDateTimeLocalInput(paymentData?.nextPaymentDueAt));
      setPaymentNote(paymentData?.note ?? '');
      setProposalDuration(proposalCardData?.duration ?? '');
      setProposalTuitionAmount(proposalCardData ? String(proposalCardData.tuitionAmount) : '');
      setProposalServiceAmount(proposalCardData ? String(proposalCardData.serviceAmount) : '');
      setProposalInstallmentsNote(proposalCardData?.installmentsNote ?? '');
      setProposalSuitableFor(proposalCardData?.suitableFor ?? '');
      setProposalRiskNote(proposalCardData?.riskNote ?? '');
      setProposalText(proposalCardData?.proposalText ?? '');
      setProposalCopyText(proposalCardData?.copyText ?? '');

      if (proposalResult.status === 'rejected') {
        showError('方案单加载失败，其他成交信息已正常显示');
      }
    } catch {
      if (leadRequestIdRef.current !== requestId) {
        return;
      }
      setFollowUps([]);
      setEnrollment(null);
      setPayment(null);
      setProposalCard(null);
      showError('线索成交信息加载失败');
    }

    try {
      const result = await analyzeIntent(detail.nickname, detail.source, detail.lastMessage, detail.id);
      if (leadRequestIdRef.current !== requestId) {
        return;
      }
      setAiAnalysis(result);
    } catch {
      if (leadRequestIdRef.current !== requestId) {
        return;
      }
      showError('AI 意向分析失败，已使用默认数据');
      setAiAnalysis(defaultAnalysis(detail));
    } finally {
      if (leadRequestIdRef.current === requestId) {
        setAiLoading(false);
      }
    }
  };

  const handleCreateFollowUp = async () => {
    if (!selectedLead || !followUpText.trim()) return;

    const activeLeadId = selectedLead.id;
    const activeLeadRequestId = leadRequestIdRef.current;
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    const nextFollowupAtValue = nextFollowupAt || null;

    try {
      const result = await fetchJson<{ lead: Lead; followUp: FollowUpRecord; enrollment: EnrollmentRecord | null; payment: PaymentSummary | null }>(`/api/leads/${activeLeadId}/follow-up-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: followUpChannel,
          content: followUpText.trim(),
          nextAction: nextAction.trim() || '继续跟进',
          nextFollowupAt: nextFollowupAtValue,
          status: nextStatus,
          lastMessage: followUpText.trim(),
        }),
      });

      if (saveRequestIdRef.current !== requestId || leadRequestIdRef.current !== activeLeadRequestId || selectedLeadIdRef.current !== activeLeadId) {
        return;
      }

      setFollowUpText('');
      setFollowUpChannel('wechat');
      setNextAction('继续跟进');
      setNextFollowupAt('');
      setSelectedLead(result.lead);
      setFollowUps((current) => [result.followUp, ...current]);
      setEnrollment(result.enrollment);
      setPayment(result.payment);
      setNextStatus(result.lead.status);
      void loadLeads();
      window.dispatchEvent(new Event('dashboard-summary-refresh'));
    } catch {
      if (saveRequestIdRef.current === requestId) {
        showError('跟进记录保存失败');
      }
    }
  };

  const handleSaveEnrollment = async () => {
    if (!selectedLead) return;

    const activeLeadId = selectedLead.id;
    const activeLeadRequestId = leadRequestIdRef.current;
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    try {
      const result = await fetchJson<{ enrollment: EnrollmentRecord; lead: Lead }>(`/api/leads/${activeLeadId}/enrollment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName,
          majorName,
          stage: enrollmentStage,
          note: enrollmentNote,
        }),
      });

      if (saveRequestIdRef.current !== requestId || leadRequestIdRef.current !== activeLeadRequestId || selectedLeadIdRef.current !== activeLeadId) {
        return;
      }

      setEnrollment(result.enrollment);
      setSelectedLead(result.lead);
      setNextStatus(result.lead.status);
      void loadLeads();
      window.dispatchEvent(new Event('dashboard-summary-refresh'));
    } catch {
      if (saveRequestIdRef.current === requestId) {
        showError('报名推进保存失败');
      }
    }
  };

  const handleInferPersona = async () => {
    if (!selectedLead) return;
    setPersonaLoading(true);
    setPersonaError('');
    try {
      const persona = await fetchJson<Lead['persona']>(`/api/leads/${selectedLead.id}/infer-persona`, {
        method: 'POST',
      });
      setSelectedLead({ ...selectedLead, persona });
    } catch (err) {
      setPersonaError(err instanceof Error ? err.message : '人设推断失败');
    } finally {
      setPersonaLoading(false);
    }
  };

  const handleSavePayment = async () => {
    if (!selectedLead) return;

    const parsedTotalAmount = Number(totalAmount || 0);
    const parsedPaidAmount = Number(paidAmount || 0);

    if (parsedTotalAmount < 0 || parsedPaidAmount < 0 || parsedPaidAmount > parsedTotalAmount) {
      showError('缴费金额不合法：已收金额不能大于应收金额');
      return;
    }

    const activeLeadId = selectedLead.id;
    const activeLeadRequestId = leadRequestIdRef.current;
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    try {
      const result = await fetchJson<{ payment: PaymentSummary; lead: Lead }>(`/api/leads/${activeLeadId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalAmount: parsedTotalAmount,
          paidAmount: parsedPaidAmount,
          method: paymentMethod,
          firstPaidAt: firstPaidAt || null,
          nextPaymentDueAt: nextPaymentDueAt || null,
          note: paymentNote,
        }),
      });

      if (saveRequestIdRef.current !== requestId || leadRequestIdRef.current !== activeLeadRequestId || selectedLeadIdRef.current !== activeLeadId) {
        return;
      }

      setPayment(result.payment);
      setSelectedLead(result.lead);
      setNextStatus(result.lead.status);
      void loadLeads();
      window.dispatchEvent(new Event('dashboard-summary-refresh'));
    } catch {
      if (saveRequestIdRef.current === requestId) {
        showError('缴费登记保存失败');
      }
    }
  };

  const handleSaveProposalCard = async () => {
    if (!selectedLead) return;

    const tuitionAmount = Number(proposalTuitionAmount || 0);
    const serviceAmount = Number(proposalServiceAmount || 0);

    if (tuitionAmount < 0 || serviceAmount < 0) {
      showError('方案金额不能为负数');
      return;
    }

    const activeLeadId = selectedLead.id;
    const activeLeadRequestId = leadRequestIdRef.current;
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    try {
      const result = await fetchJson<ProposalCard>(`/api/leads/${activeLeadId}/proposal-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName,
          majorName,
          duration: proposalDuration,
          tuitionAmount,
          serviceAmount,
          totalAmount: proposalTotalAmount,
          paymentMethod: proposalPaymentMethod,
          installmentsNote: proposalInstallmentsNote,
          suitableFor: proposalSuitableFor,
          riskNote: proposalRiskNote,
          proposalText,
          copyText: proposalCopyText || proposalText,
        }),
      });

      if (saveRequestIdRef.current !== requestId || leadRequestIdRef.current !== activeLeadRequestId || selectedLeadIdRef.current !== activeLeadId) {
        return;
      }

      setProposalCard(result);
      setProposalCopyText(result.copyText);
      setProposalText(result.proposalText);
      if (!payment) {
        setTotalAmount(String(result.totalAmount));
      }
      void loadLeads();
    } catch {
      if (saveRequestIdRef.current === requestId) {
        showError('方案单保存失败');
      }
    }
  };

  const handleCopyProposalCard = async () => {
    const text = proposalCopyText.trim() || proposalText.trim() || proposalCard?.copyText || '';
    if (!text) {
      showError('暂无可复制的方案内容');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      showError('复制失败，请手动复制方案内容');
    }
  };

  return (
    <div className="h-full flex flex-col gap-6">
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
      </AnimatePresence>

      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100 flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            type="text"
            placeholder="搜索昵称、联系方式、消息、负责人..."
            className="bg-transparent border-none focus:ring-0 text-sm w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="text-sm border-gray-100 rounded-xl bg-gray-50 px-4 py-2">
            <option value="all">全部来源</option>
            {['小红书', '抖音', '快手', ...availableSources.filter((source) => !['小红书', '抖音', '快手'].includes(source))].map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          <select value={intentFilter} onChange={(event) => setIntentFilter(event.target.value)} className="text-sm border-gray-100 rounded-xl bg-gray-50 px-4 py-2">
            <option value="all">全部意向</option>
            <option value="high">高意向</option>
            <option value="medium">中意向</option>
            <option value="low">低意向</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="text-sm border-gray-100 rounded-xl bg-gray-50 px-4 py-2">
            <option value="all">全部状态</option>
            <option value="needsPayment">待催缴</option>
            {LEAD_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'latest' | 'priority' | 'intent')} className="text-sm border-gray-100 rounded-xl bg-gray-50 px-4 py-2">
            <option value="priority">待跟进优先</option>
            <option value="intent">高意向优先</option>
            <option value="latest">最新线索</option>
          </select>
        </div>
        <button
          onClick={() => setOnlyNeedsFollowup((current) => !current)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-colors border',
            onlyNeedsFollowup
              ? 'bg-blue-50 border-blue-100 text-blue-700'
              : 'bg-white border-gray-100 text-gray-500 hover:bg-gray-50'
          )}
        >
          <Filter className="w-4 h-4" />
          只看待跟进
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-4 font-medium">来源平台</th>
                <th className="text-left px-6 py-4 font-medium">用户昵称</th>
                <th className="text-left px-6 py-4 font-medium">意向等级</th>
                <th className="text-left px-6 py-4 font-medium">最新消息摘要</th>
                <th className="text-left px-6 py-4 font-medium">跟进状态</th>
                <th className="text-left px-6 py-4 font-medium">负责人</th>
                <th className="text-left px-6 py-4 font-medium">下次动作</th>
                <th className="text-left px-6 py-4 font-medium">下次跟进</th>
                <th className="text-right px-6 py-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leads.map((lead) => {
                const leadIsDue = isDue(lead.latestNextFollowupAt);
                return (
                  <tr
                    key={lead.id}
                    className={cn(
                      'hover:bg-gray-50 transition-colors cursor-pointer group',
                      leadIsDue && 'bg-blue-50/50'
                    )}
                    onClick={() => handleLeadClick(lead)}
                  >
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-bold text-gray-900">{lead.nickname}</td>
                    <td className="px-6 py-4">
                      <span className={cn("px-2 py-1 rounded-lg text-[10px] font-bold uppercase border", INTENT_COLORS[lead.intent])}>
                        {lead.intent === 'high' ? '高意向' : lead.intent === 'medium' ? '中意向' : '低意向'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 max-w-[200px] truncate">{lead.lastMessage}</td>
                    <td className="px-6 py-4">
                      <span className="flex items-center gap-1.5 text-gray-600">
                        <div className={cn('w-1.5 h-1.5 rounded-full', leadIsDue ? 'bg-blue-500' : 'bg-emerald-500')} />
                        {STATUS_LABELS[lead.status] ?? lead.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{lead.assignee}</td>
                    <td className="px-6 py-4 text-gray-600 max-w-[180px] truncate">{lead.latestNextAction ?? '-'}</td>
                    <td className={cn('px-6 py-4', leadIsDue ? 'text-blue-700 font-bold' : 'text-gray-500')}>
                      {formatDateTime(lead.latestNextFollowupAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleLeadClick(lead); }}
                        className="px-3 py-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-all"
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isPanelOpen && selectedLead && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPanelOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-[450px] bg-white shadow-2xl z-[70] flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    {selectedLead.nickname[0]}
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{selectedLead.nickname}</h3>
                    <p className="text-xs text-gray-400">来自 {selectedLead.source} · {selectedLead.createdAt}</p>
                  </div>
                </div>
                <button onClick={() => setIsPanelOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* v3.5.b · AI 学员人设 */}
                <div className="p-5 bg-purple-50 rounded-2xl border border-purple-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-purple-700">
                      <span className="text-base">👤</span>
                      <span className="text-sm font-bold uppercase tracking-wider">AI 学员人设</span>
                    </div>
                    <button
                      onClick={handleInferPersona}
                      disabled={personaLoading}
                      className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded disabled:opacity-50"
                    >
                      {personaLoading ? '推断中…' : selectedLead.persona ? '重新推断' : '一键推断'}
                    </button>
                  </div>

                  {personaError && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{personaError}</div>
                  )}

                  {selectedLead.persona ? (
                    <div className="space-y-2.5 text-sm">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <PersonaTag label="年龄段" value={selectedLead.persona.ageBand} />
                        <PersonaTag label="学历阶段" value={selectedLead.persona.educationStage} />
                        <PersonaTag label="价格敏感" value={selectedLead.persona.priceSensitivity} />
                        <PersonaTag label="决策窗口" value={selectedLead.persona.decisionWindow} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-purple-600 uppercase mb-0.5">职业</div>
                        <div className="text-purple-900">{selectedLead.persona.occupation}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-purple-600 uppercase mb-0.5">主要痛点</div>
                        <div className="text-purple-900">{selectedLead.persona.primaryPainPoint}</div>
                      </div>
                      <div className="p-3 bg-white border border-purple-200 rounded-lg">
                        <div className="text-[10px] font-bold text-purple-600 uppercase mb-1">推荐话术（直接复制）</div>
                        <div className="text-sm text-gray-800 leading-relaxed">{selectedLead.persona.recommendedScript}</div>
                      </div>
                      {selectedLead.persona.redFlags.length > 0 && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded">
                          <div className="text-[10px] font-bold text-amber-700 mb-1">⚠️ 风险点</div>
                          {selectedLead.persona.redFlags.map((f, i) => (
                            <div key={i} className="text-xs text-amber-800">· {f}</div>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-gray-500">
                        置信度 {selectedLead.persona.confidence === 'high' ? '高' : selectedLead.persona.confidence === 'medium' ? '中' : '低'}
                        · {selectedLead.persona.source === 'ai' ? 'Gemini 推断' : '规则推断'}
                        · {new Date(selectedLead.persona.inferredAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">
                      点「一键推断」让 AI 根据私信和跟进记录推断学员画像，给你直接可用的话术。
                    </div>
                  )}
                </div>

                {/* v3.6.b · 学员旅程时间线 */}
                {journey && journey.events.length > 0 && (
                  <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-blue-700">
                        <span className="text-base">🗺️</span>
                        <span className="text-sm font-bold uppercase tracking-wider">学员旅程</span>
                      </div>
                      {journey.isStuck && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded-full">
                          ⚠️ 卡住 {journey.stagnantDays} 天
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {journey.events.map((ev, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className="shrink-0 w-7 h-7 rounded-full bg-white border border-blue-200 flex items-center justify-center text-xs">
                            {JOURNEY_STAGE_ICON[ev.stage] ?? '·'}
                          </div>
                          <div className="flex-1 min-w-0 pt-1">
                            <div className="text-xs font-semibold text-blue-900">{ev.label}</div>
                            {ev.detail && <div className="text-[11px] text-gray-600 truncate">{ev.detail}</div>}
                            <div className="text-[10px] text-gray-400">{new Date(ev.at).toLocaleString('zh-CN')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {!journey.isStuck && journey.events.length < 5 && (
                      <div className="text-[10px] text-gray-500 italic">
                        提示：建议把这条线索推到下一步「{nextStageHint(journey.currentStage)}」
                      </div>
                    )}
                  </div>
                )}

                <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <BrainCircuit className="w-5 h-5" />
                      <span className="text-sm font-bold uppercase tracking-wider">AI 意向分析</span>
                    </div>
                    <span className={cn("px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase border", INTENT_COLORS[selectedLead.intent])}>
                      {selectedLead.intent === 'high' ? '高意向' : selectedLead.intent === 'medium' ? '中意向' : '低意向'}
                    </span>
                  </div>
                  {aiLoading ? (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <div className="w-4 h-4 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                      <span className="text-sm">AI 正在分析...</span>
                    </div>
                  ) : aiAnalysis ? (
                    <div className="space-y-3">
                      <p className="text-sm text-emerald-800 leading-relaxed">{aiAnalysis.analysis}</p>
                      <div>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">顾虑点</p>
                        <div className="flex flex-wrap gap-1">
                          {aiAnalysis.concerns.map((c, i) => (
                            <span key={i} className="px-2 py-0.5 bg-white text-emerald-700 text-[10px] font-bold rounded-lg border border-emerald-100">{c}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-emerald-100">
                        <p className="text-xs text-emerald-700"><strong>建议：</strong>{aiAnalysis.suggestion}</p>
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">{aiAnalysis.urgency}</span>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setFollowUpChannel('wechat')}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all',
                      followUpChannel === 'wechat'
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                        : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <MessageCircle className="w-4 h-4" />
                    微信沟通
                  </button>
                  <button
                    onClick={() => setFollowUpChannel('phone')}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all',
                      followUpChannel === 'phone'
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                        : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <Phone className="w-4 h-4" />
                    电话联系
                  </button>
                </div>

                {followUpChannel === 'phone' && selectedLead && (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-sky-900 flex items-center gap-1.5">
                        <BrainCircuit className="w-4 h-4" />
                        电话前 AI 准备
                      </h4>
                      <button
                        onClick={async () => {
                          if (!selectedLead) return;
                          setCallPrepLoading(true);
                          try {
                            const studentData = `昵称：${selectedLead.nickname}；来源：${selectedLead.source}；意向：${selectedLead.intent}；状态：${STATUS_LABELS[selectedLead.status] || selectedLead.status}；负责人：${selectedLead.assignee}`;
                            const chatHistory = (followUps.length > 0
                              ? followUps.slice(0, 5).map((f) => `[${f.channel}] ${f.content}`).join('\n')
                              : selectedLead.lastMessage || '暂无历史沟通记录');
                            const result = await generateStudentProfile(studentData, chatHistory, selectedLead.id);
                            setCallPrep(result);
                          } catch (err) {
                            showError(err instanceof Error ? err.message : 'AI 画像生成失败');
                          } finally {
                            setCallPrepLoading(false);
                          }
                        }}
                        disabled={callPrepLoading}
                        className="px-3 py-1 rounded-lg bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 disabled:opacity-50"
                      >
                        {callPrepLoading ? '生成中…' : callPrep ? '重新生成' : '一键生成画像'}
                      </button>
                    </div>

                    {callPrep ? (
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-white p-2 border border-sky-100">
                            <p className="text-[10px] font-bold text-sky-700 uppercase mb-0.5">意向专业</p>
                            <p className="text-gray-800">{callPrep.profile.intentMajor}</p>
                          </div>
                          <div className="rounded-lg bg-white p-2 border border-sky-100">
                            <p className="text-[10px] font-bold text-sky-700 uppercase mb-0.5">当前阶段</p>
                            <p className="text-gray-800">{callPrep.profile.stage}</p>
                          </div>
                          <div className="rounded-lg bg-white p-2 border border-sky-100 col-span-2">
                            <p className="text-[10px] font-bold text-sky-700 uppercase mb-0.5">主要顾虑</p>
                            <p className="text-gray-800">{callPrep.profile.mainConcerns}</p>
                          </div>
                          <div className="rounded-lg bg-white p-2 border border-sky-100 col-span-2">
                            <p className="text-[10px] font-bold text-sky-700 uppercase mb-0.5">决策关键</p>
                            <p className="text-gray-800">{callPrep.profile.decisionFactor}</p>
                          </div>
                        </div>

                        <div className="rounded-lg bg-white p-3 border border-sky-100 space-y-2">
                          <p className="text-[10px] font-bold text-sky-700 uppercase">开场话题</p>
                          <p className="text-sm text-gray-800">{callPrep.callPrep.openingTopic}</p>

                          {callPrep.callPrep.keyPoints.length > 0 && (
                            <>
                              <p className="text-[10px] font-bold text-sky-700 uppercase pt-2">沟通要点</p>
                              <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5">
                                {callPrep.callPrep.keyPoints.map((p, i) => (
                                  <li key={i}>{p}</li>
                                ))}
                              </ul>
                            </>
                          )}

                          {callPrep.callPrep.objectionHandling.length > 0 && (
                            <>
                              <p className="text-[10px] font-bold text-sky-700 uppercase pt-2">异议处理</p>
                              <div className="space-y-1">
                                {callPrep.callPrep.objectionHandling.map((item, i) => (
                                  <div key={i} className="bg-sky-50 rounded px-2 py-1 text-xs">
                                    <span className="text-sky-700 font-semibold">Q: </span>
                                    <span className="text-gray-700">{item.objection}</span>
                                    <br />
                                    <span className="text-emerald-700 font-semibold">A: </span>
                                    <span className="text-gray-700">{item.response}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}

                          <p className="text-[10px] font-bold text-sky-700 uppercase pt-2">收尾动作</p>
                          <p className="text-sm text-gray-800">{callPrep.callPrep.closingAction}</p>
                        </div>

                        <div className="rounded-lg bg-white p-2 border border-sky-100">
                          <label className="text-[10px] font-bold text-sky-700 uppercase">通话结果登记</label>
                          <textarea
                            value={callOutcome}
                            onChange={(e) => setCallOutcome(e.target.value)}
                            rows={2}
                            placeholder="通话要点 / 学员反馈 / 下一步动作（保存后会作为跟进记录写入）"
                            className="w-full mt-1 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => {
                              if (callOutcome.trim()) {
                                setFollowUpChannel('phone');
                                setFollowUpText(callOutcome);
                                setCallOutcome('');
                              }
                            }}
                            disabled={!callOutcome.trim()}
                            className="mt-2 text-[11px] font-bold text-sky-700 hover:text-sky-900 disabled:opacity-40"
                          >
                            → 填入跟进记录表单（仍需点下方保存）
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-sky-700">
                        点击右上角「一键生成画像」，AI 会基于当前学员资料和沟通历史生成电话前准备单，
                        包含开场话题 / 沟通要点 / 异议处理 / 收尾动作。
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-amber-900">成交资产区</h4>
                    <span className="text-[10px] font-bold text-amber-700 bg-white px-2 py-1 rounded-lg">转化工作台</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-white p-3 border border-amber-100">
                      <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">诊断结论</p>
                      <p className="text-gray-700 leading-relaxed">{aiAnalysis?.analysis ?? '等待 AI 诊断结果'}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 border border-amber-100">
                      <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">推荐院校 / 专业</p>
                      <p className="text-gray-700 font-medium">{selectedSchoolSummary}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 border border-amber-100">
                      <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">报价摘要</p>
                      <p className="text-gray-700">应收 ¥{(() => {
                        const proposalAmount = proposalCard?.totalAmount ?? proposalTotalAmount;
                        const paymentAmount = Number(totalAmount || 0);
                        return (proposalAmount > 0 ? proposalAmount : paymentAmount).toLocaleString();
                      })()}，已收 ¥{Number(paidAmount || 0).toLocaleString()}，{proposalPaymentMethod}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 border border-amber-100">
                      <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">下次动作 / 催缴节点</p>
                      <p className="text-gray-700">{nextAction || '继续跟进'} · {formatDateTime(nextPaymentDueAt || nextFollowupAt || payment?.nextPaymentDueAt)}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">成交推进</label>
                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>报读院校</span>
                        <input
                          type="text"
                          value={schoolName}
                          onChange={(event) => setSchoolName(event.target.value)}
                          placeholder="例如：广东开放大学"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>报读专业</span>
                        <input
                          type="text"
                          value={majorName}
                          onChange={(event) => setMajorName(event.target.value)}
                          placeholder="例如：会计学"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                    </div>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>报名阶段</span>
                      <select
                        value={enrollmentStage}
                        onChange={(event) => setEnrollmentStage(event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      >
                        <option value="consulting">咨询中</option>
                        <option value="applying">报名申请中</option>
                        <option value="applied">已提交报名</option>
                        <option value="reviewing">资料审核中</option>
                        <option value="completed">报名完成</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>报名备注</span>
                      <input
                        type="text"
                        value={enrollmentNote}
                        onChange={(event) => setEnrollmentNote(event.target.value)}
                        placeholder="例如：已发报名表，等待身份证照片"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <button
                      onClick={handleSaveEnrollment}
                      className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 transition-all"
                    >
                      保存报名推进
                    </button>
                    {enrollment && (
                      <p className="text-xs text-gray-500">当前记录：{enrollment.schoolName || '未填写院校'} / {enrollment.majorName || '未填写专业'} / {enrollment.stage}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">报价单 / 方案单</label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveProposalCard}
                          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 transition-all"
                        >
                          <FileText className="w-4 h-4" />
                          保存方案单
                        </button>
                        <button
                          onClick={handleCopyProposalCard}
                          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-700 hover:bg-amber-50 transition-all"
                        >
                          <Copy className="w-4 h-4" />
                          复制方案单
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>学制说明</span>
                        <input
                          type="text"
                          value={proposalDuration}
                          onChange={(event) => setProposalDuration(event.target.value)}
                          placeholder="例如：2.5年"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>方案缴费方式</span>
                        <select
                          value={proposalPaymentMethod}
                          onChange={(event) => setProposalPaymentMethod(event.target.value as '全款' | '分期')}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        >
                          <option value="全款">全款</option>
                          <option value="分期">分期</option>
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>学费金额</span>
                        <input
                          type="number"
                          value={proposalTuitionAmount}
                          onChange={(event) => setProposalTuitionAmount(event.target.value)}
                          placeholder="9800"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>服务费金额</span>
                        <input
                          type="number"
                          value={proposalServiceAmount}
                          onChange={(event) => setProposalServiceAmount(event.target.value)}
                          placeholder="3000"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>方案总额</span>
                        <input
                          type="text"
                          value={`¥${proposalTotalAmount.toLocaleString()}`}
                          readOnly
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                    </div>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>分期说明</span>
                      <input
                        type="text"
                        value={proposalInstallmentsNote}
                        onChange={(event) => setProposalInstallmentsNote(event.target.value)}
                        placeholder="例如：首付3000，剩余两期付清"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>适合人群</span>
                      <input
                        type="text"
                        value={proposalSuitableFor}
                        onChange={(event) => setProposalSuitableFor(event.target.value)}
                        placeholder="例如：在职提升学历、希望稳妥毕业"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>风险提示</span>
                      <input
                        type="text"
                        value={proposalRiskNote}
                        onChange={(event) => setProposalRiskNote(event.target.value)}
                        placeholder="例如：需按时提交资料并配合学习节点"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>方案正文</span>
                      <textarea
                        value={proposalText}
                        onChange={(event) => setProposalText(event.target.value)}
                        placeholder="输入发给高意向线索的完整方案说明"
                        rows={5}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>复制文案</span>
                      <textarea
                        value={proposalCopyText}
                        onChange={(event) => setProposalCopyText(event.target.value)}
                        placeholder="保存后可一键复制发送"
                        rows={5}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    {proposalCard && (
                      <p className="text-xs text-gray-500">已保存方案：{proposalCard.schoolName || '未填写院校'} / {proposalCard.majorName || '未填写专业'} / ¥{proposalCard.totalAmount.toLocaleString()}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>应收金额</span>
                        <input
                          type="number"
                          value={totalAmount}
                          onChange={(event) => setTotalAmount(event.target.value)}
                          placeholder="12800"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>已收金额</span>
                        <input
                          type="number"
                          value={paidAmount}
                          onChange={(event) => setPaidAmount(event.target.value)}
                          placeholder="3000"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>缴费方式</span>
                        <select
                          value={paymentMethod}
                          onChange={(event) => setPaymentMethod(event.target.value as '全款' | '分期')}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        >
                          <option value="全款">全款</option>
                          <option value="分期">分期</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>首付款时间</span>
                        <input
                          type="datetime-local"
                          value={firstPaidAt}
                          onChange={(event) => setFirstPaidAt(event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                    </div>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>下次催缴时间</span>
                      <input
                        type="datetime-local"
                        value={nextPaymentDueAt}
                        onChange={(event) => setNextPaymentDueAt(event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>缴费备注</span>
                      <input
                        type="text"
                        value={paymentNote}
                        onChange={(event) => setPaymentNote(event.target.value)}
                        placeholder="例如：已收首付款，尾款下周三前补齐"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                    <button
                      onClick={handleSavePayment}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 transition-all"
                    >
                      保存缴费登记
                    </button>
                    {payment && (
                      <p className="text-xs text-gray-500">当前缴费：已收 ¥{payment.paidAmount} / 应收 ¥{payment.totalAmount}</p>
                    )}
                  </div>

                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">跟进记录</label>
                  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>推进到状态</span>
                        <select
                          value={nextStatus}
                          onChange={(event) => setNextStatus(event.target.value as LeadStatus)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        >
                          {LEAD_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <span>下次跟进时间</span>
                        <input
                          type="datetime-local"
                          value={nextFollowupAt}
                          onChange={(event) => setNextFollowupAt(event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                        />
                      </label>
                    </div>
                    <label className="space-y-1 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <span>下一步动作</span>
                      <input
                        type="text"
                        value={nextAction}
                        onChange={(event) => setNextAction(event.target.value)}
                        placeholder="例如：明天下午电话沟通 / 发送招生简章"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                      />
                    </label>
                  </div>
                  <div className="space-y-4 border-l-2 border-gray-100 ml-2 pl-6">
                    {followUps.map((log) => (
                      <div key={log.id} className="relative">
                        <div className="absolute -left-[31px] top-1 w-2.5 h-2.5 rounded-full bg-gray-200 border-2 border-white" />
                        <p className="text-[10px] text-gray-400 font-bold uppercase">{log.createdAt}</p>
                        <p className="text-sm text-gray-600 mt-1">{log.content}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">
                            渠道：{log.channel === 'phone' ? '电话' : log.channel === 'wechat' ? '微信' : log.channel}
                          </span>
                          {log.nextAction && <span className="rounded-lg bg-gray-100 px-2 py-1">下一步：{log.nextAction}</span>}
                          {log.nextFollowupAt && <span className="rounded-lg bg-blue-50 px-2 py-1 text-blue-600">跟进时间：{log.nextFollowupAt}</span>}
                        </div>
                      </div>
                    ))}
                    {followUps.length === 0 && <p className="text-sm text-gray-400">暂无跟进记录</p>}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={followUpText}
                    onChange={(event) => setFollowUpText(event.target.value)}
                    placeholder="输入跟进记录..."
                    className="flex-1 bg-white border-gray-200 rounded-xl text-sm focus:border-emerald-500 focus:ring-0"
                  />
                  <button onClick={handleCreateFollowUp} className="p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all">
                    <History className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

const PERSONA_LABELS: Record<string, string> = {
  '20s': '20-29 岁',
  '30s': '30-39 岁',
  '40s+': '40 岁以上',
  highschool: '高中/中专',
  associate: '大专/在职',
  bachelor: '本科',
  low: '低敏感',
  medium: '中敏感',
  high: '高敏感',
  within_week: '本周内',
  within_month: '本月内',
  browsing: '随便看看',
  unknown: '待确认',
};

function PersonaTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-1.5 bg-white rounded border border-purple-100">
      <span className="text-[10px] text-purple-500">{label}</span>
      <span className="text-xs text-purple-900 font-medium">{PERSONA_LABELS[value] ?? value}</span>
    </div>
  );
}

function nextStageHint(currentStage: string): string {
  switch (currentStage) {
    case 'submission': return '联系并安排首次跟进';
    case 'first_contact': return '把握高意向信号，推送方案';
    case 'high_intent': return '引导缴定金锁定意向';
    case 'deposit_paid': return '推动签约与缴学费';
    case 'deal_signed': return '完成报名材料 + 入学';
    case 'enrolled': return '邀请学员评价（v3.6.a）';
    default: return '继续推进';
  }
}
