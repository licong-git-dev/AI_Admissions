/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Gift, Users, CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { authJson } from '../lib/auth';
import { cn } from '../lib/cn';

type ReferralStats = {
  totalCodes: number;
  totalInvited: number;
  totalConverted: number;
  pendingRewardsCount: number;
  pendingRewardsFen: number;
  paidRewardsFen: number;
};

type ReferralReward = {
  id: number;
  tenant: string;
  referralCodeId: number;
  referralCodeValue: string;
  referrerLeadId: number;
  referrerName: string;
  refereeLeadId: number;
  refereeName: string;
  dealId: number | null;
  rewardFor: 'referrer' | 'referee';
  amountFen: number;
  rewardType: string;
  status: 'pending' | 'paid' | 'voided';
  paidAt: string | null;
  paidBy: number | null;
  note: string | null;
  createdAt: string;
};

type ReferralCodeRow = {
  id: number;
  code: string;
  referrerLeadId: number;
  referrerName: string;
  referrerPhone: string | null;
  invitedCount: number;
  convertedCount: number;
  isActive: boolean;
  createdAt: string;
};

function ReferralCenter() {
  const [tab, setTab] = useState<'rewards' | 'codes'>('rewards');
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [codes, setCodes] = useState<ReferralCodeRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid'>('all');
  const [error, setError] = useState('');
  const [marking, setMarking] = useState<number | null>(null);

  const loadAll = async () => {
    try {
      const [s, c] = await Promise.all([
        authJson<ReferralStats>('/api/referrals/stats'),
        authJson<ReferralCodeRow[]>('/api/referrals/codes?limit=200'),
      ]);
      setStats(s);
      setCodes(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  };

  const loadRewards = async () => {
    try {
      const url = statusFilter === 'all'
        ? '/api/referrals/rewards?limit=200'
        : `/api/referrals/rewards?status=${statusFilter}&limit=200`;
      const list = await authJson<ReferralReward[]>(url);
      setRewards(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载奖励列表失败');
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    void loadRewards();
  }, [statusFilter]);

  const handleMarkPaid = async (rewardId: number) => {
    setMarking(rewardId);
    try {
      await authJson(`/api/referrals/rewards/${rewardId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await Promise.all([loadAll(), loadRewards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setMarking(null);
    }
  };

  const filtered = useMemo(() => rewards, [rewards]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Gift className="w-5 h-5 text-rose-500" />
          转介绍管理
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          学员转介绍是教育行业 ROI 最高的获客通道 · 推荐人 ¥200 / 被推荐人 ¥100（首单）
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* 顶部指标 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <SmallStat label="已签发推荐码" value={stats.totalCodes} unit="个" />
          <SmallStat label="累计邀请" value={stats.totalInvited} unit="人次" />
          <SmallStat label="累计转化" value={stats.totalConverted} unit="单" accent="emerald" />
          <SmallStat label="待发放" value={stats.pendingRewardsCount} unit="笔" accent={stats.pendingRewardsCount > 0 ? 'orange' : 'gray'} />
          <SmallStat label="待付金额" value={`¥${(stats.pendingRewardsFen / 100).toLocaleString('zh-CN')}`} accent={stats.pendingRewardsFen > 0 ? 'orange' : 'gray'} />
          <SmallStat label="已付金额" value={`¥${(stats.paidRewardsFen / 100).toLocaleString('zh-CN')}`} accent="emerald" />
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b border-gray-200">
        <TabBtn active={tab === 'rewards'} onClick={() => setTab('rewards')}>奖励流水（{rewards.length}）</TabBtn>
        <TabBtn active={tab === 'codes'} onClick={() => setTab('codes')}>推荐码列表（{codes.length}）</TabBtn>
      </div>

      {tab === 'rewards' && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">状态：</span>
            {(['all', 'pending', 'paid'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1 rounded text-xs',
                  statusFilter === s
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                )}
              >
                {s === 'all' ? '全部' : s === 'pending' ? '待发放' : '已发放'}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="p-12 text-center bg-white border border-gray-200 rounded-xl text-gray-500 text-sm">
              暂无奖励记录。被推荐人成交时会自动生成两条记录。
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">推荐码</th>
                    <th className="px-3 py-2 text-left">推荐人</th>
                    <th className="px-3 py-2 text-left">被推荐人</th>
                    <th className="px-3 py-2 text-left">奖励对象</th>
                    <th className="px-3 py-2 text-right">金额</th>
                    <th className="px-3 py-2 text-left">状态</th>
                    <th className="px-3 py-2 text-left">创建时间</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{r.referralCodeValue}</td>
                      <td className="px-3 py-2">{r.referrerName}</td>
                      <td className="px-3 py-2">{r.refereeName}</td>
                      <td className="px-3 py-2">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px]',
                          r.rewardFor === 'referrer' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'
                        )}>
                          {r.rewardFor === 'referrer' ? '推荐人' : '被推荐人'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">¥{(r.amountFen / 100).toLocaleString('zh-CN')}</td>
                      <td className="px-3 py-2">
                        {r.status === 'paid' ? (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" /> 已发放
                          </span>
                        ) : r.status === 'voided' ? (
                          <span className="text-gray-500">已作废</span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600">
                            <Clock className="w-3 h-3" /> 待发放
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-3 py-2 text-right">
                        {r.status === 'pending' && (
                          <button
                            onClick={() => handleMarkPaid(r.id)}
                            disabled={marking === r.id}
                            className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs disabled:opacity-50"
                          >
                            {marking === r.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : '标记已发'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'codes' && (
        <>
          {codes.length === 0 ? (
            <div className="p-12 text-center bg-white border border-gray-200 rounded-xl text-gray-500 text-sm">
              还没有学员签发推荐码。学员在「学员自助端」内成交后可以拿到自己的推荐码。
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">推荐码</th>
                    <th className="px-3 py-2 text-left">推荐人</th>
                    <th className="px-3 py-2 text-left">联系方式</th>
                    <th className="px-3 py-2 text-right">已邀请</th>
                    <th className="px-3 py-2 text-right">已转化</th>
                    <th className="px-3 py-2 text-right">转化率</th>
                    <th className="px-3 py-2 text-left">创建</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {codes.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                      <td className="px-3 py-2 flex items-center gap-1.5">
                        <Users className="w-3 h-3 text-gray-400" /> {c.referrerName}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{c.referrerPhone ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{c.invitedCount}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 font-medium">{c.convertedCount}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        {c.invitedCount === 0 ? '—' : `${Math.round((c.convertedCount / c.invitedCount) * 100)}%`}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{c.createdAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SmallStat({ label, value, unit, accent }: { label: string; value: number | string; unit?: string; accent?: 'emerald' | 'orange' | 'gray' }) {
  const accentClass = accent === 'emerald' ? 'text-emerald-600' : accent === 'orange' ? 'text-orange-600' : 'text-gray-900';
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={cn('text-xl font-semibold mt-0.5', accentClass)}>
        {value}{unit && <span className="text-xs text-gray-400 ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm border-b-2 -mb-px',
        active ? 'border-emerald-500 text-emerald-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
      )}
    >
      {children}
    </button>
  );
}

export default ReferralCenter;
