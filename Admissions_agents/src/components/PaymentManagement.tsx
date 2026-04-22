/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Plus,
  Wallet,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/cn';
import type { PaymentRecord } from '../types';

interface PaymentManagementProps {
  preset?: {
    activeTab?: 'records' | 'installments' | 'stats';
    filterStatus?: 'all' | 'paid' | 'partial' | 'overdue' | 'pending' | 'reminder';
    searchText?: string;
  };
}

type PaymentTab = 'records' | 'installments' | 'stats';

type PaymentStatusFilter = 'all' | 'paid' | 'partial' | 'overdue' | 'pending' | 'reminder';

const PAYMENT_TABS: { id: PaymentTab; label: string }[] = [
  { id: 'records', label: '缴费记录' },
  { id: 'installments', label: '分期管理' },
  { id: 'stats', label: '收入统计' },
];

const STATUS_CONFIG: Record<PaymentRecord['status'], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  paid: { label: '已结清', color: 'text-emerald-600 bg-emerald-50 border-emerald-100', icon: CheckCircle2 },
  partial: { label: '分期中', color: 'text-blue-600 bg-blue-50 border-blue-100', icon: Clock },
  overdue: { label: '逾期', color: 'text-red-600 bg-red-50 border-red-100', icon: AlertTriangle },
  pending: { label: '待缴费', color: 'text-amber-600 bg-amber-50 border-amber-100', icon: Clock },
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

