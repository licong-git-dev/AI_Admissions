/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Bot,
  PlayCircle,
  ChevronRight,
  Users,
  Loader2,
  Clock,
  RefreshCw,
  Megaphone,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { authJson, getUser } from '../lib/auth';

type Highlight = { label: string; value: string | number; unit?: string; accent?: 'emerald' | 'orange' | 'red' | 'gray' };

type TopAction = { type: string; title: string; count: number; to: string };

type HomeData = {
  role: 'platform_admin' | 'tenant_admin' | 'specialist';
  headline: string;
  highlights: Highlight[];
  topActions?: TopAction[];
  aiSummary?: { activeMissions: number; succeeded24h: number; waitingApproval: number };
  quickActions?: Array<{ id: string; label: string }>;
  todayTodos?: Array<{
    id: number;
    nickname: string;
    intent: 'high' | 'medium' | 'low';
    source: string;
    lastMessage: string;
    nextFollowupAt: string | null;
    nextAction: string | null;
  }>;
};

type OnboardingCheck = {
  id: string;
  label: string;
  completed: boolean;
  actionLabel: string;
  actionTab: string;
};

type Onboarding = {
  checks: OnboardingCheck[];
  completedCount: number;
  totalCount: number;
  progress: number;
  finished: boolean;
};

type AgentPersona = {
  id: string;
  name: string;
  avatar: string;
  role: string;
  tagline: string;
  tone: string;
  signature: string;
};

type Briefing = {
  tenant: string;
  date: string;
  narrative: string;
  stats: {
    leadsNew: number;
    leadsHighIntentNew: number;
    contentDrafted: number;
    contentApproved: number;
    contentPublished: number;
    missionsRun: number;
    missionsSucceeded: number;
    missionsFailed: number;
    autoApproved: number;
    dealsLast7d: number;
    rpaLoggedIn: number;
    dmsScanned: number;
  };
  personaId: string;
  source: 'ai' | 'template';
  generatedAt: string;
  persona?: AgentPersona;
};

const ACCENT_COLORS: Record<string, string> = {
  emerald: 'text-emerald-600',
  orange: 'text-orange-600',
  red: 'text-red-600',
  gray: 'text-gray-900',
};

// v3.3.a · mission type → persona 头像快速映射（与 server/src/services/agent-personas.ts 同步）
const MISSION_PERSONA_AVATAR: Record<string, { avatar: string; name: string }> = {
  daily_content_sprint: { avatar: '🎯', name: '小招' },
  lead_followup_sweep: { avatar: '🕸️', name: '小线' },
  weekly_report: { avatar: '📊', name: '小报' },
  daily_briefing: { avatar: '📊', name: '小报' },
};

