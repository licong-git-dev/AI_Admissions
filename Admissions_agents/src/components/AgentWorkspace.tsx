/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  PlayCircle,
  PauseCircle,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Loader2,
  Hand,
  Eye,
  CalendarClock,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { authJson } from '../lib/auth';

type MissionTemplate = {
  type: string;
  title: string;
  description: string;
  defaultGoal: Record<string, unknown>;
  goalHint: string;
};

type Mission = {
  id: number;
  tenant: string;
  type: string;
  title: string;
  goal: Record<string, unknown>;
  status: 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'canceled';
  createdBy: number | null;
  stepCount: number;
  approvalCount: number;
  lastError: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MissionStep = {
  id: number;
  missionId: number;
  stepIndex: number;
  role: 'assistant' | 'tool_call' | 'tool_result' | 'system' | 'approval';
  content: string | null;
  toolName: string | null;
  toolArgs: Record<string, unknown> | null;
  toolResult: unknown;
  needsApproval: boolean;
  approvedBy: number | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<Mission['status'], string> = {
  queued: '排队中',
  running: '执行中',
  waiting_approval: '等待审批',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
};

const STATUS_COLORS: Record<Mission['status'], string> = {
  queued: 'bg-blue-100 text-blue-700',
  running: 'bg-amber-100 text-amber-700',
  waiting_approval: 'bg-orange-100 text-orange-800',
  succeeded: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  canceled: 'bg-gray-100 text-gray-600',
};

const STATUS_ICONS: Record<Mission['status'], React.ComponentType<{ className?: string }>> = {
  queued: Clock,
  running: Loader2,
  waiting_approval: Hand,
  succeeded: CheckCircle2,
  failed: XCircle,
  canceled: PauseCircle,
};

function AgentWorkspace() {
  const [templates, setTemplates] = useState<MissionTemplate[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selected, setSelected] = useState<Mission | null>(null);
  const [steps, setSteps] = useState<MissionStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadMissions = async () => {
    try {
      const list = await authJson<Mission[]>('/api/missions');
      setMissions(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载失败');
    }
  };

  const loadTemplates = async () => {
    try {
      const list = await authJson<MissionTemplate[]>('/api/missions/templates');
      setTemplates(list);
    } catch {
      // ignore
    }
  };

  const loadSteps = async (missionId: number) => {
    setLoading(true);
    try {
      const list = await authJson<MissionStep[]>(`/api/missions/${missionId}/steps`);
      setSteps(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '轨迹加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMissions();
    void loadTemplates();
  }, []);

  // 活动 mission 自动刷新（每 5 秒）
  useEffect(() => {
    const hasActive = missions.some((m) => ['queued', 'running', 'waiting_approval'].includes(m.status));
    if (!hasActive) return;

    const timer = setInterval(() => {
      void loadMissions();
      if (selected) void loadSteps(selected.id);
    }, 5000);
    return () => clearInterval(timer);
  }, [missions, selected]);

  useEffect(() => {
    if (selected) void loadSteps(selected.id);
  }, [selected?.id]);

  const approveMission = async (missionId: number) => {
    try {
      await authJson(`/api/missions/${missionId}/approve`, { method: 'POST' });
      await loadMissions();
      if (selected?.id === missionId) await loadSteps(missionId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '审批失败');
    }
  };

  const rejectMission = async (missionId: number) => {
    const reason = window.prompt('拒绝原因（可选）：') || '管理员拒绝';
    try {
      await authJson(`/api/missions/${missionId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await loadMissions();
      if (selected?.id === missionId) await loadSteps(missionId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '拒绝失败');
    }
  };

  const cancelMission = async (missionId: number) => {
    if (!window.confirm('确认取消任务？agent 会立即停止。')) return;
    try {
      await authJson(`/api/missions/${missionId}/cancel`, { method: 'POST' });
      await loadMissions();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '取消失败');
    }
  };

  const quickStart = async (type: string) => {
    try {
      await authJson('/api/missions/quick-start', {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      await loadMissions();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '一键启动失败');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="w-6 h-6 text-emerald-600" />
            <h1 className="text-2xl font-semibold text-gray-900">AI 数字员工</h1>
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded">v3.0 MVP</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            下达目标，AI 自己拆解、调用工具、拉数据、出结果。高风险操作会在你审批后才执行。
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium"
        >
          <Sparkles className="w-4 h-4" />
          自定义任务
        </button>
      </div>

      {/* 一键启动预置任务（v3.1 新增）*/}
      <div className="p-4 bg-gradient-to-br from-emerald-50 to-blue-50 border border-emerald-200 rounded-xl">
        <div className="text-xs text-gray-600 uppercase tracking-wide mb-2">一键交给 AI（推荐）</div>
        <div className="grid grid-cols-3 gap-2">
          {templates.map((t) => (
            <button
              key={t.type}
              onClick={() => void quickStart(t.type)}
              className="p-3 bg-white rounded-lg hover:shadow-md text-left transition-all border border-white hover:border-emerald-300"
            >
              <div className="flex items-center gap-1.5 font-medium text-sm text-gray-900">
                <PlayCircle className="w-4 h-4 text-emerald-600" />
                {t.title}
              </div>
              <div className="text-xs text-gray-500 mt-1 line-clamp-2">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 定时计划（方案 B · v3.2）*/}
      <ScheduleSection />


      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">历史任务（{missions.length}）</h3>
            <button
              onClick={() => void loadMissions()}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              刷新
            </button>
          </div>

          {missions.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 bg-gray-50 rounded-lg">
              还没有任务。点右上角「新建任务」开始。
            </div>
          ) : (
            missions.map((m) => {
              const Icon = STATUS_ICONS[m.status];
              return (
                <button
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className={cn(
                    'w-full text-left p-3 border rounded-lg transition-all',
                    selected?.id === m.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm text-gray-900">{m.title}</div>
                    <span className={cn('px-2 py-0.5 text-xs rounded flex items-center gap-1', STATUS_COLORS[m.status])}>
                      <Icon className={cn('w-3 h-3', m.status === 'running' && 'animate-spin')} />
                      {STATUS_LABELS[m.status]}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                    <span>#{m.id}</span>
                    <span>·</span>
                    <span>{m.type}</span>
                    <span>·</span>
                    <span>{m.stepCount} 步</span>
                    {m.approvalCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-orange-600">{m.approvalCount} 次审批</span>
                      </>
                    )}
                  </div>
                  {m.lastError && (
                    <div className="mt-1 text-xs text-red-600 truncate">错误：{m.lastError}</div>
                  )}
                  {m.summary && (
                    <div className="mt-1 text-xs text-emerald-700 line-clamp-2">{m.summary}</div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="col-span-7 max-h-[80vh] overflow-y-auto">
          {selected ? (
            <MissionDetail
              mission={selected}
              steps={steps}
              loading={loading}
              onApprove={() => void approveMission(selected.id)}
              onReject={() => void rejectMission(selected.id)}
              onCancel={() => void cancelMission(selected.id)}
            />
          ) : (
            <div className="p-8 text-center text-sm text-gray-400 bg-white border border-gray-200 rounded-lg">
              <Eye className="w-6 h-6 mx-auto mb-2 opacity-50" />
              从左侧选择任务查看详情
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateMissionModal
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await loadMissions();
          }}
        />
      )}
    </div>
  );
}

function MissionDetail({
  mission,
  steps,
  loading,
  onApprove,
  onReject,
  onCancel,
}: {
  mission: Mission;
  steps: MissionStep[];
  loading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const pendingStep = useMemo(
    () => steps.filter((s) => s.role === 'tool_call' && s.needsApproval && !s.approvedAt && !s.rejectedReason).pop(),
    [steps]
  );

  return (
    <div className="space-y-4">
      <div className="p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-900">{mission.title}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              #{mission.id} · {mission.type} · tenant={mission.tenant}
            </div>
          </div>
          {['queued', 'running', 'waiting_approval'].includes(mission.status) && (
            <button
              onClick={onCancel}
              className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
            >
              取消任务
            </button>
          )}
        </div>

        <div className="mt-3 text-xs text-gray-600">
          <div className="font-medium mb-1">目标：</div>
          <pre className="bg-gray-50 p-2 rounded text-[11px] overflow-x-auto">
            {JSON.stringify(mission.goal, null, 2)}
          </pre>
        </div>

        {mission.summary && (
          <div className="mt-3 p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">
            ✓ {mission.summary}
          </div>
        )}

        {mission.lastError && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
            × {mission.lastError}
          </div>
        )}
      </div>

      {mission.status === 'waiting_approval' && pendingStep && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-3">
          <div className="flex items-center gap-2 font-semibold text-amber-900">
            <Hand className="w-5 h-5" />
            需要你审批：{pendingStep.toolName}
          </div>
          <div>
            <div className="text-xs text-amber-700 uppercase font-medium mb-1">操作参数</div>
            <pre className="text-xs bg-white p-2 rounded border border-amber-200 max-h-48 overflow-auto">
              {JSON.stringify(pendingStep.toolArgs, null, 2)}
            </pre>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onApprove}
              className="flex-1 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700"
            >
              ✓ 批准并继续
            </button>
            <button
              onClick={onReject}
              className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
            >
              ✗ 拒绝并取消任务
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">执行轨迹（{steps.length} 步）</h3>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        </div>
        {steps.length === 0 ? (
          <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded">
            agent 还没执行任何步骤
          </div>
        ) : (
          <div className="space-y-1.5">
            {steps.map((step) => (
              <StepCard key={step.id} step={step} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: MissionStep }) {
  const [expanded, setExpanded] = useState(false);

  const roleStyle: Record<MissionStep['role'], string> = {
    system: 'bg-gray-100 text-gray-700',
    assistant: 'bg-blue-50 border-blue-200 text-blue-800',
    tool_call: 'bg-amber-50 border-amber-200 text-amber-800',
    tool_result: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    approval: 'bg-orange-50 border-orange-200 text-orange-800',
  };

  const roleIcon = {
    system: '⚙️',
    assistant: '💭',
    tool_call: '🔧',
    tool_result: '📎',
    approval: '✋',
  };

  return (
    <div className={cn('border rounded p-2.5 text-xs', roleStyle[step.role] ?? 'bg-gray-50 border-gray-200')}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{roleIcon[step.role] ?? '·'}</span>
          <span className="font-mono text-[10px] text-gray-500">#{step.stepIndex}</span>
          <span className="font-medium">{step.role}</span>
          {step.toolName && <span className="font-mono text-[10px] bg-white px-1 rounded">{step.toolName}</span>}
          {step.needsApproval && !step.approvedAt && !step.rejectedReason && (
            <span className="text-[10px] bg-orange-200 text-orange-900 px-1 rounded">⏸ 等待审批</span>
          )}
          {step.approvedAt && step.approvedBy === -1 && (
            <span className="text-[10px] bg-blue-200 text-blue-900 px-1 rounded">🤖 自动批准</span>
          )}
          {step.approvedAt && step.approvedBy !== -1 && step.approvedBy !== null && (
            <span className="text-[10px] bg-emerald-200 text-emerald-900 px-1 rounded">✓ 已批准</span>
          )}
          {step.rejectedReason && (
            <span className="text-[10px] bg-red-200 text-red-900 px-1 rounded">✗ 已拒绝</span>
          )}
        </div>
        <ChevronRight className={cn('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-[11px]">
          {step.content && (
            <div className="whitespace-pre-wrap bg-white p-2 rounded border border-white/30">{step.content}</div>
          )}
          {step.toolArgs && (
            <div>
              <div className="uppercase text-[10px] opacity-70 mb-0.5">args</div>
              <pre className="bg-white p-2 rounded overflow-auto max-h-40">
                {JSON.stringify(step.toolArgs, null, 2)}
              </pre>
            </div>
          )}
          {step.toolResult !== null && step.toolResult !== undefined && (
            <div>
              <div className="uppercase text-[10px] opacity-70 mb-0.5">result</div>
              <pre className="bg-white p-2 rounded overflow-auto max-h-60">
                {JSON.stringify(step.toolResult, null, 2)}
              </pre>
            </div>
          )}
          {step.rejectedReason && (
            <div className="text-red-700">拒绝原因：{step.rejectedReason}</div>
          )}
          <div className="text-[10px] opacity-60">{step.createdAt}</div>
        </div>
      )}
    </div>
  );
}

function CreateMissionModal({
  templates,
  onClose,
  onCreated,
}: {
  templates: MissionTemplate[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [selectedType, setSelectedType] = useState(templates[0]?.type ?? '');
  const [title, setTitle] = useState('');
  const [goalText, setGoalText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const template = templates.find((t) => t.type === selectedType);

  useEffect(() => {
    if (template) {
      setTitle(template.title);
      setGoalText(JSON.stringify(template.defaultGoal, null, 2));
    }
  }, [template?.type]);

  const submit = async () => {
    setSubmitting(true);
    setErrorMsg('');
    try {
      let parsedGoal: Record<string, unknown> | undefined;
      if (goalText.trim()) {
        try {
          parsedGoal = JSON.parse(goalText);
        } catch {
          throw new Error('目标 JSON 格式不正确');
        }
      }

      await authJson('/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          type: selectedType,
          title: title.trim() || undefined,
          goal: parsedGoal,
        }),
      });

      await onCreated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl rounded-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 font-semibold text-lg">
          <Sparkles className="w-5 h-5 text-emerald-600" />
          新建 AI 任务
        </div>

        <div>
          <label className="block text-sm text-gray-700 mb-2">选择任务类型</label>
          <div className="space-y-2">
            {templates.map((t) => (
              <button
                key={t.type}
                onClick={() => setSelectedType(t.type)}
                className={cn(
                  'w-full text-left p-3 border-2 rounded-lg',
                  selectedType === t.type
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{t.title}</div>
                  <code className="text-xs text-gray-500">{t.type}</code>
                </div>
                <div className="text-xs text-gray-600 mt-1">{t.description}</div>
              </button>
            ))}
          </div>
        </div>

        {template && (
          <>
            <div>
              <label className="block text-sm text-gray-700 mb-1">任务标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                placeholder={template.title}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-1">目标参数（JSON）</label>
              <div className="text-xs text-gray-500 mb-1">{template.goalHint}</div>
              <textarea
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded font-mono text-xs"
              />
            </div>
          </>
        )}

        {errorMsg && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{errorMsg}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded">
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !selectedType}
            className="px-4 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            启动 AI
          </button>
        </div>
      </div>
    </div>
  );
}

type ScheduleConfig = {
  id: number;
  tenant: string;
  missionType: string;
  cronHour: number;
  cronWeekday: string | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
};

const WEEKDAY_LABELS: Record<string, string> = {
  sun: '周日', mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六',
};

const MISSION_TYPE_LABELS: Record<string, string> = {
  daily_content_sprint: '每日内容冲刺',
  lead_followup_sweep: '线索跟进扫描',
  weekly_report: '周度经营报表',
};

function ScheduleSection() {
  const [schedules, setSchedules] = useState<ScheduleConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await authJson<ScheduleConfig[]>('/api/missions/schedules/list');
      setSchedules(data);
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

  const update = async (id: number, patch: { enabled?: boolean; cronHour?: number; cronWeekday?: string | null }) => {
    try {
      await authJson(`/api/missions/schedules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新失败');
    }
  };

  const enabledCount = schedules.filter((s) => s.enabled).length;

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-emerald-600" />
          <div className="font-medium text-sm">
            定时自动化 <span className="text-xs text-gray-500 font-normal">
              · {enabledCount} / {schedules.length} 已启用
            </span>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {errorMsg && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{errorMsg}</div>
      )}

      <div className="text-xs text-gray-500 mb-3">
        开启后，Worker 在指定时间自动创建并执行任务。结合「自动审批白名单」（在 server/.env 设置 <code className="bg-gray-100 px-1 rounded">AUTO_APPROVE_CONTENT=true</code> 等）可实现 0 人干预。
      </div>

      <div className="space-y-2">
        {schedules.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-4">
            暂无定时配置（ENABLE_DB_SEED=true 首次启动时会自动注入 3 条默认配置）
          </div>
        ) : schedules.map((s) => (
          <div
            key={s.id}
            className={cn(
              'flex items-center justify-between p-3 border rounded',
              s.enabled ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
            )}
          >
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">
                {MISSION_TYPE_LABELS[s.missionType] ?? s.missionType}
              </div>
              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                <span>
                  {s.cronWeekday ? `每${WEEKDAY_LABELS[s.cronWeekday] ?? s.cronWeekday}` : '每日'}
                  {' '}{String(s.cronHour).padStart(2, '0')}:00
                </span>
                <span className="text-gray-400">·</span>
                <span>上次触发: {s.lastTriggeredAt ?? '从未'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={23}
                value={s.cronHour}
                onChange={(e) => void update(s.id, { cronHour: Number(e.target.value) })}
                className="w-14 px-2 py-1 text-xs border border-gray-300 rounded text-center"
              />
              <span className="text-xs text-gray-500">:00</span>
              <button
                onClick={() => void update(s.id, { enabled: !s.enabled })}
                className={cn(
                  'px-3 py-1 rounded text-xs font-medium transition-all',
                  s.enabled
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                )}
              >
                {s.enabled ? '✓ 已启用' : '启用'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AgentWorkspace;