function PaymentManagement({ preset }: PaymentManagementProps) {
  const [activeTab, setActiveTab] = useState<PaymentTab>(preset?.activeTab ?? 'records');
  const [filterStatus, setFilterStatus] = useState<PaymentStatusFilter>(preset?.filterStatus ?? 'all');
  const [searchText, setSearchText] = useState(preset?.searchText ?? '');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!preset) {
      return;
    }

    setActiveTab(preset.activeTab ?? 'records');
    setFilterStatus(preset.filterStatus ?? 'all');
    setSearchText(preset.searchText ?? '');
  }, [preset]);

  useEffect(() => {
    let alive = true;

    const loadPayments = async () => {
      setLoading(true);
      try {
        const data = await fetchJson<PaymentRecord[]>('/api/payments');
        if (!alive) {
          return;
        }
        setPayments(data);
        setErrorMsg('');
      } catch {
        if (!alive) {
          return;
        }
        setPayments([]);
        setErrorMsg('缴费数据加载失败，请确认后端服务已启动');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void loadPayments();

    return () => {
      alive = false;
    };
  }, []);

  const filteredPayments = useMemo(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();

    return payments.filter((payment) => {
      const needsReminder = Boolean(
        payment.nextPayDate
        && Date.parse(payment.nextPayDate) <= Date.now() + 7 * 24 * 60 * 60 * 1000
        && payment.paidAmount < payment.totalAmount
      );
      const statusMatched = filterStatus === 'all'
        || (filterStatus === 'reminder' ? needsReminder : payment.status === filterStatus);
      const searchMatched = normalizedSearchText.length === 0
        || payment.studentName.toLowerCase().includes(normalizedSearchText)
        || payment.major.toLowerCase().includes(normalizedSearchText);

      return statusMatched && searchMatched;
    });
  }, [filterStatus, payments, searchText]);

  const totalRevenue = useMemo(() => payments.reduce((sum, payment) => sum + payment.paidAmount, 0), [payments]);
  const totalPending = useMemo(() => payments.reduce((sum, payment) => sum + Math.max(payment.totalAmount - payment.paidAmount, 0), 0), [payments]);
  const overdueCount = useMemo(() => payments.filter((payment) => payment.status === 'overdue').length, [payments]);
  const paidCount = useMemo(() => payments.filter((payment) => payment.status === 'paid').length, [payments]);

  const revenueByMajor = useMemo(() => Object.entries(
    payments.reduce<Record<string, { amount: number; students: number }>>((acc, payment) => {
      if (!acc[payment.major]) {
        acc[payment.major] = { amount: 0, students: 0 };
      }

      acc[payment.major].amount += payment.paidAmount;
      acc[payment.major].students += 1;
      return acc;
    }, {})
  ), [payments]);

  const revenueByAgent = useMemo(() => Object.entries(
    payments.reduce<Record<string, { amount: number; students: number }>>((acc, payment) => {
      const agentName = payment.agentName || '未分配';
      if (!acc[agentName]) {
        acc[agentName] = { amount: 0, students: 0 };
      }

      acc[agentName].amount += payment.paidAmount;
      acc[agentName].students += 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1].amount - a[1].amount), [payments]);

  const paymentMethodDistribution = useMemo(() => {
    const fullCount = payments.filter((payment) => payment.method === '全款').length;
    const installmentCount = payments.filter((payment) => payment.method === '分期').length;
    const totalCount = Math.max(payments.length, 1);

    return [
      { method: '全款', count: fullCount, percent: Math.round((fullCount / totalCount) * 100) },
      { method: '分期', count: installmentCount, percent: Math.round((installmentCount / totalCount) * 100) },
    ];
  }, [payments]);

  const monthlyRevenue = useMemo(() => Object.entries(
    payments.reduce<Record<string, number>>((acc, payment) => {
      const date = payment.lastPayDate || '';
      const monthKey = date.length >= 7 ? `${date.slice(5, 7)}月` : '未知';
      acc[monthKey] = (acc[monthKey] ?? 0) + payment.paidAmount;
      return acc;
    }, {})
  ).sort((a, b) => a[0].localeCompare(b[0])), [payments]);

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: '总收入', value: `¥${totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: '待收金额', value: `¥${totalPending.toLocaleString()}`, icon: Wallet, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: '已结清', value: `${paidCount}人`, icon: CheckCircle2, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '逾期未缴', value: `${overdueCount}人`, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={cn('p-2 rounded-xl', stat.bg)}>
                <stat.icon className={cn('w-6 h-6', stat.color)} />
              </div>
            </div>
            <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
            <h3 className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
          {PAYMENT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-bold transition-all',
                activeTab === tab.id ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button disabled title="暂未开放：新增缴费表单后续接入" className="flex items-center gap-2 px-6 py-2.5 bg-gray-200 text-gray-500 rounded-xl font-bold text-sm cursor-not-allowed">
          <Plus className="w-4 h-4" />
          新增缴费（暂未开放）
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <AnimatePresence mode="wait">
        {activeTab === 'records' && (
          <motion.div key="records" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 flex flex-col gap-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-100 flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-gray-400" />
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  type="text"
                  placeholder="搜索学员姓名或专业..."
                  className="bg-transparent border-none focus:ring-0 text-sm w-full"
                />
              </div>
              <div className="flex items-center gap-2">
                {[
                  { id: 'all', label: '全部' },
                  { id: 'reminder', label: '待提醒' },
                  { id: 'paid', label: '已结清' },
                  { id: 'partial', label: '分期中' },
                  { id: 'overdue', label: '逾期' },
                  { id: 'pending', label: '待缴费' },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setFilterStatus(filter.id as PaymentStatusFilter)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                      filterStatus === filter.id
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200'
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex-1">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-6 py-4 font-medium">学员姓名</th>
                      <th className="text-left px-6 py-4 font-medium">报读专业</th>
                      <th className="text-left px-6 py-4 font-medium">缴费方式</th>
                      <th className="text-right px-6 py-4 font-medium">应缴金额</th>
                      <th className="text-right px-6 py-4 font-medium">已缴金额</th>
                      <th className="text-left px-6 py-4 font-medium">缴费状态</th>
                      <th className="text-left px-6 py-4 font-medium">最近缴费</th>
                      <th className="text-right px-6 py-4 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-10 text-center text-gray-400">加载中...</td>
                      </tr>
                    ) : filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-10 text-center text-gray-400">暂无缴费数据</td>
                      </tr>
                    ) : filteredPayments.map((payment) => {
                      const statusConfig = STATUS_CONFIG[payment.status];
                      return (
                        <tr key={payment.id} className="hover:bg-gray-50 transition-colors group">
                          <td className="px-6 py-4 font-bold text-gray-900">{payment.studentName}</td>
                          <td className="px-6 py-4 text-gray-600">{payment.major}</td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
                              {payment.method}{payment.installments ? ` (${payment.installments}期)` : ''}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-gray-600">¥{payment.totalAmount.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right font-bold text-emerald-600">¥{payment.paidAmount.toLocaleString()}</td>
                          <td className="px-6 py-4">
                            <span className={cn('px-2 py-1 rounded-lg text-[10px] font-bold border', statusConfig.color)}>
                              {statusConfig.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-500">{payment.lastPayDate || '-'}</td>
                          <td className="px-6 py-4 text-right">
                            <button disabled title="暂未开放：缴费详情后续接入" className="p-2 text-gray-300 rounded-lg opacity-0 group-hover:opacity-100 cursor-not-allowed">
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'installments' && (
          <motion.div key="installments" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h3 className="font-bold text-gray-900 mb-6">分期学员列表</h3>
              <div className="space-y-4">
                {filteredPayments.filter((payment) => payment.method === '分期').length === 0 ? (
                  <div className="py-10 text-center text-gray-400">暂无分期缴费数据</div>
                ) : filteredPayments.filter((payment) => payment.method === '分期').map((payment) => {
                  const progress = payment.installments ? Math.round(((payment.paidInstallments ?? 0) / payment.installments) * 100) : 0;
                  const statusConfig = STATUS_CONFIG[payment.status];
                  return (
                    <div key={payment.id} className="p-5 rounded-2xl border border-gray-100 hover:border-emerald-100 transition-all">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                            {payment.studentName[0]}
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-900">{payment.studentName}</h4>
                            <p className="text-xs text-gray-500">{payment.major} · 总额 ¥{payment.totalAmount.toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={cn('px-2 py-1 rounded-lg text-[10px] font-bold border', statusConfig.color)}>
                            {statusConfig.label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                            <span>缴费进度：{payment.paidInstallments ?? 0}/{payment.installments ?? 0}期</span>
                            <span>¥{payment.paidAmount.toLocaleString()} / ¥{payment.totalAmount.toLocaleString()}</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full transition-all', payment.status === 'overdue' ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                        {payment.nextPayDate && (
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">下期应缴</p>
                            <p className={cn('text-sm font-bold', payment.status === 'overdue' ? 'text-red-600' : 'text-gray-900')}>
                              {payment.nextPayDate}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'stats' && (
          <motion.div key="stats" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-6">按专业统计收入</h3>
              <div className="space-y-4">
                {revenueByMajor.length === 0 ? <p className="text-sm text-gray-400">暂无统计数据</p> : revenueByMajor.map(([major, value]) => (
                  <div key={major} className="flex items-center justify-between p-4 rounded-xl border border-gray-50 hover:bg-gray-50 transition-all">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{major}</p>
                      <p className="text-[10px] text-gray-400">{value.students}人</p>
                    </div>
                    <span className="font-bold text-emerald-600">¥{value.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-6">按招生专员统计</h3>
              <div className="space-y-4">
                {revenueByAgent.length === 0 ? <p className="text-sm text-gray-400">暂无统计数据</p> : revenueByAgent.map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between p-4 rounded-xl border border-gray-50 hover:bg-gray-50 transition-all">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                        {name[0]}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-sm">{name}</p>
                        <p className="text-[10px] text-gray-400">成交 {value.students} 单</p>
                      </div>
                    </div>
                    <span className="font-bold text-emerald-600">¥{value.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-6">缴费方式分布</h3>
              <div className="space-y-4">
                {paymentMethodDistribution.map((item, index) => (
                  <div key={item.method}>
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="font-bold text-gray-700">{item.method}</span>
                      <span className="text-gray-500">{item.count}人 ({item.percent}%)</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', index === 0 ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${item.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-6">月度收入趋势</h3>
              <div className="space-y-3">
                {monthlyRevenue.length === 0 ? <p className="text-sm text-gray-400">暂无统计数据</p> : monthlyRevenue.map(([month, amount]) => (
                  <div key={month} className="flex items-center gap-4">
                    <span className="text-xs font-bold text-gray-400 w-8">{month}</span>
                    <div className="flex-1 h-8 bg-gray-50 rounded-lg overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-lg flex items-center justify-end pr-3" style={{ width: `${Math.min((amount / Math.max(totalRevenue, 1)) * 100, 100)}%` }}>
                        <span className="text-[10px] font-bold text-white">¥{(amount / 10000).toFixed(1)}万</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default PaymentManagement;
