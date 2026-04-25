/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, ChevronRight, Loader2, AlertCircle, Compass } from 'lucide-react';
import { authJson } from '../lib/auth';
import { cn } from '../lib/cn';

type SubCheck = { label: string; done: boolean };

type PlaybookTask = {
  day: number;
  id: string;
  title: string;
  description: string;
  whyItMatters: string;
  actionLabel: string;
  actionTab: string;
  isComplete: boolean;
  subChecks: SubCheck[];
};

type Playbook = {
  tenantStartedAt: string;
  tenantAgeDays: number;
  currentDay: number;
  currentTaskId: string | null;
  progressPct: number;
  completedCount: number;
  tasks: PlaybookTask[];
};

function ColdStartPlaybook({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [data, setData] = useState<Playbook | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const result = await authJson<Playbook>('/api/dashboard/cold-start-playbook');
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

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Compass className="w-5 h-5 text-blue-500" />
          7 日冷启动剧本
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          每天专注一件事 · 跑完这 7 天，系统真正属于你
        </p>
      </div>

      {/* 进度条 + 当前焦点 */}
      <div className="bg-gradient-to-br from-blue-50 via-white to-emerald-50 border border-blue-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold">
              当前是 Day {data.currentDay} · 已完成 {data.completedCount} / 7
            </div>
            <div className="text-sm text-gray-600 mt-0.5">
              入驻 {data.tenantAgeDays} 天 · 起步日 {data.tenantStartedAt.slice(0, 10)}
            </div>
          </div>
          <div className="text-3xl font-bold text-blue-600">{data.progressPct}%</div>
        </div>
        <div className="h-2 bg-white rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-400 to-emerald-500 rounded-full transition-all"
            style={{ width: `${data.progressPct}%` }}
          />
        </div>

        {data.currentTaskId && (
          <div className="mt-3 text-xs text-gray-700">
            <span className="font-semibold">下一步焦点：</span>
            {data.tasks.find((t) => t.id === data.currentTaskId)?.title ?? ''}
          </div>
        )}
      </div>

      {/* 7 个任务卡片 */}
      <div className="space-y-3">
        {data.tasks.map((task) => {
          const isCurrent = task.id === data.currentTaskId;
          return (
            <div
              key={task.id}
              className={cn(
                'border rounded-xl p-4 transition-all',
                task.isComplete
                  ? 'bg-emerald-50/50 border-emerald-200'
                  : isCurrent
                    ? 'bg-white border-blue-300 shadow-sm ring-2 ring-blue-100'
                    : 'bg-white border-gray-200',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={cn(
                    'shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm',
                    task.isComplete ? 'bg-emerald-500 text-white' :
                    isCurrent ? 'bg-blue-500 text-white' :
                    'bg-gray-100 text-gray-500'
                  )}>
                    {task.isComplete ? <CheckCircle2 className="w-5 h-5" /> : <span>D{task.day}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-gray-900 text-sm">{task.title}</div>
                      {isCurrent && !task.isComplete && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded font-medium">当前</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">{task.description}</div>
                    <div className="text-xs text-gray-500 mt-2 italic flex items-start gap-1">
                      <span className="text-amber-500">💡</span>
                      <span>{task.whyItMatters}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* sub-checks */}
              {task.subChecks.length > 0 && (
                <div className="mt-3 ml-13 pl-13 space-y-1">
                  {task.subChecks.map((sc, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      {sc.done ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-gray-300 shrink-0" />
                      )}
                      <span className={cn(sc.done ? 'text-gray-500 line-through' : 'text-gray-700')}>{sc.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {!task.isComplete && (
                <button
                  onClick={() => onNavigate?.(task.actionTab)}
                  className={cn(
                    'mt-3 w-full flex items-center justify-between px-3 py-2 rounded text-sm transition-colors',
                    isCurrent
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                  )}
                >
                  <span className="font-medium">{task.actionLabel}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="text-[10px] text-gray-400 italic">
        Day 7 之后剧本完成。后续运维参考 [Operator-Runbook] / [Zero-Touch-Operations]。
      </div>
    </div>
  );
}

export default ColdStartPlaybook;
