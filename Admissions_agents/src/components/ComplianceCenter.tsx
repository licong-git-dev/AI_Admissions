/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  FileText,
  UserCheck,
  Database,
  Ban,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Star,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { authJson } from '../lib/auth';

type Agreement = {
  id: number;
  type: 'privacy_policy' | 'user_agreement' | 'personal_info_authorization';
  version: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  legalReviewed?: boolean;
  legalReviewedBy?: string | null;
  legalReviewedAt?: string | null;
};

type ConsentRecord = {
  id: number;
  phone: string;
  agreementId: number;
  agreementType: string;
  agreementVersion: string;
  ip: string | null;
  ua: string | null;
  checkedAt: string;
};

const AGREEMENT_LABELS: Record<Agreement['type'], string> = {
  privacy_policy: '隐私政策',
  user_agreement: '用户协议',
  personal_info_authorization: '个人信息授权书',
};

type ViolationWord = {
  id: number;
  word: string;
  severity: 'block' | 'warn';
  reason: string | null;
  isActive: boolean;
  createdAt: string;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.data as T;
}

type TabKey = 'agreements' | 'consents' | 'requests' | 'violation_words' | 'evaluations';

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'agreements', label: '协议管理', icon: FileText },
  { key: 'consents', label: '授权记录', icon: UserCheck },
  { key: 'requests', label: '数据请求', icon: Database },
  { key: 'violation_words', label: '违规词库', icon: Ban },
  { key: 'evaluations', label: '学员评价', icon: Star },
];

type ComplianceSummary = {
  activeAgreements: number;
  unReviewedAgreements: number;
  unReviewedList: Array<{ type: string; version: string }>;
  consentTotal: number;
  consentToday: number;
  dataDeletionPending: number;
  recommendation: string;
};

type BulletinRisk = {
  severity: 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  action: string;
  link?: string;
};

type ComplianceBulletin = {
  updatedAt: string;
  source: string;
  risks: BulletinRisk[];
  restrictedCategories: string[];
  complianceTips: string[];
};

