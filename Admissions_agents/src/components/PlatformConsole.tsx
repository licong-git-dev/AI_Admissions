/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Globe,
  Users,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  DollarSign,
  Building2,
  Activity,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { cn } from '../lib/cn';
import { authJson } from '../lib/auth';

type TenantData = {
  tenant: string;
  leads: { total: number; enrolled: number; highIntent: number; today: number };
  deals: { total: number; tuitionYuan: number; commissionYuan: number; commissionPaidYuan: number; suspicious: number };
  users: { total: number; admins: number; tenantAdmins: number; specialists: number; activeWeekly: number };
  rpa: { total: number; loggedIn: number; cooldown: number; banned: number };
};

type Overview = {
  platformTotals: {
    tenants: number;
    totalLeads: number;
    totalEnrolled: number;
    totalDeals: number;
    totalTuitionYuan: number;
    totalCommissionYuan: number;
    unpaidCommissionYuan: number;
    suspiciousDeals: number;
    totalUsers: number;
    activeUsersWeekly: number;
  };
  tenants: TenantData[];
  systemHealth: {
    contentItemsPending: number;
    rpaTasksQueued: number;
    rpaTasksFailed24h: number;
    auditWrites24h: number;
    consentsTotal: number;
    agreementsUnreviewed: number;
  };
};

type TrendPoint = { date: string; leads: number; deals: number };

