/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Receipt, Sparkles, RefreshCw, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { authJson } from '../lib/auth';
import { cn } from '../lib/cn';

type HealthGrade = 'S' | 'A' | 'B' | 'C' | 'D';

type ValueStatement = {
  tenant: string;
  period: string;
  leadsTotal: number;
  leadsHighIntent: number;
  leadsFromReferral: number;
  dealsCount: number;
  tuitionTotalFen: number;
  commissionTotalFen: number;
  commissionPaidFen: number;
  contentPublished: number;
  contentViews: number;
  aiMissionsSucceeded: number;
  aiAutoApproved: number;
  savedMinutes: number;
  healthScore: number;
  healthGrade: HealthGrade;
  narrative: string;
  breakdown: {
    leadsTotal: number;
    leadsHighIntent: number;
    leadsFromReferral: number;
    dealsCount: number;
    tuitionTotalYuan: number;
    commissionTotalYuan: number;
    commissionPaidYuan: number;
    commissionUnpaidYuan: number;
    contentDrafted: number;
    contentPublished: number;
    contentViews: number;
    aiMissionsRun: number;
    aiMissionsSucceeded: number;
    aiAutoApproved: number;
    savedMinutes: number;
    savedHours: number;
    healthBreakdown: {
      leadGrowthRate: number;
      conversionRate: number;
      aiEngagementScore: number;
      activeDaysScore: number;
    };
  };
  generatedAt: string;
};

const GRADE_COLORS: Record<HealthGrade, string> = {
  S: 'text-purple-600 bg-purple-50 border-purple-200',
  A: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  B: 'text-blue-600 bg-blue-50 border-blue-200',
  C: 'text-amber-600 bg-amber-50 border-amber-200',
  D: 'text-red-600 bg-red-50 border-red-200',
};

const GRADE_HINTS: Record<HealthGrade, string> = {
  S: '续费稳了 · 增长 + 转化 + AI 投入都很顶',
  A: '健康状态 · 继续保持',
  B: '中游水平 · 还有上升空间',
  C: '偏低 · 系统利用不足',
  D: '危险信号 · 平台费可能在浪费',
};

