/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Rocket,
  Radar,
  FileText,
  Download,
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  Copy,
  RefreshCw,
  KeyRound,
  LogOut,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';

type Platform = 'xiaohongshu' | 'douyin' | 'kuaishou';

type RpaAccount = {
  id: number;
  platform: Platform;
  nickname: string;
  role: 'brand' | 'persona';
  status: 'active' | 'paused' | 'banned' | 'cooldown';
  dailyQuota: number;
  followers: number;
  lastPublishedAt: string | null;
  todayPublished: number;
  riskNote: string | null;
  loggedIn?: boolean;
};

type RpaTask = {
  id: number;
  accountId: number;
  type: 'publish' | 'reply_dm' | 'fetch_dm' | 'fetch_comments';
  payload: Record<string, unknown> & { title?: string };
  scheduledAt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type RpaMessage = {
  id: number;
  accountId: number;
  senderNickname: string;
  content: string;
  msgType: 'dm' | 'comment';
  fetchedAt: string;
  processedStatus: 'pending' | 'auto_replied' | 'lead_created' | 'ignored';
  leadId: number | null;
};

type LeadForm = {
  id: number;
  type: string;
  name: string;
  fields: Array<{ key: string; label: string; options: string[] }>;
  isActive: boolean;
};

type CrawlerItem = {
  id: number;
  sourceId: number;
  title: string;
  url: string;
  summary: string | null;
  crawledAt: string;
  fedToFactoryAt: string | null;
};

const PLATFORM_LABELS: Record<Platform, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  kuaishou: '快手',
};

const PLATFORM_COLORS: Record<Platform, string> = {
  xiaohongshu: 'bg-red-50 text-red-700 border-red-200',
  douyin: 'bg-gray-900 text-white border-gray-900',
  kuaishou: 'bg-orange-50 text-orange-700 border-orange-200',
};

const STATUS_LABELS: Record<RpaAccount['status'], string> = {
  active: '运行中',
  paused: '已暂停',
  banned: '已封禁',
  cooldown: '冷却中',
};

const STATUS_COLORS: Record<RpaAccount['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-gray-100 text-gray-700',
  banned: 'bg-red-100 text-red-700',
  cooldown: 'bg-amber-100 text-amber-700',
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.data as T;
}

type TabKey = 'matrix' | 'radar' | 'forms' | 'crawler';

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'matrix', label: '发布矩阵', icon: Rocket },
  { key: 'radar', label: '私信雷达', icon: Radar },
  { key: 'forms', label: '留资入口', icon: FileText },
  { key: 'crawler', label: '素材采集', icon: Download },
];

function AcquisitionEngine() {
  const [activeTab, setActiveTab] = useState<TabKey>('matrix');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">AI 获客引擎</h1>
          <p className="text-sm text-gray-500 mt-1">
            发布矩阵 · 私信雷达 · 合规留资 · 素材采集 ——
            全流程主动获客与合规护城河
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'matrix' && <PublishMatrix />}
      {activeTab === 'radar' && <PrivateMessageRadar />}
      {activeTab === 'forms' && <LeadFormsTab />}
      {activeTab === 'crawler' && <CrawlerTab />}
    </div>
  );
}

