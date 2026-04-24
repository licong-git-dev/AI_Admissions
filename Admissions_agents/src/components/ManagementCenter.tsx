/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  FileSpreadsheet,
  ScrollText,
  MessageCircle,
  AlertTriangle,
  Download,
  Loader2,
  Send,
  RefreshCw,
  PlusCircle,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { authJson, authFetch, getToken, getUser } from '../lib/auth';

type TabKey = 'deals' | 'settlement' | 'audit' | 'wechat_work';

type Deal = {
  id: number;
  leadId: number;
  schoolName: string;
  majorName: string;
  totalTuitionYuan: number;
  commissionAmountYuan: number;
  commissionPaidAmountFen: number;
  status: string;
  signedAt: string;
  suspicious: boolean;
  suspiciousReason: string | null;
};

type SettlementReport = {
  id: number;
  period: string;
  totalDeals: number;
  totalTuitionYuan: number;
  totalCommissionYuan: number;
  commissionPaidYuan: number;
  commissionUnpaidYuan: number;
  suspiciousDeals: number;
  generatedAt: string;
};

type DealsSummary = {
  totalDeals: number;
  totalTuitionYuan: number;
  totalCommissionYuan: number;
  commissionPaidYuan: number;
  commissionUnpaidYuan: number;
  suspiciousCount: number;
  byMonth: Array<{ period: string; deals: number; tuition: number; commission: number; commissionPaid: number }>;
};

type AuditLogEntry = {
  id: number;
  userId: number | null;
  username: string | null;
  role: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  statusCode: number | null;
  createdAt: string;
};

type WechatWorkStatus = {
  configured: boolean;
  corpId: string | null;
  agentId: string | null;
  contactSecretConfigured: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: '待付款',
  partially_paid: '部分已付',
  fully_paid: '全额已付',
  settled_to_a: '已结算给甲方',
  refunded: '已退款',
  canceled: '已取消',
};

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }>; roles: Array<'admin' | 'tenant_admin'> }> = [
  { key: 'deals', label: '成交登记', icon: TrendingUp, roles: ['admin', 'tenant_admin'] },
  { key: 'settlement', label: '月度分成', icon: FileSpreadsheet, roles: ['admin', 'tenant_admin'] },
  { key: 'audit', label: '审计日志', icon: ScrollText, roles: ['admin', 'tenant_admin'] },
  { key: 'wechat_work', label: '企业微信', icon: MessageCircle, roles: ['admin', 'tenant_admin'] },
];

function ManagementCenter() {
  const [activeTab, setActiveTab] = useState<TabKey>('deals');
  const user = getUser();

  const visibleTabs = TABS.filter((t) => !user || t.roles.includes(user.role as 'admin' | 'tenant_admin'));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">经营管理中心</h1>
        <p className="text-sm text-gray-500 mt-1">成交登记 · 月度分成结算 · 操作审计 · 企业微信集成</p>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-200">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'deals' && <DealsTab />}
      {activeTab === 'settlement' && <SettlementTab />}
      {activeTab === 'audit' && <AuditTab />}
      {activeTab === 'wechat_work' && <WechatWorkTab />}
    </div>
  );
}