function HomePanel({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const user = getUser();
  const [home, setHome] = useState<HomeData | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await authJson<HomeData>('/api/dashboard/home');
        setHome(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
      }
    };
    const loadOnboarding = async () => {
      try {
        const data = await authJson<Onboarding>('/api/dashboard/onboarding');
        setOnboarding(data);
      } catch {
        // ignore
      }
    };
    const loadBriefing = async () => {
      try {
        const data = await authJson<Briefing | null>('/api/dashboard/tenant-briefing/latest');
        setBriefing(data);
      } catch {
        // ignore
      }
    };
    void load();
    void loadOnboarding();
    void loadBriefing();
  }, []);

  const generateBriefing = async () => {
    setBriefingLoading(true);
    try {
      const data = await authJson<Briefing>('/api/dashboard/tenant-briefing/generate', { method: 'POST' });
      setBriefing(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成战报失败');
    } finally {
      setBriefingLoading(false);
    }
  };

  const showOnboarding = useMemo(() => {
    if (!onboarding) return false;
    if (onboarding.finished) return false;
    // 仅对 tenant_admin 显示新手引导
    return home?.role === 'tenant_admin';
  }, [onboarding, home]);

  const launchMission = async (type: string) => {
    setLaunching(type);
    try {
      await authJson('/api/missions/quick-start', {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      onNavigate('agent');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动 AI 任务失败');
    } finally {
      setLaunching(null);
    }
  };

  if (!home) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-500" />
          {home.headline}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          欢迎回来{user?.name ? `，${user.name}` : ''} · 今天是 {new Date().toLocaleDateString('zh-CN')}
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{errorMsg}</div>
      )}

      {/* 今日战报（仅乙方管理员显示 · v3.3.a AI 员工人格化）*/}
      {home.role === 'tenant_admin' && (
        <BriefingCard
          briefing={briefing}
          loading={briefingLoading}
          onGenerate={generateBriefing}
        />
      )}

      {/* 新手引导（仅乙方管理员未完成时显示） */}
      {showOnboarding && onboarding && (
        <div className="p-4 bg-gradient-to-r from-blue-50 to-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold text-gray-900">🚀 第一次使用？完成以下任务，系统才能真正跑起来</div>
              <div className="text-xs text-gray-600 mt-0.5">已完成 {onboarding.completedCount} / {onboarding.totalCount}</div>
            </div>
            <div className="text-2xl font-bold text-emerald-600">{onboarding.progress}%</div>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${onboarding.progress}%` }}
            />
          </div>
          <div className="space-y-1.5">
            {onboarding.checks.map((c) => (
              <button
                key={c.id}
                onClick={() => onNavigate(c.actionTab)}
                disabled={c.completed}
                className={cn(
                  'w-full flex items-center justify-between p-2 rounded text-sm',
                  c.completed ? 'bg-emerald-50 text-gray-500' : 'bg-white hover:bg-gray-50 text-gray-900 border border-gray-200'
                )}
              >
                <div className="flex items-center gap-2">
                  {c.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                  )}
                  <span className={c.completed ? 'line-through' : ''}>{c.label}</span>
                </div>
                {!c.completed && (
                  <span className="flex items-center gap-0.5 text-xs text-emerald-600">
                    {c.actionLabel}
                    <ChevronRight className="w-3 h-3" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top Actions */}
      {home.topActions && home.topActions.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">需要你处理</div>
          {home.topActions.map((action, idx) => (
            <button
              key={idx}
              onClick={() => onNavigate(action.to)}
              className={cn(
                'w-full flex items-center justify-between p-3 rounded-lg border transition-all',
                action.type === 'alert' ? 'bg-red-50 border-red-200 hover:bg-red-100' :
                action.type === 'approval' ? 'bg-orange-50 border-orange-200 hover:bg-orange-100' :
                action.type === 'warning' ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' :
                'bg-white border-gray-200 hover:bg-gray-50'
              )}
            >
              <div className="flex items-center gap-2">
                {action.type === 'alert' || action.type === 'warning' ? (
                  <AlertTriangle className={cn('w-4 h-4', action.type === 'alert' ? 'text-red-600' : 'text-amber-600')} />
                ) : action.type === 'approval' ? (
                  <Bot className="w-4 h-4 text-orange-600" />
                ) : (
                  <Users className="w-4 h-4 text-gray-600" />
                )}
                <span className="text-sm font-medium text-gray-900">{action.title}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>
          ))}
        </div>
      )}

      {/* 核心指标 */}
      <div className={cn('grid gap-3', home.highlights.length >= 5 ? 'grid-cols-6' : 'grid-cols-3')}>
        {home.highlights.map((h, idx) => (
          <div key={idx} className="p-3 bg-white border border-gray-200 rounded-lg">
            <div className="text-[11px] text-gray-500">{h.label}</div>
            <div className={cn('text-xl font-semibold mt-0.5', ACCENT_COLORS[h.accent ?? 'gray'])}>
              {h.value}
              {h.unit && <span className="text-xs text-gray-400 ml-0.5">{h.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* AI 员工摘要 */}
      {home.aiSummary && (
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-600" />
              <div className="font-medium text-sm">AI 员工状态</div>
            </div>
            <button onClick={() => onNavigate('agent')} className="text-xs text-emerald-600 hover:underline">
              前往 →
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <MiniStat label="进行中" value={home.aiSummary.activeMissions} accent="text-amber-600" />
            <MiniStat label="24h 完成" value={home.aiSummary.succeeded24h} accent="text-emerald-600" />
            <MiniStat
              label="待审批"
              value={home.aiSummary.waitingApproval}
              accent={home.aiSummary.waitingApproval > 0 ? 'text-orange-600' : 'text-gray-900'}
            />
          </div>
          {home.quickActions && (
            <div className="space-y-1.5">
              <div className="text-xs text-gray-500 uppercase tracking-wide">一键交给 AI</div>
              {home.quickActions.map((qa) => {
                const missionType = qa.id.startsWith('mission:') ? qa.id.slice('mission:'.length) : null;
                const persona = missionType ? MISSION_PERSONA_AVATAR[missionType] : null;
                return (
                  <button
                    key={qa.id}
                    onClick={() => {
                      if (missionType) void launchMission(missionType);
                      else if (qa.id.startsWith('goto:')) onNavigate(qa.id.slice('goto:'.length));
                    }}
                    disabled={launching === missionType}
                    className="w-full flex items-center justify-between p-2 bg-emerald-50 hover:bg-emerald-100 rounded text-sm text-left disabled:opacity-50"
                  >
                    <span className="flex items-center gap-1.5">
                      {launching === missionType ? (
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                      ) : persona ? (
                        <span className="text-base leading-none" title={persona.name}>{persona.avatar}</span>
                      ) : (
                        <PlayCircle className="w-3 h-3 text-emerald-600" />
                      )}
                      <span className="text-gray-900">
                        {persona && <span className="text-xs text-emerald-700 mr-1">{persona.name}：</span>}
                        {qa.label}
                      </span>
                    </span>
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 专员今日待办 */}
      {home.role === 'specialist' && home.todayTodos && home.todayTodos.length > 0 && (
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600" />
              <div className="font-medium text-sm">今日要跟进（{home.todayTodos.length}）</div>
            </div>
            <button onClick={() => onNavigate('leads')} className="text-xs text-emerald-600 hover:underline">
              全部 →
            </button>
          </div>
          <div className="space-y-1.5">
            {home.todayTodos.slice(0, 8).map((t) => (
              <button
                key={t.id}
                onClick={() => onNavigate('leads')}
                className="w-full flex items-center justify-between p-2 bg-gray-50 hover:bg-gray-100 rounded text-sm text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'px-1.5 py-0.5 text-[10px] rounded',
                      t.intent === 'high' ? 'bg-red-100 text-red-700' :
                      t.intent === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    )}>
                      {t.intent === 'high' ? '高' : t.intent === 'medium' ? '中' : '低'}
                    </span>
                    <span className="text-gray-900 font-medium">{t.nickname}</span>
                    <span className="text-xs text-gray-400">· {t.source}</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">{t.lastMessage}</div>
                </div>
                <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0 ml-2" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="p-2 bg-gray-50 rounded text-center">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={cn('text-xl font-semibold', accent ?? 'text-gray-900')}>{value}</div>
    </div>
  );
}

// v3.3.a · AI 员工「今日战报」卡片
function BriefingCard({
  briefing,
  loading,
  onGenerate,
}: {
  briefing: Briefing | null;
  loading: boolean;
  onGenerate: () => void;
}) {
  const persona = briefing?.persona ?? { avatar: '📊', name: '小报', role: '经营分析师', tagline: '每天一份战报' } as AgentPersona;
  const today = new Date().toISOString().slice(0, 10);
  const isToday = briefing?.date === today;

  return (
    <div className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white border-2 border-indigo-200 flex items-center justify-center text-2xl shadow-sm">
          {persona.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{persona.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{persona.role}</span>
            {briefing && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                {briefing.source === 'ai' ? 'AI 生成' : '规则生成'}
              </span>
            )}
            {!isToday && briefing && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                {briefing.date}（非当日）
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 italic">"{persona.tagline}"</div>

          {briefing ? (
            <div className="mt-3 space-y-2">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 bg-white/60 rounded-lg p-3 border border-white">
                {briefing.narrative}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span className="flex items-center gap-1">
                  <Megaphone className="w-3 h-3" /> 扫描 {briefing.stats.dmsScanned}
                </span>
                <span>线索 +{briefing.stats.leadsNew}</span>
                <span>高意向 +{briefing.stats.leadsHighIntentNew}</span>
                <span>内容 {briefing.stats.contentDrafted}/{briefing.stats.contentPublished}</span>
                {briefing.stats.missionsFailed > 0 && (
                  <span className="text-red-600">失败 {briefing.stats.missionsFailed}</span>
                )}
                <button
                  onClick={onGenerate}
                  disabled={loading}
                  className="ml-auto flex items-center gap-1 text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  重新生成
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between bg-white/60 rounded-lg p-3 border border-white">
              <div className="text-sm text-gray-600">
                今天还没生成战报。
                <span className="text-xs text-gray-400 ml-1">（每日 19:00 自动生成，也可手动拉一份）</span>
              </div>
              <button
                onClick={onGenerate}
                disabled={loading}
                className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {loading ? '生成中…' : '让小报出一份'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HomePanel;