function ComplianceCenter() {
  const [activeTab, setActiveTab] = useState<TabKey>('agreements');
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [bulletin, setBulletin] = useState<ComplianceBulletin | null>(null);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const data = await fetchJson<ComplianceSummary>('/api/agreements/compliance/summary');
        setSummary(data);
      } catch {
        setSummary(null);
      }
    };
    const loadBulletin = async () => {
      try {
        const data = await fetchJson<ComplianceBulletin>('/api/agreements/compliance/bulletin');
        setBulletin(data);
      } catch {
        setBulletin(null);
      }
    };
    void loadSummary();
    void loadBulletin();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          <h1 className="text-2xl font-semibold text-gray-900">合规中心</h1>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          协议版本管理 · 授权链路留痕 · 数据主体权利响应 · 内容合规违规词库
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <div className="text-xs text-gray-500">生效协议</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{summary.activeAgreements}</div>
          </div>
          <div className={cn('p-4 border rounded-lg', summary.unReviewedAgreements > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200')}>
            <div className="text-xs text-gray-600">待法务复审</div>
            <div className={cn('text-2xl font-semibold mt-1', summary.unReviewedAgreements > 0 ? 'text-amber-700' : 'text-emerald-700')}>
              {summary.unReviewedAgreements}
            </div>
          </div>
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <div className="text-xs text-gray-500">累计授权</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{summary.consentTotal}</div>
          </div>
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <div className="text-xs text-gray-500">今日新增授权</div>
            <div className="text-2xl font-semibold text-emerald-700 mt-1">{summary.consentToday}</div>
          </div>
        </div>
      )}

      {summary?.recommendation && (
        <div className={cn(
          'p-3 rounded-lg text-sm',
          summary.unReviewedAgreements > 0
            ? 'bg-amber-50 border border-amber-200 text-amber-800'
            : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
        )}>
          {summary.recommendation}
        </div>
      )}

      {bulletin && (
        <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                监管速览
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                数据源：{bulletin.source} · 最后更新 {bulletin.updatedAt}
              </div>
            </div>
            <div className="text-xs text-gray-500">
              受监管赛道：{bulletin.restrictedCategories.length} 个
            </div>
          </div>

          <div className="space-y-2">
            {bulletin.risks.map((risk, idx) => (
              <div
                key={idx}
                className={cn(
                  'p-3 rounded border-l-4 text-sm',
                  risk.severity === 'high' ? 'border-red-400 bg-red-50' :
                  risk.severity === 'medium' ? 'border-amber-400 bg-amber-50' :
                  'border-gray-300 bg-gray-50'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-gray-900">{risk.title}</div>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    risk.severity === 'high' ? 'bg-red-200 text-red-800' :
                    risk.severity === 'medium' ? 'bg-amber-200 text-amber-800' :
                    'bg-gray-200 text-gray-600'
                  )}>
                    {risk.severity === 'high' ? '高风险' : risk.severity === 'medium' ? '中风险' : '提示'}
                  </span>
                </div>
                <div className="text-xs text-gray-700 mt-1">{risk.summary}</div>
                <div className="text-xs text-emerald-700 mt-1">
                  ✅ 应对：{risk.action}
                </div>
                {risk.link && (
                  <a href={risk.link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline mt-1 inline-block">
                    查看来源 →
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-gray-100">
            <div className="text-xs font-medium text-gray-700 mb-1">日常合规 Tips</div>
            <ul className="text-xs text-gray-600 space-y-0.5 list-disc list-inside">
              {bulletin.complianceTips.map((tip, idx) => (
                <li key={idx}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'agreements' && <AgreementsTab />}
      {activeTab === 'consents' && <ConsentsTab />}
      {activeTab === 'requests' && <DataRequestsTab />}
      {activeTab === 'violation_words' && <ViolationWordsTab />}
      {activeTab === 'evaluations' && <EvaluationsTab />}
    </div>
  );
}

function AgreementsTab() {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [selected, setSelected] = useState<Agreement | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchJson<Agreement[]>('/api/agreements');
        setAgreements(data);
        setErrorMsg('');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">加载中…</div>;
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-5 space-y-2">
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        {agreements.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">暂无协议</div>
        ) : (
          agreements.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className={cn(
                'w-full text-left p-3 border rounded-lg transition-colors',
                selected?.id === a.id
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{AGREEMENT_LABELS[a.type]}</div>
                {a.isActive ? (
                  <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded">当前生效</span>
                ) : (
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">历史版本</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {a.version} · {a.createdAt}
              </div>
            </button>
          ))
        )}
      </div>
      <div className="col-span-7 p-4 bg-white border border-gray-200 rounded-lg min-h-[400px]">
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{AGREEMENT_LABELS[selected.type]}</div>
                <div className="text-xs text-gray-500">{selected.version}</div>
              </div>
              {selected.legalReviewed ? (
                <div className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                  <CheckCircle2 className="w-3 h-3" />
                  已法务复审 · {selected.legalReviewedBy}
                </div>
              ) : (
                <LegalReviewButton
                  agreementId={selected.id}
                  onReviewed={async () => {
                    await load();
                  }}
                />
              )}
            </div>
            {!selected.legalReviewed && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  当前协议为系统 seed 默认文案，**尚未经过法务复审**。正式对学员展示前，建议请律师审阅本文案是否符合
                  《个人信息保护法》《消费者权益保护法》等要求。
                </span>
              </div>
            )}
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans max-h-[500px] overflow-y-auto">
              {selected.content}
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            选择左侧协议查看详情
          </div>
        )}
      </div>
    </div>
  );

  async function load(): Promise<void> {
    try {
      const data = await fetchJson<Agreement[]>('/api/agreements');
      setAgreements(data);
      if (selected) {
        const found = data.find((a) => a.id === selected.id);
        if (found) setSelected(found);
      }
    } catch {
      // ignore
    }
  }
}

function LegalReviewButton({ agreementId, onReviewed }: { agreementId: number; onReviewed: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reviewedBy, setReviewedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async () => {
    if (!reviewedBy.trim()) {
      setErrorMsg('请填写复审人/律所名称');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      await fetchJson(`/api/agreements/${agreementId}/legal-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: reviewedBy.trim(), approved: true }),
      });
      setOpen(false);
      await onReviewed();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 hover:bg-amber-100"
      >
        <AlertTriangle className="w-3 h-3" />
        需法务复审
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        value={reviewedBy}
        onChange={(e) => setReviewedBy(e.target.value)}
        placeholder="律师姓名/律所"
        className="px-2 py-1 border border-gray-300 rounded text-xs w-40"
        maxLength={100}
      />
      <button
        onClick={() => void submit()}
        disabled={submitting}
        className="px-2 py-1 bg-emerald-600 text-white rounded text-xs disabled:opacity-50"
      >
        标记已复审
      </button>
      <button onClick={() => setOpen(false)} className="px-2 py-1 text-xs text-gray-500">
        取消
      </button>
      {errorMsg && <span className="text-xs text-red-600 ml-1">{errorMsg}</span>}
    </div>
  );
}

function ConsentsTab() {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchJson<ConsentRecord[]>('/api/agreements/consents/list');
        setConsents(data);
      } catch {
        setConsents([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">加载中…</div>;
  }

  const exportCsv = () => {
    const header = ['手机号', '协议类型', '协议版本', '授权时间', 'IP', 'UA'].join(',');
    const rows = consents.map((c) =>
      [
        c.phone,
        AGREEMENT_LABELS[c.agreementType as Agreement['type']] || c.agreementType,
        c.agreementVersion,
        c.checkedAt,
        c.ip || '',
        (c.ua || '').replaceAll(',', ' '),
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consents-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          共 {consents.length} 条授权记录
        </div>
        <button
          onClick={exportCsv}
          disabled={consents.length === 0}
          className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
        >
          导出 CSV
        </button>
      </div>

      {consents.length === 0 ? (
        <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
          暂无授权记录。通过合规留资入口提交的用户将出现在此处。
        </div>
      ) : (
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">手机号</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">协议</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">版本</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">授权时间</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {consents.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-sm text-gray-900">{c.phone}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">
                    {AGREEMENT_LABELS[c.agreementType as Agreement['type']] || c.agreementType}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{c.agreementVersion}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{c.checkedAt}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">{c.ip || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DataRequestsTab() {
  return (
    <div className="space-y-4">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <div className="font-medium mb-1">数据主体权利响应</div>
        <div>
          学员可通过自助端「授权管理」提交「导出我的数据」或「删除我的账户」请求，
          甲方管理员必须在 3 个工作日内处理并留痕。
        </div>
      </div>
      <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
        暂无待处理请求。此模块的 API 与处理流程将在 Sprint 2 完成。
      </div>
    </div>
  );
}

function ViolationWordsTab() {
  const [words, setWords] = useState<ViolationWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [newWord, setNewWord] = useState('');
  const [newReason, setNewReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<ViolationWord[]>('/api/violation-words');
      setWords(data);
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addWord = async () => {
    if (!newWord.trim()) return;
    setSaving(true);
    setErrorMsg('');
    try {
      await fetchJson('/api/violation-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: newWord.trim(), reason: newReason.trim() || null }),
      });
      setNewWord('');
      setNewReason('');
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (word: ViolationWord) => {
    try {
      await fetchJson(`/api/violation-words/${word.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !word.isActive }),
      });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新失败');
    }
  };

  const remove = async (word: ViolationWord) => {
    if (!window.confirm(`确认删除违规词「${word.word}」？`)) return;
    try {
      await fetchJson(`/api/violation-words/${word.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium mb-1">违规词过滤（AI 生成内容强制校验）</div>
            <div>
              内容工厂生成的内容命中违规词将直接打回；
              留资测评生成的报告会过滤命中词替换为「[已过滤]」。
              修改后立即在所有 AI 调用点生效。
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
        <div className="font-medium text-sm">新增违规词</div>
        <div className="flex gap-2">
          <input
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="违规词，如「包过」"
            className="w-40 px-3 py-1.5 border border-gray-300 rounded text-sm"
            maxLength={32}
          />
          <input
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            placeholder="理由（可选）"
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm"
            maxLength={200}
          />
          <button
            onClick={() => void addWord()}
            disabled={saving || !newWord.trim()}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            新增
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-500">加载中…</div>
      ) : words.length === 0 ? (
        <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">暂无违规词</div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">违规词</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">理由</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {words.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2 text-sm">
                    <span className="inline-flex items-center gap-1 text-gray-900">
                      <Ban className="w-3 h-3 text-red-500" />
                      {w.word}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600 max-w-md truncate">{w.reason || '-'}</td>
                  <td className="px-4 py-2 text-sm">
                    <button
                      onClick={() => void toggle(w)}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs',
                        w.isActive
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      )}
                    >
                      {w.isActive ? '已生效' : '已停用'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    <button
                      onClick={() => void remove(w)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-500">
        <CheckCircle2 className="w-3 h-3 inline mr-1 text-emerald-500" />
        修改后 AI 调用会立即生效（测评报告生成前会从 DB 动态读取）
      </div>
    </div>
  );
}

// v3.6.a · 学员评价
type Evaluation = {
  id: number;
  tenant: string;
  leadId: number;
  nickname: string;
  scores: {
    advisor: number;
    learning: number;
    payment: number;
    materials: number;
    overall: number;
  };
  avgScore: number;
  feedback: string | null;
  isComplaint: boolean;
  createdAt: string;
};

type EvalStats = {
  total: number;
  avgScore: number;
  complaints: number;
  complaintRate: number;
};

function EvaluationsTab() {
  const [data, setData] = useState<{ stats: EvalStats; evaluations: Evaluation[] } | null>(null);
  const [filter, setFilter] = useState<'all' | 'complaints'>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const result = await authJson<{ stats: EvalStats; evaluations: Evaluation[] }>('/api/evaluations?limit=200');
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    })();
  }, []);

  if (error) {
    return <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>;
  }
  if (!data) return <div className="p-12 text-center text-gray-400">加载中…</div>;

  const filtered = filter === 'complaints' ? data.evaluations.filter((e) => e.isComplaint) : data.evaluations;

  return (
    <div className="space-y-4">
      {/* 统计 */}
      <div className="grid grid-cols-4 gap-3">
        <StatBox label="评价总数" value={data.stats.total} />
        <StatBox label="平均分" value={data.stats.avgScore.toFixed(2)} accent={data.stats.avgScore >= 4 ? 'emerald' : data.stats.avgScore >= 3 ? 'amber' : 'red'} />
        <StatBox label="投诉数" value={data.stats.complaints} accent={data.stats.complaints > 0 ? 'red' : 'gray'} />
        <StatBox label="投诉率" value={`${data.stats.complaintRate}%`} accent={data.stats.complaintRate >= 30 ? 'red' : data.stats.complaintRate >= 10 ? 'amber' : 'gray'} />
      </div>

      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setFilter('all')}
          className={cn('px-3 py-1 rounded', filter === 'all' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600')}
        >全部 ({data.evaluations.length})</button>
        <button
          onClick={() => setFilter('complaints')}
          className={cn('px-3 py-1 rounded', filter === 'complaints' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600')}
        >只看投诉 ({data.stats.complaints})</button>
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center text-sm text-gray-500 bg-gray-50 rounded-xl">
          暂无评价。学员在 Portal 完成报名后会看到「给我们打分」入口。
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div key={e.id} className={cn('p-3 border rounded-lg', e.isComplaint ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{e.nickname}</span>
                    {e.isComplaint && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] rounded">⚠️ 投诉</span>}
                    <span className="text-xs text-gray-500">租户 {e.tenant}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    顾问 {e.scores.advisor}/5 · 学习 {e.scores.learning}/5 · 缴费 {e.scores.payment}/5 · 材料 {e.scores.materials}/5 · 总体 {e.scores.overall}/5
                  </div>
                  {e.feedback && <div className="mt-2 text-xs text-gray-800 bg-gray-50 p-2 rounded italic">"{e.feedback}"</div>}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-amber-600">{e.avgScore.toFixed(1)}</div>
                  <div className="text-[10px] text-gray-400">{e.createdAt.slice(0, 10)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: number | string; accent?: 'emerald' | 'amber' | 'red' | 'gray' }) {
  const cls = accent === 'emerald' ? 'text-emerald-600' : accent === 'amber' ? 'text-amber-600' : accent === 'red' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={cn('text-xl font-semibold mt-0.5', cls)}>{value}</div>
    </div>
  );
}

export default ComplianceCenter;
