/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Trophy, TrendingUp, TrendingDown, Loader2, AlertCircle, Crown, Medal, Users } from 'lucide-react';
import { authJson } from '../lib/auth';
import { cn } from '../lib/cn';

type SpecialistRow = {
  userId: number;
  name: string;
  isMe: boolean;
  rank: number;
  leadsTotal: number;
  leadsHighIntent: number;
  leadsEnrolled: number;
  conversionRate: number;
  monthDealsCount: number;
  monthTuitionFen: number;
  monthCommissionFen: number;
  prevMonthTuitionFen: number;
  prevMonthCommissionFen: number;
  trendPct: number;
  weekDealsCount: number;
  weekTuitionFen: number;
  weekCommissionFen: number;
};

type Performance = {
  commissionRate: number;
  me: SpecialistRow | null;
  ranking: SpecialistRow[];
  teamTotal: { deals: number; tuitionFen: number; commissionFen: number };
  windowLabels: { weekStart: string; monthStart: string };
};

const fenToYuan = (fen: number) => `¥${(fen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;

function SpecialistPerformance() {
  const [data, setData] = useState<Performance | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const result = await authJson<Performance>('/api/dashboard/specialist-performance');
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    };
    void load();
  }, []);

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

  const { me, ranking, teamTotal, commissionRate } = data;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          业绩仪表盘
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          专员实时业绩 + 提成估算（按 {Math.round(commissionRate * 1000) / 10}% 计算）+ 团队排行
        </p>
      </div>

      {/* 我的本月 + 本周 + 排名 */}
      {me && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 p-5 bg-gradient-to-br from-emerald-50 via-white to-blue-50 border border-emerald-200 rounded-xl">
            <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">本月业绩 · {me.name}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-3xl font-bold text-gray-900">{fenToYuan(me.monthCommissionFen)}</div>
              <div className="text-sm text-gray-500">预估提成</div>
            </div>
            <div className="mt-1 text-sm text-gray-600">
              成交 {me.monthDealsCount} 单 · 学费 {fenToYuan(me.monthTuitionFen)}
            </div>
            <div className={cn('mt-2 flex items-center gap-1 text-xs', me.trendPct >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {me.trendPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {me.trendPct >= 0 ? '+' : ''}{me.trendPct}% 环比上月（上月 {fenToYuan(me.prevMonthCommissionFen)}）
            </div>
            <div className="mt-3 pt-3 border-t border-emerald-100 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-gray-500">本周</div>
                <div className="font-semibold text-gray-900">{fenToYuan(me.weekCommissionFen)} · {me.weekDealsCount} 单</div>
              </div>
              <div>
                <div className="text-gray-500">线索→成交</div>
                <div className="font-semibold text-gray-900">{me.conversionRate}%</div>
              </div>
              <div>
                <div className="text-gray-500">高意向</div>
                <div className="font-semibold text-amber-600">{me.leadsHighIntent} 条待跟进</div>
              </div>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl flex flex-col items-center justify-center">
            <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">本月排名</div>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-bold text-amber-700">#{me.rank}</span>
              <span className="text-sm text-gray-500">/ {ranking.length}</span>
            </div>
            {me.rank === 1 && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-200 text-amber-900 text-xs rounded-full">
                <Crown className="w-3 h-3" /> 本月冠军
              </div>
            )}
            {me.rank === 2 && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full">
                <Medal className="w-3 h-3" /> 亚军
              </div>
            )}
            {me.rank === 3 && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-orange-200 text-orange-800 text-xs rounded-full">
                <Medal className="w-3 h-3" /> 季军
              </div>
            )}
          </div>
        </div>
      )}

      {!me && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
          以管理员身份查看 — 下方为本租户全部专员排名
        </div>
      )}

      {/* 团队总计 */}
      <div className="p-4 bg-white border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-900">
          <Users className="w-4 h-4 text-gray-500" />
          团队本月合计
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="成交" value={teamTotal.deals} unit="单" />
          <Stat label="学费总额" value={fenToYuan(teamTotal.tuitionFen)} accent="emerald" />
          <Stat label="预估提成" value={fenToYuan(teamTotal.commissionFen)} accent="amber" />
        </div>
      </div>

      {/* 排行榜 */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-900">
          🏆 本月排行榜
        </div>
        {ranking.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">
            本租户暂无专员账号。去「系统设置 → 用户管理」创建。
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left w-12">名次</th>
                <th className="px-3 py-2 text-left">姓名</th>
                <th className="px-3 py-2 text-right">本月成交</th>
                <th className="px-3 py-2 text-right">学费总额</th>
                <th className="px-3 py-2 text-right">预估提成</th>
                <th className="px-3 py-2 text-right">环比</th>
                <th className="px-3 py-2 text-right">高意向</th>
                <th className="px-3 py-2 text-right">转化率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ranking.map((row) => (
                <tr key={row.userId} className={cn('hover:bg-gray-50', row.isMe && 'bg-emerald-50/50')}>
                  <td className="px-3 py-2">
                    {row.rank === 1 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">🥇</span>
                    ) : row.rank === 2 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-700 text-xs font-bold">🥈</span>
                    ) : row.rank === 3 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">🥉</span>
                    ) : (
                      <span className="text-xs text-gray-500">#{row.rank}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {row.name}
                    {row.isMe && <span className="ml-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded">我</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{row.monthDealsCount}</td>
                  <td className="px-3 py-2 text-right">{fenToYuan(row.monthTuitionFen)}</td>
                  <td className="px-3 py-2 text-right text-amber-700 font-semibold">{fenToYuan(row.monthCommissionFen)}</td>
                  <td className={cn('px-3 py-2 text-right text-xs', row.trendPct >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {row.trendPct >= 0 ? '+' : ''}{row.trendPct}%
                  </td>
                  <td className="px-3 py-2 text-right">{row.leadsHighIntent}</td>
                  <td className="px-3 py-2 text-right text-xs">{row.conversionRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-[10px] text-gray-400">
        提成率默认 8%，可通过环境变量 SPECIALIST_COMMISSION_RATE 覆盖（0-1 之间）。本数字为预估，最终金额以乙方实际发放为准。
      </div>
    </div>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: number | string; unit?: string; accent?: 'emerald' | 'amber' }) {
  const accentClass = accent === 'emerald' ? 'text-emerald-600' : accent === 'amber' ? 'text-amber-600' : 'text-gray-900';
  return (
    <div className="p-3 bg-gray-50 rounded">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={cn('text-xl font-semibold mt-0.5', accentClass)}>
        {value}{unit && <span className="text-xs text-gray-400 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

export default SpecialistPerformance;