function DealsTab() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [summary, setSummary] = useState<DealsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dealsData, summaryData] = await Promise.all([
        authJson<Deal[]>('/api/deals'),
        authJson<DealsSummary>('/api/deals/summary').catch(() => null),
      ]);
      setDeals(dealsData);
      setSummary(summaryData);
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

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="成交总数" value={summary.totalDeals} />
          <StatCard label="总学费(万元)" value={(summary.totalTuitionYuan / 10000).toFixed(1)} />
          <StatCard label="应分成(万元)" value={(summary.totalCommissionYuan / 10000).toFixed(2)} accent="text-emerald-600" />
          <StatCard label="未结分成(万元)" value={(summary.commissionUnpaidYuan / 10000).toFixed(2)} accent="text-orange-600" />
          <StatCard label="疑似异常" value={summary.suspiciousCount} accent={summary.suspiciousCount > 0 ? 'text-red-600' : 'text-gray-900'} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">共 {deals.length} 条成交登记</div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700"
          >
            <PlusCircle className="w-4 h-4" />
            登记成交
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded text-sm hover:bg-gray-50"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            刷新
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="overflow-hidden border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">院校/专业</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">学费(元)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">应分成(元)</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">异常</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">签约</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {deals.map((deal) => (
              <tr key={deal.id} className={deal.suspicious ? 'bg-red-50' : ''}>
                <td className="px-3 py-2 text-sm text-gray-500">#{deal.id}</td>
                <td className="px-3 py-2 text-sm text-gray-900">
                  {deal.schoolName} / {deal.majorName}
                </td>
                <td className="px-3 py-2 text-sm text-right text-gray-900">{deal.totalTuitionYuan.toFixed(2)}</td>
                <td className="px-3 py-2 text-sm text-right text-emerald-700">{deal.commissionAmountYuan.toFixed(2)}</td>
                <td className="px-3 py-2 text-sm">
                  <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">
                    {STATUS_LABELS[deal.status] || deal.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm">
                  {deal.suspicious ? (
                    <span className="inline-flex items-center gap-1 text-red-600 text-xs">
                      <AlertTriangle className="w-3 h-3" />
                      {deal.suspiciousReason?.slice(0, 20) || '异常'}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-sm text-gray-500">{deal.signedAt.slice(0, 10)}</td>
              </tr>
            ))}
            {deals.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500 text-sm">
                  暂无成交登记。点击右上角「登记成交」开始记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateDealModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateDealModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [leadId, setLeadId] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [majorName, setMajorName] = useState('');
  const [tuition, setTuition] = useState('');
  const [commissionRate, setCommissionRate] = useState('0.30');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    try {
      await authJson('/api/deals', {
        method: 'POST',
        body: JSON.stringify({
          leadId: Number(leadId),
          schoolName: schoolName.trim(),
          majorName: majorName.trim(),
          totalTuitionYuan: Number(tuition),
          commissionRate: Number(commissionRate),
          note: note.trim() || undefined,
        }),
      });
      onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white w-full max-w-lg rounded-xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold text-lg">登记成交</div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">关联线索 ID *</label>
            <input required value={leadId} onChange={(e) => setLeadId(e.target.value)} type="number" min="1" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">学费（元）*</label>
            <input required value={tuition} onChange={(e) => setTuition(e.target.value)} type="number" step="0.01" min="0" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">报读院校 *</label>
          <input required value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">专业 *</label>
          <input required value={majorName} onChange={(e) => setMajorName(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">甲方分成比例</label>
          <input value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} type="number" step="0.01" min="0" max="1" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
          <div className="text-xs text-gray-400 mt-1">合同默认 0.30</div>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">备注</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>

        {errorMsg && <div className="text-sm text-red-600 p-2 bg-red-50 rounded">{errorMsg}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded">取消</button>
          <button type="submit" disabled={submitting} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded disabled:opacity-50 flex items-center gap-1">
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cn('text-2xl font-semibold mt-1', accent || 'text-gray-900')}>{value}</div>
    </div>
  );
}

function SettlementTab() {
  const [reports, setReports] = useState<SettlementReport[]>([]);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    try {
      const data = await authJson<SettlementReport[]>('/api/settlement/reports');
      setReports(data);
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const generate = async () => {
    setGenerating(true);
    setErrorMsg('');
    try {
      await authJson('/api/settlement/reports/generate', {
        method: 'POST',
        body: JSON.stringify({ period }),
      });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const download = async (reportPeriod: string) => {
    const response = await authFetch(`/api/settlement/reports/${reportPeriod}/csv`);
    if (!response.ok) {
      setErrorMsg('导出失败');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `settlement-${reportPeriod}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">结算月份</label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm"
          />
        </div>
        <button
          onClick={() => void generate()}
          disabled={generating}
          className="px-4 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
        >
          {generating && <Loader2 className="w-3 h-3 animate-spin" />}
          生成/刷新月报
        </button>
      </div>

      {errorMsg && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{errorMsg}</div>}

      <div className="overflow-hidden border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">月份</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">成交数</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">总学费(元)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">应分成(元)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">已结算(元)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">未结算(元)</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">异常</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-sm text-gray-900 font-medium">{r.period}</td>
                <td className="px-3 py-2 text-sm text-right">{r.totalDeals}</td>
                <td className="px-3 py-2 text-sm text-right">{r.totalTuitionYuan.toLocaleString()}</td>
                <td className="px-3 py-2 text-sm text-right text-emerald-700">{r.totalCommissionYuan.toLocaleString()}</td>
                <td className="px-3 py-2 text-sm text-right">{r.commissionPaidYuan.toLocaleString()}</td>
                <td className="px-3 py-2 text-sm text-right text-orange-600">{r.commissionUnpaidYuan.toLocaleString()}</td>
                <td className="px-3 py-2 text-sm text-right">
                  {r.suspiciousDeals > 0 ? (
                    <span className="text-red-600">{r.suspiciousDeals}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-sm text-right">
                  <button
                    onClick={() => void download(r.period)}
                    className="inline-flex items-center gap-1 text-emerald-700 hover:underline text-xs"
                  >
                    <Download className="w-3 h-3" />
                    CSV
                  </button>
                </td>
              </tr>
            ))}
            {reports.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500 text-sm">
                  暂无月报。选择月份后点击生成。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await authJson<AuditLogEntry[]>('/api/audit');
      setLogs(data);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">最近 100 条写操作</div>
        <button onClick={() => void load()} disabled={loading} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {errorMsg && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{errorMsg}</div>}

      <div className="overflow-hidden border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">操作者</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">资源</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">动作</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-3 py-2 text-xs text-gray-500">{log.createdAt}</td>
                <td className="px-3 py-2 text-sm">{log.username || '-'} <span className="text-xs text-gray-400">({log.role || '-'})</span></td>
                <td className="px-3 py-2 text-xs">{log.resourceType}{log.resourceId ? ` #${log.resourceId}` : ''}</td>
                <td className="px-3 py-2 text-xs text-gray-600 max-w-xs truncate">{log.action}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{log.ip || '-'}</td>
                <td className="px-3 py-2 text-xs">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded',
                    log.statusCode && log.statusCode >= 400 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                  )}>
                    {log.statusCode || '-'}
                  </span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500 text-sm">
                  暂无审计日志
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WechatWorkTab() {
  const [status, setStatus] = useState<WechatWorkStatus | null>(null);
  const [toUser, setToUser] = useState('');
  const [content, setContent] = useState('这是一条来自招生系统的测试消息');
  const [sending, setSending] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await authJson<WechatWorkStatus>('/api/wechat-work/status');
        setStatus(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
      }
    };
    void load();
  }, []);

  const send = async () => {
    setSending(true);
    setResultMsg('');
    setErrorMsg('');
    try {
      const data = await authJson<{ stub?: boolean; delivered?: boolean }>('/api/wechat-work/send-test', {
        method: 'POST',
        body: JSON.stringify({ toUser, content }),
      });
      setResultMsg(data.stub ? '✅ stub 模式：未配置企业微信，消息未真实发送' : '✅ 已发送');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={cn(
        'p-4 rounded-lg text-sm',
        status?.configured ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-800'
      )}>
        <div className="font-medium mb-1">企业微信集成状态</div>
        {status?.configured ? (
          <ul className="space-y-1 text-xs">
            <li>✅ 已配置 · CorpID: {status.corpId}</li>
            <li>✅ AgentID: {status.agentId}</li>
            <li>{status.contactSecretConfigured ? '✅' : '⚠️'} 通讯录 Secret {status.contactSecretConfigured ? '已配置' : '未配置（客户联系功能不可用）'}</li>
          </ul>
        ) : (
          <div className="text-xs">
            尚未配置企业微信。请在 server/.env 中设置 <code className="bg-white px-1 rounded">WECHAT_WORK_CORP_ID</code>、
            <code className="bg-white px-1 rounded">WECHAT_WORK_AGENT_ID</code>、
            <code className="bg-white px-1 rounded">WECHAT_WORK_APP_SECRET</code>。
          </div>
        )}
      </div>

      <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
        <div className="font-medium text-sm">发送测试消息</div>
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">目标用户 userid（企业微信）</label>
            <input value={toUser} onChange={(e) => setToUser(e.target.value)} placeholder="企业微信 userid" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">消息内容</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <button
            onClick={() => void send()}
            disabled={sending || !toUser || !content}
            className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
          >
            <Send className="w-3 h-3" />
            发送
          </button>
          {resultMsg && <div className="text-sm text-emerald-700">{resultMsg}</div>}
          {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}
        </div>
      </div>

      <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
        <div className="font-medium text-sm">外部联系人同步</div>
        <div className="text-xs text-gray-600 space-y-1">
          <div>从企业微信拉取已添加外部联系人的员工对应客户列表，批量导入到 leads 表。</div>
          <div>前置条件：<code className="bg-gray-100 px-1 rounded">WECHAT_WORK_CONTACT_SECRET</code> 已配置且员工已配置「可使用的员工」。</div>
        </div>
        <SyncContactsPanel />
      </div>

      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-1">
        <div className="font-medium text-gray-800">自动通知联动（已接入）</div>
        <div>· 新成交登记后，自动向所有 wechat_work_userid 不为空的甲方管理员推送通知</div>
        <div>· 疑似异常成交会带 ⚠️ 前缀，便于老板快速识别</div>
        <div>· 外部用户发送到企微应用的消息，会记录到 audit_logs（resource_type=wechat_work_message）</div>
      </div>
    </div>
  );
}

function SyncContactsPanel() {
  const [followUsers, setFollowUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ fetched: number; inserted: number; skipped: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await authJson<string[]>('/api/wechat-work/follow-users');
        setFollowUsers(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const sync = async () => {
    setSyncing(true);
    setResult(null);
    setErrorMsg('');
    try {
      const data = await authJson<{ fetched: number; inserted: number; skipped: number }>(
        '/api/wechat-work/contacts/sync',
        {
          method: 'POST',
          body: JSON.stringify(selectedUser ? { userId: selectedUser } : {}),
        }
      );
      setResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600">同步范围</label>
        <select
          value={selectedUser}
          onChange={(e) => setSelectedUser(e.target.value)}
          disabled={loading}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
        >
          <option value="">全部授权员工（{followUsers.length}）</option>
          {followUsers.map((u) => (
            <option key={u} value={u}>
              仅 {u}
            </option>
          ))}
        </select>
        <button
          onClick={() => void sync()}
          disabled={syncing || loading}
          className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
        >
          {syncing ? '同步中…' : '同步到线索库'}
        </button>
      </div>
      {result && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          ✅ 同步完成：共抓取 {result.fetched} 条，新建 {result.inserted} 条线索，已存在 {result.skipped} 条跳过。
        </div>
      )}
      {errorMsg && <div className="text-xs text-red-600">{errorMsg}</div>}
    </div>
  );
}

export default ManagementCenter;