function ValueStatementPanel() {
  const [latest, setLatest] = useState<ValueStatement | null>(null);
  const [history, setHistory] = useState<ValueStatement[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const loadAll = async () => {
    try {
      const [latestRes, historyRes] = await Promise.all([
        authJson<ValueStatement | null>('/api/dashboard/value-statement/latest'),
        authJson<ValueStatement[]>('/api/dashboard/value-statement/list?limit=12'),
      ]);
      setLatest(latestRes);
      setHistory(historyRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleGenerate = async (period?: string) => {
    setGenerating(true);
    setError('');
    try {
      const generated = await authJson<ValueStatement>('/api/dashboard/value-statement/generate', {
        method: 'POST',
        body: JSON.stringify(period ? { period } : {}),
      });
      setLatest(generated);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            月度价值账单
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            每月 1 号 09:00 自动生成上月账单 + 推送企微 · 也可以手动重算
          </p>
        </div>
        <button
          onClick={() => handleGenerate()}
          disabled={generating}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm border border-emerald-200 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          重算上月账单
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {!latest && !error && (
        <div className="p-12 text-center bg-white border border-gray-200 rounded-xl">
          <Sparkles className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <div className="text-gray-700 font-medium">还没生成过账单</div>
          <div className="text-sm text-gray-500 mt-1">点右上角「重算上月账单」生成你的第一份月度复盘。</div>
        </div>
      )}

      {latest && (
        <>
          {/* 主卡片：当月叙事 + 健康分 */}
          <div className="bg-gradient-to-br from-emerald-50 via-white to-blue-50 border border-emerald-200 rounded-xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">
                  {latest.period} 价值复盘
                </div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">
                  ¥{(latest.commissionTotalFen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
                  <span className="ml-2 text-sm text-gray-500 font-normal">应付平台分成</span>
                </div>
                <div className="text-sm text-gray-600 mt-0.5">
                  营收 ¥{(latest.tuitionTotalFen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
                  <span className="mx-2">·</span>
                  ROI {(latest.tuitionTotalFen / Math.max(latest.commissionTotalFen, 1)).toFixed(1)}x
                </div>
              </div>
              <div className={cn(
                'px-4 py-2 rounded-xl border-2 text-center min-w-[100px]',
                GRADE_COLORS[latest.healthGrade]
              )}>
                <div className="text-3xl font-bold">{latest.healthScore}</div>
                <div className="text-[10px] uppercase tracking-wide font-semibold mt-0.5">{latest.healthGrade} 级 · 续费健康</div>
              </div>
            </div>
            <div className="text-xs text-gray-600 italic">{GRADE_HINTS[latest.healthGrade]}</div>

            {/* 叙事 */}
            <div className="mt-4 p-4 bg-white border border-emerald-100 rounded-lg whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
              {latest.narrative}
            </div>
          </div>

          {/* 数据明细 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="新增线索" value={latest.breakdown.leadsTotal} unit="条" trend={latest.breakdown.healthBreakdown.leadGrowthRate} trendUnit="%" />
            <Stat label="高意向" value={latest.breakdown.leadsHighIntent} unit="条" />
            <Stat label="转介绍线索" value={latest.breakdown.leadsFromReferral} unit="条" accent="emerald" badge="0 成本" />
            <Stat label="成交单" value={latest.breakdown.dealsCount} unit="单" />
            <Stat label="转化率" value={`${latest.breakdown.healthBreakdown.conversionRate}`} unit="%" />
            <Stat label="发布内容" value={latest.breakdown.contentPublished} unit="条" />
            <Stat label="累计阅读" value={latest.breakdown.contentViews.toLocaleString('zh-CN')} unit="次" />
            <Stat label="AI 完成任务" value={latest.breakdown.aiMissionsSucceeded} unit="个" accent="purple" />
            <Stat label="自动审批" value={latest.breakdown.aiAutoApproved} unit="次" accent="purple" />
            <Stat label="节省人力" value={latest.breakdown.savedHours} unit="小时" accent="emerald" />
            <Stat label="环比线索" value={`${latest.breakdown.healthBreakdown.leadGrowthRate >= 0 ? '+' : ''}${latest.breakdown.healthBreakdown.leadGrowthRate}`} unit="%" accent={latest.breakdown.healthBreakdown.leadGrowthRate >= 0 ? 'emerald' : 'red'} />
            <Stat label="活跃天数" value={latest.breakdown.healthBreakdown.activeDaysScore} unit="天" />
          </div>

          {/* 健康分四维度细拆 */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm font-medium text-gray-900 mb-3">续费健康分构成</div>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <HealthBar label="增长 30%" value={Math.max(0, Math.min(100, 50 + latest.breakdown.healthBreakdown.leadGrowthRate * 0.5))} />
              <HealthBar label="转化 25%" value={Math.min(100, latest.breakdown.healthBreakdown.conversionRate * 10)} />
              <HealthBar label="AI 投入 20%" value={latest.breakdown.healthBreakdown.aiEngagementScore} />
              <HealthBar label="活跃 25%" value={(latest.breakdown.healthBreakdown.activeDaysScore / 30) * 100} />
            </div>
          </div>

          {/* 历史账单 */}
          {history.length > 1 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-medium text-gray-900 mb-3">历史账单</div>
              <div className="space-y-1.5">
                {history.map((s) => (
                  <button
                    key={s.period}
                    onClick={() => setLatest(s)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 rounded text-sm hover:bg-gray-50',
                      latest.period === s.period ? 'bg-emerald-50' : ''
                    )}
                  >
                    <span className="font-mono text-gray-700">{s.period}</span>
                    <span className="text-gray-600">营收 ¥{(s.tuitionTotalFen / 100).toLocaleString('zh-CN')}</span>
                    <span className="text-gray-500">分成 ¥{(s.commissionTotalFen / 100).toLocaleString('zh-CN')}</span>
                    <span className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-semibold border',
                      GRADE_COLORS[s.healthGrade]
                    )}>{s.healthGrade}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit, accent, trend, trendUnit, badge }: {
  label: string;
  value: number | string;
  unit?: string;
  accent?: 'emerald' | 'purple' | 'red';
  trend?: number;
  trendUnit?: string;
  badge?: string;
}) {
  const accentClass = accent === 'emerald' ? 'text-emerald-600' :
    accent === 'purple' ? 'text-purple-600' :
    accent === 'red' ? 'text-red-600' :
    'text-gray-900';
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg">
      <div className="text-[11px] text-gray-500 flex items-center gap-1">
        {label}
        {badge && <span className="px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px]">{badge}</span>}
      </div>
      <div className={cn('text-xl font-semibold mt-0.5', accentClass)}>
        {value}
        {unit && <span className="text-xs text-gray-400 ml-0.5">{unit}</span>}
      </div>
      {trend !== undefined && (
        <div className={cn('text-[10px] mt-0.5 flex items-center gap-0.5', trend >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {trend >= 0 ? '+' : ''}{trend}{trendUnit ?? ''} 环比
        </div>
      )}
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-gray-600">
        <span>{label}</span>
        <span className="font-semibold">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full',
            value >= 70 ? 'bg-emerald-500' :
            value >= 50 ? 'bg-blue-500' :
            value >= 30 ? 'bg-amber-500' :
            'bg-red-500'
          )}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

export default ValueStatementPanel;
