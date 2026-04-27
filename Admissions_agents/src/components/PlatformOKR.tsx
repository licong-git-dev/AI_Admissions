/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Building2, TrendingUp, AlertCircle, Loader2, BarChart3, Star, Cpu } from 'lucide-react';
import { authJson, getUser } from '../lib/auth';
import { cn } from '../lib/cn';

type OKR = {
  tenants: {
    total: number;
    active30d: number;
    retentionRate60d: number | null;
    retentionCohort: number;
  };
  revenue: {
    last30dCommissionYuan: number;
    last30dCommissionPaidYuan: number;
    last30dTuitionYuan: number;
    last30dDealsCount: number;
    allTimeCommissionYuan: number;
    allTimePaidYuan: number;
    unpaidYuan: number;
  };
  unitEconomics: {
    cac30dYuan: number;
    leads30d: number;
    cacPerLeadYuan: number;
    avgLtvYuan: number;
    ltvCacRatio: number | null;
  };
  health: {
    gradeDistribution: Array<{ grade: string; count: number }>;
    evaluationsTotal: number;
    complaintsTotal: number;
    complaintRate: number;
    avgScore: number;
  };
  flywheel: { bestPracticesActive: number };
};

const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });

function PlatformOKR() {
  const user = getUser();
  const [data, setData] = useState<OKR | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const result = await authJson<OKR>('/api/dashboard/platform-okr');
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    };
    void load();
  }, []);

  const isPlatformAdmin = user?.role === 'admin' && user?.tenant === 'platform';
  if (!isPlatformAdmin) {
    return (
      <div className="p-6">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          🔒 平台经营 OKR 仅甲方可见
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-500" />
          平台经营 OKR
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          甲方专属战略仪表盘 · 租户 / 收入 / 单经济 / 健康 / 数据飞轮
        </p>
      </div>

      {/* 一行核心指标 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          icon={<Building2 className="w-4 h-4" />}
          label="活跃租户"
          value={`${data.tenants.active30d} / ${data.tenants.total}`}
          sub={data.tenants.retentionRate60d !== null
            ? `60 天留存 ${data.tenants.retentionRate60d}% (cohort ${data.tenants.retentionCohort})`
            : `cohort 不足无法算留存`}
          accent="emerald"
        />
        <Tile
          icon={<TrendingUp className="w-4 h-4" />}
          label="近 30 天分成（应收）"
          value={`¥${fmt(data.revenue.last30dCommissionYuan)}`}
          sub={`${data.revenue.last30dDealsCount} 单 · 已付 ¥${fmt(data.revenue.last30dCommissionPaidYuan)}`}
          accent="emerald"
        />
        <Tile
          icon={<Cpu className="w-4 h-4" />}
          label="LTV / CAC"
          value={data.unitEconomics.ltvCacRatio !== null ? `${data.unitEconomics.ltvCacRatio}x` : '—'}
          sub={`LTV ¥${fmt(data.unitEconomics.avgLtvYuan)} · CAC/lead ¥${data.unitEconomics.cacPerLeadYuan}`}
          accent={data.unitEconomics.ltvCacRatio !== null && data.unitEconomics.ltvCacRatio < 3 ? 'red' : 'emerald'}
        />
        <Tile
          icon={<Star className="w-4 h-4" />}
          label="学员均分"
          value={data.health.avgScore.toFixed(2)}
          sub={`${data.health.evaluationsTotal} 条评价 · 投诉率 ${data.health.complaintRate}%`}
          accent={data.health.complaintRate >= 20 ? 'red' : data.health.complaintRate >= 10 ? 'amber' : 'emerald'}
        />
      </div>

      {/* 收入板块 */}
      <Section title="📈 收入" subtitle="累计分成 · 已结算 · 未结">
        <div className="grid grid-cols-3 gap-3">
          <SmallStat label="累计应收" value={`¥${fmt(data.revenue.allTimeCommissionYuan)}`} />
          <SmallStat label="累计已付" value={`¥${fmt(data.revenue.allTimePaidYuan)}`} accent="emerald" />
          <SmallStat label="累计未结" value={`¥${fmt(data.revenue.unpaidYuan)}`} accent={data.revenue.unpaidYuan > 0 ? 'amber' : 'gray'} />
          <SmallStat label="近 30 天学费总额" value={`¥${fmt(data.revenue.last30dTuitionYuan)}`} />
          <SmallStat label="近 30 天分成应收" value={`¥${fmt(data.revenue.last30dCommissionYuan)}`} />
          <SmallStat label="近 30 天成交单数" value={`${data.revenue.last30dDealsCount} 单`} />
        </div>
      </Section>

      {/* 单经济 */}
      <Section title="💰 单经济" subtitle="LTV / CAC / 平台用 AI 算过 N 个 lead">
        <div className="grid grid-cols-3 gap-3">
          <SmallStat label="近 30 天 AI 成本估算" value={`¥${fmt(data.unitEconomics.cac30dYuan)}`} />
          <SmallStat label="近 30 天总线索" value={`${data.unitEconomics.leads30d} 条`} />
          <SmallStat label="单条线索 AI 成本" value={`¥${data.unitEconomics.cacPerLeadYuan}`} />
          <SmallStat label="平均 LTV" value={`¥${fmt(data.unitEconomics.avgLtvYuan)}`} accent="emerald" />
          <SmallStat
            label="LTV / CAC"
            value={data.unitEconomics.ltvCacRatio !== null ? `${data.unitEconomics.ltvCacRatio}x` : '—'}
            accent={data.unitEconomics.ltvCacRatio !== null && data.unitEconomics.ltvCacRatio >= 3 ? 'emerald' : 'amber'}
          />
          <SmallStat
            label="数据飞轮规模"
            value={`${data.flywheel.bestPracticesActive} 条 best-practice`}
            accent={data.flywheel.bestPracticesActive >= 10 ? 'emerald' : 'gray'}
          />
        </div>
        <div className="mt-3 text-[11px] text-gray-500">
          AI 成本估算可通过 PLATFORM_AI_COST_PER_LEAD_FEN 调整（默认 0.5 元 / 条线索）
        </div>
      </Section>

      {/* 健康度分布 */}
      <Section title="❤️ 租户健康度分布" subtitle="基于最新月度账单的 health_grade">
        <div className="grid grid-cols-5 gap-3">
          {data.health.gradeDistribution.map((g) => (
            <div key={g.grade} className={cn(
              'p-4 rounded-lg border text-center',
              g.grade === 'S' ? 'bg-purple-50 border-purple-200' :
              g.grade === 'A' ? 'bg-emerald-50 border-emerald-200' :
              g.grade === 'B' ? 'bg-blue-50 border-blue-200' :
              g.grade === 'C' ? 'bg-amber-50 border-amber-200' :
              'bg-red-50 border-red-200'
            )}>
              <div className="text-2xl font-bold">{g.grade}</div>
              <div className="text-xs text-gray-600 mt-1">{g.count} 家</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Tile({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: 'emerald' | 'amber' | 'red' | 'gray' }) {
  const accentClass = accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-600' : accent === 'emerald' ? 'text-emerald-600' : 'text-gray-900';
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn('text-xl font-bold mt-1.5', accentClass)}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

function SmallStat({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'amber' | 'red' | 'gray' }) {
  const accentClass = accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-600' : accent === 'emerald' ? 'text-emerald-600' : 'text-gray-900';
  return (
    <div className="p-3 bg-gray-50 rounded">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={cn('text-base font-semibold mt-0.5', accentClass)}>{value}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export default PlatformOKR;