function PublishMatrix() {
  const [accounts, setAccounts] = useState<RpaAccount[]>([]);
  const [tasks, setTasks] = useState<RpaTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loginTarget, setLoginTarget] = useState<RpaAccount | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [acc, tsk] = await Promise.all([
        fetchJson<RpaAccount[]>('/api/rpa/accounts'),
        fetchJson<RpaTask[]>('/api/rpa/tasks'),
      ]);

      const withLoginStatus = await Promise.all(
        acc.map(async (a) => {
          try {
            const status = await fetchJson<{ loggedIn: boolean }>(`/api/rpa/accounts/${a.id}/login-status`);
            return { ...a, loggedIn: status.loggedIn };
          } catch {
            return { ...a, loggedIn: false };
          }
        })
      );

      setAccounts(withLoginStatus);
      setTasks(tsk);
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const togglePause = async (account: RpaAccount) => {
    const nextStatus = account.status === 'active' ? 'paused' : 'active';
    try {
      await fetchJson(`/api/rpa/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新失败');
    }
  };

  const logout = async (account: RpaAccount) => {
    try {
      await fetchJson(`/api/rpa/accounts/${account.id}/cookies`, { method: 'DELETE' });
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '登出失败');
    }
  };

  const grouped = useMemo(() => {
    const result: Record<Platform, RpaAccount[]> = { xiaohongshu: [], douyin: [], kuaishou: [] };
    for (const account of accounts) {
      result[account.platform]?.push(account);
    }
    return result;
  }, [accounts]);

  const recentTasks = tasks.slice(0, 20);
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="账号总数" value={accounts.length} />
        <StatCard label="今日已发布" value={accounts.reduce((sum, a) => sum + a.todayPublished, 0)} />
        <StatCard label="排队中任务" value={queuedCount} accent="text-blue-600" />
        <StatCard label="失败任务" value={failedCount} accent="text-red-600" />
      </div>

      <div className="space-y-4">
        {(['xiaohongshu', 'douyin', 'kuaishou'] as Platform[]).map((platform) => (
          <div key={platform} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={cn('px-2 py-1 text-xs rounded border', PLATFORM_COLORS[platform])}>
                {PLATFORM_LABELS[platform]}
              </span>
              <span className="text-sm text-gray-500">
                {grouped[platform].length} 个账号
                {platform !== 'xiaohongshu' && ' · Sprint 2/3 启用'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {grouped[platform].map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  onToggle={() => togglePause(account)}
                  onLogin={() => setLoginTarget(account)}
                  onLogout={() => void logout(account)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {loginTarget && (
        <LoginModal
          account={loginTarget}
          onClose={() => setLoginTarget(null)}
          onSaved={() => {
            setLoginTarget(null);
            void loadData();
          }}
        />
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">最近任务</h3>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            刷新
          </button>
        </div>
        {recentTasks.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
            暂无任务。在「内容工厂」审核通过的内容将自动排入发布队列。
          </div>
        ) : (
          <div className="overflow-hidden border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">任务 ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">账号</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">标题</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">计划时间</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentTasks.map((task) => {
                  const account = accounts.find((a) => a.id === task.accountId);
                  return (
                    <tr key={task.id}>
                      <td className="px-4 py-2 text-sm text-gray-600">#{task.id}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {account ? `${PLATFORM_LABELS[account.platform]} / ${account.nickname}` : `#${task.accountId}`}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">{task.type}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 max-w-xs truncate">
                        {task.payload?.title || '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">{task.scheduledAt}</td>
                      <td className="px-4 py-2 text-sm">
                        <TaskStatusBadge status={task.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={cn('text-2xl font-semibold mt-1', accent || 'text-gray-900')}>{value}</div>
    </div>
  );
}

function AccountCard({
  account,
  onToggle,
  onLogin,
  onLogout,
}: {
  account: RpaAccount;
  onToggle: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const quotaPct = account.dailyQuota === 0 ? 0 : (account.todayPublished / account.dailyQuota) * 100;

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-1.5">
            {account.nickname}
            {account.loggedIn ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                已登录
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-1">
                未登录
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {account.role === 'brand' ? '品牌号' : '人设号'} · 粉丝 {account.followers}
          </div>
        </div>
        <span className={cn('px-2 py-0.5 text-xs rounded', STATUS_COLORS[account.status])}>
          {STATUS_LABELS[account.status]}
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>今日配额</span>
          <span>{account.todayPublished} / {account.dailyQuota}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              quotaPct >= 100 ? 'bg-red-500' : quotaPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
            )}
            style={{ width: `${Math.min(quotaPct, 100)}%` }}
          />
        </div>
      </div>

      {account.riskNote && (
        <div className="text-xs text-gray-500 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
          {account.riskNote}
        </div>
      )}

      <div className="flex gap-2">
        {account.loggedIn ? (
          <button
            onClick={onLogout}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50"
          >
            <LogOut className="w-3 h-3" />
            登出
          </button>
        ) : (
          <button
            onClick={onLogin}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50"
          >
            <KeyRound className="w-3 h-3" />
            登录
          </button>
        )}
        <button
          onClick={onToggle}
          disabled={account.status === 'banned'}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {account.status === 'active' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {account.status === 'active' ? '暂停' : '启动'}
        </button>
      </div>
    </div>
  );
}

function LoginModal({
  account,
  onClose,
  onSaved,
}: {
  account: RpaAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'cli' | 'paste'>('cli');
  const [cookiesText, setCookiesText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const cliCommand = `npm run worker:login -- ${account.id}`;

  const submit = async () => {
    setErrorMsg('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cookiesText);
    } catch {
      setErrorMsg('cookies 必须为合法 JSON 数组');
      return;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setErrorMsg('cookies 必须为非空数组');
      return;
    }

    setSubmitting(true);
    try {
      await fetchJson(`/api/rpa/accounts/${account.id}/cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: parsed }),
      });
      onSaved();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl rounded-xl overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="font-semibold">登录账号：{account.nickname}</div>
            <div className="text-xs text-gray-500 mt-0.5">{PLATFORM_LABELS[account.platform]}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('cli')}
            className={cn(
              'flex-1 py-2.5 text-sm border-b-2',
              activeTab === 'cli' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-500'
            )}
          >
            方式一：CLI 扫码（推荐）
          </button>
          <button
            onClick={() => setActiveTab('paste')}
            className={cn(
              'flex-1 py-2.5 text-sm border-b-2',
              activeTab === 'paste' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-500'
            )}
          >
            方式二：粘贴 cookies
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {activeTab === 'cli' && (
            <div className="space-y-3 text-sm">
              <div className="text-gray-700">
                在有图形界面的机器（你的 Mac / Windows 电脑）上执行下列命令，会弹出浏览器让你扫码。登录成功后，
                cookies 会自动加密写入数据库。
              </div>
              <div className="p-3 bg-gray-900 text-emerald-300 rounded font-mono text-xs flex items-center justify-between">
                <code>{cliCommand}</code>
                <button
                  onClick={() => void navigator.clipboard.writeText(cliCommand)}
                  className="text-gray-400 hover:text-white ml-2"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-xs text-gray-500 space-y-1">
                <div>前置条件：</div>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>目标机器已 <code className="bg-gray-100 px-1 rounded">npm install</code></li>
                  <li>目标机器已 <code className="bg-gray-100 px-1 rounded">npx playwright install chromium</code></li>
                  <li>目标机器 <code className="bg-gray-100 px-1 rounded">server/.env</code> 中配置了 <code className="bg-gray-100 px-1 rounded">RPA_COOKIES_SECRET</code>（至少 16 位随机字符）</li>
                  <li>目标机器的 SQLite 数据库与线上同步（或直接在服务器登录）</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'paste' && (
            <div className="space-y-3 text-sm">
              <div className="text-gray-700">
                如果你已在浏览器登录了目标平台，可使用浏览器扩展（如 EditThisCookie）导出 cookies JSON，
                粘贴到下方。服务器会自动加密存储。
              </div>
              <textarea
                value={cookiesText}
                onChange={(e) => setCookiesText(e.target.value)}
                placeholder='[{"name": "...", "value": "...", "domain": ".xiaohongshu.com", ...}]'
                className="w-full h-52 p-3 border border-gray-300 rounded font-mono text-xs"
              />
              {errorMsg && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  {errorMsg}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={submitting || !cookiesText.trim()}
                  className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? '保存中…' : '保存 cookies'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: RpaTask['status'] }) {
  const map = {
    queued: { label: '排队中', className: 'bg-blue-100 text-blue-700' },
    running: { label: '执行中', className: 'bg-amber-100 text-amber-700' },
    succeeded: { label: '已成功', className: 'bg-emerald-100 text-emerald-700' },
    failed: { label: '失败', className: 'bg-red-100 text-red-700' },
    canceled: { label: '已取消', className: 'bg-gray-100 text-gray-700' },
  };
  const config = map[status];
  return <span className={cn('px-2 py-0.5 text-xs rounded', config.className)}>{config.label}</span>;
}

function PrivateMessageRadar() {
  const [messages, setMessages] = useState<RpaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchJson<RpaMessage[]>('/api/rpa/messages');
        setMessages(data);
        setErrorMsg('');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">加载中…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
        <div className="font-medium mb-1">工作机制</div>
        <div>
          私信雷达每 30 分钟扫描一次甲方/乙方授权的自家账号，抓取新增私信与评论，
          调用 AI 意向分级接口后按分级自动处理（低意向自动回复、中高意向创建线索）。
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
          暂无私信/评论。Worker 抓取到的数据将显示在此处。
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div key={msg.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-900">{msg.senderNickname}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {msg.msgType === 'dm' ? '私信' : '评论'} · {msg.fetchedAt}
                  </div>
                </div>
                <MessageStatusBadge status={msg.processedStatus} />
              </div>
              <div className="mt-2 text-sm text-gray-700">{msg.content}</div>
              {msg.leadId && (
                <div className="mt-2 text-xs text-emerald-600">✓ 已创建线索 #{msg.leadId}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageStatusBadge({ status }: { status: RpaMessage['processedStatus'] }) {
  const map = {
    pending: { label: '待处理', className: 'bg-gray-100 text-gray-700' },
    auto_replied: { label: '已自动回复', className: 'bg-blue-100 text-blue-700' },
    lead_created: { label: '已建联', className: 'bg-emerald-100 text-emerald-700' },
    ignored: { label: '已忽略', className: 'bg-gray-100 text-gray-500' },
  };
  const config = map[status];
  return <span className={cn('px-2 py-0.5 text-xs rounded', config.className)}>{config.label}</span>;
}

function LeadFormsTab() {
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchJson<LeadForm[]>('/api/lead-forms');
        setForms(data);
        setErrorMsg('');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const copyLink = (formId: number) => {
    const url = `${window.location.origin}/assessment?formId=${formId}`;
    void navigator.clipboard.writeText(url);
    setCopied(formId);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">加载中…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
        <div className="font-medium mb-1">合规留资闭环</div>
        <div>
          每条通过留资入口进入的线索，都附带完整的授权链路：协议版本号 + 勾选时间 + IP + UA。
          生成的线索自动入库并推送给招生专员。
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}

      {forms.length === 0 ? (
        <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
          暂无留资表单。
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((form) => (
            <div key={form.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-900">{form.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    类型：{form.type} · {form.fields.length} 题 ·
                    <span className={form.isActive ? 'text-emerald-600' : 'text-gray-400'}>
                      {form.isActive ? ' 已上线' : ' 已下线'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => copyLink(form.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50"
                >
                  {copied === form.id ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      复制留资链接
                    </>
                  )}
                </button>
              </div>
              <div className="mt-3 space-y-1">
                {form.fields.slice(0, 3).map((field) => (
                  <div key={field.key} className="text-xs text-gray-500">
                    · {field.label}（{field.options.length} 选项）
                  </div>
                ))}
                {form.fields.length > 3 && (
                  <div className="text-xs text-gray-400">...共 {form.fields.length} 题</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type CrawlerSource = {
  id: number;
  name: string;
  domain: string;
  type: string;
  frequencyHours: number;
  isEnabled: boolean;
  lastCrawledAt: string | null;
};

function CrawlerTab() {
  const [sources, setSources] = useState<CrawlerSource[]>([]);
  const [items, setItems] = useState<(CrawlerItem & { sourceName?: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [sourceData, itemData] = await Promise.all([
        fetchJson<CrawlerSource[]>('/api/crawler/sources'),
        fetchJson<(CrawlerItem & { sourceName?: string })[]>('/api/crawler/items'),
      ]);
      setSources(sourceData);
      setItems(itemData);
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

  const toggleSource = async (source: CrawlerSource) => {
    try {
      await fetchJson(`/api/crawler/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !source.isEnabled }),
      });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '更新失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <div className="font-medium mb-1">合规采集范围（白名单）</div>
        <ul className="list-disc list-inside space-y-1">
          <li>教育部官网、各省教育考试院的招生政策公告</li>
          <li>合作院校官网的招生简章、专业目录、学费公示</li>
        </ul>
        <div className="mt-2 text-xs">
          严格遵守 robots.txt 与访问频率限制；严禁采集任何学生个人信息。
          采集器在 Worker 内每小时运行一次，按每个源的 `frequency_hours` 节流。
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">采集源（{sources.length}）</h3>
          <button onClick={() => void load()} disabled={loading} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            刷新
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {sources.map((source) => (
            <div key={source.id} className="p-3 bg-white border border-gray-200 rounded flex items-start justify-between">
              <div>
                <div className="text-sm font-medium">{source.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {source.domain} · 每 {source.frequencyHours} 小时 · 上次 {source.lastCrawledAt || '未运行'}
                </div>
              </div>
              <button
                onClick={() => void toggleSource(source)}
                className={cn(
                  'px-2 py-0.5 text-xs rounded',
                  source.isEnabled
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                {source.isEnabled ? '已启用' : '已停用'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">最近采集的条目（{items.length}）</h3>
        {items.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-lg">
            暂无采集到的条目。Worker 启动后会按照采集源周期自动抓取。
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="p-3 bg-white border border-gray-200 rounded">
                <div className="font-medium text-sm">{item.title}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {item.sourceName && <span className="mr-2">[{item.sourceName}]</span>}
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">
                    {item.url}
                  </a>
                  <span className="ml-2">· {item.crawledAt}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AcquisitionEngine;
