/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, lazy, Suspense, useEffect, useMemo } from 'react';
import {
  Bell,
  Search,
  Menu,
  ChevronRight,
  TrendingUp,
  Users as UsersIcon,
  Phone,
  BrainCircuit,
  Clock3,
  LogOut
} from 'lucide-react';
import {
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area,
  FunnelChart,
  Funnel,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Line
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { NAV_ITEMS } from './constants';
import { cn } from './lib/cn';
import { authFetch, clearAuth, getUser, getToken, setUser as saveUser, type AuthUser } from './lib/auth';
import type { DashboardSummary } from './types';
import Login from './components/Login';

const ContentFactory = lazy(() => import('./components/ContentFactory'));
const LeadManagement = lazy(() => import('./components/LeadManagement'));
const WeChatAssistant = lazy(() => import('./components/WeChatAssistant'));
const StudentManagement = lazy(() => import('./components/StudentManagement'));
const PaymentManagement = lazy(() => import('./components/PaymentManagement'));
const ScheduleManagement = lazy(() => import('./components/ScheduleManagement'));
const Settings = lazy(() => import('./components/Settings'));
const StudentPortal = lazy(() => import('./components/StudentPortal'));
const AcquisitionEngine = lazy(() => import('./components/AcquisitionEngine'));
const ComplianceCenter = lazy(() => import('./components/ComplianceCenter'));
const ManagementCenter = lazy(() => import('./components/ManagementCenter'));
const PlatformConsole = lazy(() => import('./components/PlatformConsole'));
const AgentWorkspace = lazy(() => import('./components/AgentWorkspace'));
const HomePanel = lazy(() => import('./components/HomePanel'));
const ValueStatementPanel = lazy(() => import('./components/ValueStatementPanel'));
const ReferralCenter = lazy(() => import('./components/ReferralCenter'));
const SpecialistPerformance = lazy(() => import('./components/SpecialistPerformance'));

type LeadPreset = {
  searchText?: string;
  sourceFilter?: string;
  intentFilter?: string;
  statusFilter?: string;
  onlyNeedsFollowup?: boolean;
  sortBy?: 'latest' | 'priority' | 'intent';
};

type PaymentPreset = {
  activeTab?: 'records' | 'installments' | 'stats';
  filterStatus?: 'all' | 'paid' | 'partial' | 'overdue' | 'pending' | 'reminder';
  searchText?: string;
};

// ── Dashboard 动态数据 ──────────────────────────────────────
const PERFORMANCE_DATA: DashboardSummary['performance'] = [];
const FUNNEL_DATA: DashboardSummary['funnel'] = [];
const TREND_DATA: DashboardSummary['trend'] = [];
const SOURCE_DATA: DashboardSummary['sources'] = [];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [leadPreset, setLeadPreset] = useState<LeadPreset>();
  const [paymentPreset, setPaymentPreset] = useState<PaymentPreset>();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => getUser());
  const [bootChecked, setBootChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setBootChecked(true);
      return;
    }

    void (async () => {
      try {
        const response = await authFetch('/api/auth/me');
        const payload = await response.json();
        if (response.ok && payload.success) {
          saveUser(payload.data);
          setCurrentUser(payload.data);
        } else {
          clearAuth();
          setCurrentUser(null);
        }
      } catch {
        clearAuth();
        setCurrentUser(null);
      } finally {
        setBootChecked(true);
      }
    })();

    const onExpired = () => {
      setCurrentUser(null);
    };
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const loadSummary = async () => {
      try {
        const response = await authFetch('/api/dashboard/summary');
        const payload = await response.json();
        if (response.ok && payload.success) {
          setDashboardSummary(payload.data as DashboardSummary);
        }
      } catch {
        setDashboardSummary(null);
      }
    };

    const handleRefresh = () => {
      void loadSummary();
    };

    void loadSummary();
    window.addEventListener('dashboard-summary-refresh', handleRefresh);
    return () => window.removeEventListener('dashboard-summary-refresh', handleRefresh);
  }, [currentUser]);

  if (!bootChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        加载中…
      </div>
    );
  }

  if (!currentUser) {
    return <Login onLoggedIn={(user) => setCurrentUser(user)} />;
  }

  const handleLogout = () => {
    clearAuth();
    setCurrentUser(null);
  };

  const summaryPerformance = dashboardSummary?.performance ?? PERFORMANCE_DATA;
  const summaryFunnel = dashboardSummary?.funnel ?? FUNNEL_DATA;
  const summaryTrend = dashboardSummary?.trend ?? TREND_DATA;
  const summarySources = dashboardSummary?.sources ?? SOURCE_DATA;
  const summaryTodayNewLeads = dashboardSummary?.todayNewLeads ?? 0;
  const summaryContactedLeads = dashboardSummary?.contactedLeads ?? 0;
  const summaryInterestedLeads = dashboardSummary?.interestedLeads ?? 0;
  const summaryPendingFollowUps = dashboardSummary?.pendingFollowUps ?? 0;
  const summaryPendingPaymentReminders = dashboardSummary?.pendingPaymentReminders ?? 0;
  const summaryContentGeneratedCount = dashboardSummary?.contentGeneratedCount ?? 0;
  const summaryContentPublishedCount = dashboardSummary?.contentPublishedCount ?? 0;
  const summaryContentViews = dashboardSummary?.contentViews ?? 0;
  const summaryContentLeads = dashboardSummary?.contentLeads ?? 0;

  const dashboardTodos = useMemo(() => ([
    {
      title: '待跟进学员',
      count: summaryPendingFollowUps,
      color: 'bg-blue-100 text-blue-700',
      onClick: () => {
        setLeadPreset({ onlyNeedsFollowup: true, sortBy: 'priority' });
        setPaymentPreset(undefined);
        setActiveTab('leads');
      },
    },
    {
      title: '待催缴提醒',
      count: summaryPendingPaymentReminders,
      color: 'bg-red-100 text-red-700',
      onClick: () => {
        setPaymentPreset({ activeTab: 'records', filterStatus: 'reminder' });
        setLeadPreset(undefined);
        setActiveTab('payment');
      },
    },
    {
      title: '已发布内容',
      count: summaryContentPublishedCount,
      color: 'bg-emerald-100 text-emerald-700',
      onClick: () => {
        setLeadPreset(undefined);
        setPaymentPreset(undefined);
        setActiveTab('factory');
      },
    },
    {
      title: '内容带来线索',
      count: summaryContentLeads,
      color: 'bg-purple-100 text-purple-700',
      onClick: () => {
        setLeadPreset(undefined);
        setPaymentPreset(undefined);
        setActiveTab('factory');
      },
    },
  ]), [summaryContentLeads, summaryContentPublishedCount, summaryPendingFollowUps, summaryPendingPaymentReminders]);

  return (
    <div className="flex h-screen bg-[#F8F9FA] overflow-hidden font-sans">
      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-[#1A1C1E] text-white transition-all duration-300 flex flex-col z-50",
          isSidebarOpen ? "w-[220px]" : "w-0 -translate-x-full md:w-[70px] md:translate-x-0"
        )}
      >
        <div className="p-6 flex items-center gap-3 border-b border-white/10">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
            <TrendingUp className="text-white w-5 h-5" />
          </div>
          {isSidebarOpen && <span className="font-bold text-lg tracking-tight truncate">招生智能体</span>}
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.filter((item) => {
            if (item.id === 'platform') {
              return currentUser.role === 'admin' && currentUser.tenant === 'platform';
            }
            if (item.id === 'compliance' || item.id === 'management') {
              return currentUser.role === 'admin' || currentUser.role === 'tenant_admin';
            }
            return true;
          }).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                if (item.id !== 'leads') {
                  setLeadPreset(undefined);
                }
                if (item.id !== 'payment') {
                  setPaymentPreset(undefined);
                }
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group",
                activeTab === item.id 
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0", activeTab === item.id ? "text-white" : "group-hover:text-white")} />
              {isSidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-gray-400 hover:bg-white/5 hover:text-white transition-all"
          >
            <div className="w-8 h-8 rounded-full bg-gray-700 shrink-0 flex items-center justify-center text-xs font-semibold text-white">
              {currentUser.name.slice(0, 1)}
            </div>
            {isSidebarOpen && (
              <div className="flex-1 text-left">
                <p className="text-xs font-semibold text-white truncate">{currentUser.name}</p>
                <p className="text-[10px] opacity-50 truncate">
                  {({
                    admin: '甲方管理员',
                    tenant_admin: '乙方管理员',
                    specialist: '招生专员',
                    student: '学员',
                  } as const)[currentUser.role]}
                  {' · '}@{currentUser.username}
                </p>
              </div>
            )}
            {isSidebarOpen && <LogOut className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5 text-gray-500" />
            </button>
            <div className="relative hidden sm:block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="搜索线索、学员..." 
                className="pl-10 pr-4 py-2 bg-gray-100 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm w-64 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="p-2 hover:bg-gray-100 rounded-lg relative transition-colors">
              <Bell className="w-5 h-5 text-gray-500" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
            </button>
            <div className="h-8 w-[1px] bg-gray-200 mx-2" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 hidden sm:block">某某学历提升机构</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                HQ
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={
            <div className="space-y-6 animate-pulse">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-[110px]">
                    <div className="w-10 h-10 bg-gray-100 rounded-xl mb-4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
                    <div className="h-6 bg-gray-100 rounded w-1/3" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-[380px]" />
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-[380px]" />
              </div>
            </div>
          }>
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* 角色化首屏（v3.1 新增） */}
                <HomePanel onNavigate={(tab) => setActiveTab(tab)} />

                {/* 经典 Stats Grid（保留，作为详细视图） */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    { label: '今日新线索', value: String(summaryTodayNewLeads), change: '真实数据', icon: UsersIcon, color: 'text-blue-600' },
                    { label: '已联系线索', value: String(summaryContactedLeads), change: '真实数据', icon: Phone, color: 'text-emerald-600' },
                    { label: '意向明确', value: String(summaryInterestedLeads), change: '真实数据', icon: BrainCircuit, color: 'text-amber-600' },
                    { label: '待跟进学员', value: String(summaryPendingFollowUps), change: '真实数据', icon: Clock3, color: 'text-indigo-600' },
                  ].map((stat, i) => (
                    <div key={i} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between mb-4">
                        <div className={cn("p-2 rounded-xl bg-opacity-10", stat.color.replace('text', 'bg'))}>
                          <stat.icon className={cn("w-6 h-6", stat.color)} />
                        </div>
                        <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                          {stat.change}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
                      <h3 className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</h3>
                    </div>
                  ))}
                </div>

                {/* Middle Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Funnel Chart */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-gray-900">渠道转化漏斗</h3>
                      <select className="text-xs border-gray-200 rounded-lg bg-gray-50">
                        <option>最近30天</option>
                        <option>本月</option>
                      </select>
                    </div>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <FunnelChart>
                          <Tooltip />
                          <Funnel
                            dataKey="value"
                            data={summaryFunnel}
                            isAnimationActive
                          >
                            <LabelList position="right" fill="#666" stroke="none" dataKey="name" />
                          </Funnel>
                        </FunnelChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Performance Table */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-gray-900">招生专员业绩榜</h3>
                      <button className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                        查看全部 <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left py-3 font-medium">姓名</th>
                            <th className="text-left py-3 font-medium">线索数</th>
                            <th className="text-left py-3 font-medium">跟进数</th>
                            <th className="text-left py-3 font-medium">意向明确</th>
                            <th className="text-right py-3 font-medium">已报名</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {summaryPerformance.map((row, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="py-4 font-medium text-gray-900">{row.name}</td>
                              <td className="py-4 text-gray-600">{row.leads}</td>
                              <td className="py-4 text-gray-600">{row.followUps}</td>
                              <td className="py-4 text-gray-600">{row.interested}</td>
                              <td className="py-4 text-right font-bold text-emerald-600">{row.enrolled}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Bottom Charts & Tasks */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Trend Chart */}
                  <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-gray-900">近7天线索与跟进趋势</h3>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-emerald-500" />
                          <span className="text-xs text-gray-500">跟进数</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-blue-500" />
                          <span className="text-xs text-gray-500">线索数</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={summaryTrend}>
                          <defs>
                            <linearGradient id="colorInteractions" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                          <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#999'}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#999'}} />
                          <Tooltip />
                          <Area type="monotone" dataKey="followUps" stroke="#10b981" fillOpacity={1} fill="url(#colorInteractions)" strokeWidth={3} />
                          <Line type="monotone" dataKey="leads" stroke="#3b82f6" strokeWidth={2} dot={{r: 4, fill: '#3b82f6'}} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Todo List */}
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <div>
                      <h3 className="font-bold text-gray-900 mb-6">待办事项</h3>
                      <div className="space-y-4">
                      {dashboardTodos.map((todo) => (
                        <button
                          key={todo.title}
                          onClick={todo.onClick}
                          className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-emerald-100 hover:bg-emerald-50/30 transition-all cursor-pointer group text-left"
                        >
                          <span className="text-sm font-medium text-gray-700">{todo.title}</span>
                          <div className={cn("px-2 py-1 rounded-lg text-xs font-bold", todo.color)}>
                            {todo.count}
                          </div>
                        </button>
                      ))}
                      <button className="w-full mt-4 py-3 border-2 border-dashed border-gray-100 rounded-xl text-gray-400 text-sm font-medium hover:border-emerald-200 hover:text-emerald-500 transition-all">
                        + 添加自定义提醒
                      </button>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-bold text-gray-900 mb-4">线索来源分布</h3>
                      <div className="space-y-3">
                        {summarySources.map((item) => (
                          <div key={item.source} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-700 font-medium">{item.source}</span>
                              <span className="text-gray-500">{item.count}</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{ width: `${summarySources.length > 0 ? (item.count / Math.max(...summarySources.map((source) => source.count), 1)) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        ))}
                        {summarySources.length === 0 && <p className="text-sm text-gray-400">暂无来源数据</p>}
                      </div>
                      <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                        <p className="font-bold">内容运营概览</p>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                          <div>AI生成内容：<span className="font-bold">{summaryContentGeneratedCount}</span></div>
                          <div>已发布内容：<span className="font-bold">{summaryContentPublishedCount}</span></div>
                          <div>累计曝光：<span className="font-bold">{summaryContentViews.toLocaleString()}</span></div>
                          <div>内容带来线索：<span className="font-bold">{summaryContentLeads}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'factory' && (
              <motion.div
                key="factory"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <ContentFactory />
              </motion.div>
            )}

            {activeTab === 'leads' && (
              <motion.div
                key={`leads-${JSON.stringify(leadPreset ?? {})}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <LeadManagement preset={leadPreset} />
              </motion.div>
            )}

            {activeTab === 'assistant' && (
              <motion.div
                key="assistant"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <WeChatAssistant />
              </motion.div>
            )}

            {activeTab === 'students' && (
              <motion.div
                key="students"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <StudentManagement />
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <Settings />
              </motion.div>
            )}

            {activeTab === 'payment' && (
              <motion.div
                key={`payment-${JSON.stringify(paymentPreset ?? {})}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <PaymentManagement preset={paymentPreset} />
              </motion.div>
            )}

            {activeTab === 'schedule' && (
              <motion.div
                key="schedule"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <ScheduleManagement />
              </motion.div>
            )}

            {activeTab === 'portal' && (
              <motion.div
                key="portal"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <StudentPortal />
              </motion.div>
            )}

            {activeTab === 'acquisition' && (
              <motion.div
                key="acquisition"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <AcquisitionEngine />
              </motion.div>
            )}

            {activeTab === 'compliance' && (
              <motion.div
                key="compliance"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <ComplianceCenter />
              </motion.div>
            )}

            {activeTab === 'management' && (
              <motion.div
                key="management"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <ManagementCenter />
              </motion.div>
            )}

            {activeTab === 'platform' && (
              <motion.div
                key="platform"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <PlatformConsole />
              </motion.div>
            )}

            {activeTab === 'agent' && (
              <motion.div
                key="agent"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <AgentWorkspace />
              </motion.div>
            )}

            {activeTab === 'value-statement' && (
              <motion.div
                key="value-statement"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <ValueStatementPanel />
              </motion.div>
            )}

            {activeTab === 'referrals' && (
              <motion.div
                key="referrals"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <ReferralCenter />
              </motion.div>
            )}

            {activeTab === 'performance' && (
              <motion.div
                key="performance"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <SpecialistPerformance />
              </motion.div>
            )}
          </AnimatePresence>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