type JobsSnapshot = {
  stats: { queued: number; running: number; failed: number; succeeded24h: number };
  recent: Array<{
    id: number;
    name: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    scheduledAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
};

function PlatformConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [jobs, setJobs] = useState<JobsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [ov, tr, jb] = await Promise.all([
        authJson<Overview>('/api/platform/overview'),
        authJson<TrendPoint[]>('/api/platform/trend'),
        authJson<JobsSnapshot>('/api/platform/jobs').catch(() => null),
      ]);
      setOverview(ov);
      setTrend(tr);
      setJobs(jb);
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

  if (loading && !overview) {
    return (
      <div className="p-6 flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中…
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {errorMsg || '无法加载数据。请确认当前登录账号为平台管理员（role=admin, tenant=platform）。'}
        </div>
      </div>
    );
  }

  const t = overview.platformTotals;
  const h = overview.systemHealth;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-6 h-6 text-emerald-600" />
            <h1 className="text-2xl font-semibold text-gray-900">平台总控台</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            甲方（聪可智核）视角 · 跨租户聚合数据 · 仅 platform admin 可见
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <KPICard label="已接入乙方" value={t.tenants} icon={Building2} accent="text-blue-600" />
        <KPICard label="总线索数" value={t.totalLeads} icon={Users} accent="text-emerald-600" />
        <KPICard label="总成交数" value={t.totalDeals} icon={TrendingUp} />
        <KPICard label="应收分成(万元)" value={(t.totalCommissionYuan / 10000).toFixed(2)} icon={DollarSign} accent="text-emerald-600" />
        <KPICard
          label="未结分成(万元)"
          value={(t.unpaidCommissionYuan / 10000).toFixed(2)}
          icon={AlertTriangle}
          accent={t.unpaidCommissionYuan > 0 ? 'text-orange-600' : 'text-gray-900'}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-emerald-600" />
            <div className="font-medium text-sm">近 30 天线索 / 成交趋势</div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={trend}>
              <defs>
                <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip />
              <Area type="monotone" dataKey="leads" name="线索" stroke="#10b981" fill="url(#leadsGrad)" strokeWidth={2} />
              <Line type="monotone" dataKey="deals" name="成交" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <div className="font-medium text-sm">系统健康</div>
          </div>
          <HealthRow label="内容待审核" value={h.contentItemsPending} threshold={20} />
          <HealthRow label="RPA 任务排队中" value={h.rpaTasksQueued} threshold={30} />
          <HealthRow label="24h 任务失败" value={h.rpaTasksFailed24h} threshold={10} accent={h.rpaTasksFailed24h > 10 ? 'text-red-600' : 'text-gray-900'} />
          <HealthRow label="24h 审计写操作" value={h.auditWrites24h} />
          <HealthRow label="累计授权记录" value={h.consentsTotal} />
          <HealthRow label="待法务复审协议" value={h.agreementsUnreviewed} accent={h.agreementsUnreviewed > 0 ? 'text-orange-600' : 'text-emerald-600'} />
        </div>
      </div>

      {jobs && (
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <div className="font-medium text-sm">作业队列</div>
            </div>
            <div className="text-xs text-gray-500">
              Prometheus 指标：<a href="/api/metrics" target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">/api/metrics</a>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <MiniStat label="排队中" value={jobs.stats.queued} accent="text-blue-600" />
            <MiniStat label="执行中" value={jobs.stats.running} accent="text-amber-600" />
            <MiniStat label="失败" value={jobs.stats.failed} accent={jobs.stats.failed > 0 ? 'text-red-600' : 'text-gray-900'} />
            <MiniStat label="24h 成功" value={jobs.stats.succeeded24h} accent="text-emerald-600" />
          </div>
          {jobs.recent.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {jobs.recent.slice(0, 10).map((j) => (
                <div key={j.id} className="flex items-center justify-between text-xs p-1.5 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px]',
                      j.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700' :
                      j.status === 'failed' ? 'bg-red-100 text-red-700' :
                      j.status === 'running' ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    )}>
                      {j.status}
                    </span>
                    <span className="font-mono text-gray-700">{j.name}</span>
                  </div>
                  <span className="text-gray-400">#{j.id} · {j.attempts}/{j.maxAttempts} · {j.scheduledAt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-emerald-600" />
          <div className="font-medium text-sm">各乙方详情（{overview.tenants.length}）</div>
        </div>

        {overview.tenants.length === 0 ? (
          <div className="p-8 bg-gray-50 border border-gray-200 rounded text-center text-sm text-gray-500">
            暂无乙方接入。通过「用户管理」创建 tenant_admin 账号指定新租户后即可接入。
          </div>
        ) : (
          <div className="space-y-3">
            {overview.tenants.map((tn) => (
              <TenantCard key={tn.tenant} data={tn} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={cn('text-2xl font-semibold', accent || 'text-gray-900')}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="p-2 bg-gray-50 rounded">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={cn('text-xl font-semibold', accent || 'text-gray-900')}>{value}</div>
    </div>
  );
}

function HealthRow({
  label,
  value,
  accent,
  threshold,
}: {
  label: string;
  value: number;
  accent?: string;
  threshold?: number;
}) {
  const autoAccent = threshold && value > threshold ? 'text-orange-600' : undefined;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={cn('font-medium', accent || autoAccent || 'text-gray-900')}>{value}</span>
    </div>
  );
}

function TenantCard({ data }: { data: TenantData }) {
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-gray-900">{data.tenant}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {data.users.tenantAdmins} 个 tenant_admin · {data.users.specialists} 个专员 ·{' '}
            近 7 天活跃 {data.users.activeWeekly}
          </div>
        </div>
        {data.deals.suspicious > 0 && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {data.deals.suspicious} 条疑似异常
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-gray-500">线索总数</div>
          <div className="text-lg font-semibold">{data.leads.total}</div>
          <div className="text-xs text-gray-400">今日 +{data.leads.today} · 高意向 {data.leads.highIntent}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">成交数</div>
          <div className="text-lg font-semibold">{data.deals.total}</div>
          <div className="text-xs text-gray-400">¥{(data.deals.tuitionYuan / 10000).toFixed(1)} 万学费</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">应分成</div>
          <div className="text-lg font-semibold text-emerald-700">
            ¥{(data.deals.commissionYuan / 10000).toFixed(2)} 万
          </div>
          <div className="text-xs text-orange-600">
            未结 ¥{((data.deals.commissionYuan - data.deals.commissionPaidYuan) / 10000).toFixed(2)} 万
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">RPA 账号</div>
          <div className="text-lg font-semibold">{data.rpa.total}</div>
          <div className="text-xs text-gray-400">
            已登录 {data.rpa.loggedIn} · 冷却 {data.rpa.cooldown} · 封禁 {data.rpa.banned}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlatformConsole;
