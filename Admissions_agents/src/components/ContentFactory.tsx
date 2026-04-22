/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Edit3,
  CheckCircle,
  Smartphone,
  Video,
  Image as ImageIcon,
  Plus,
  Calendar,
  Eye,
  ThumbsUp,
  MessageCircle,
  Clock,
  AlertCircle,
  Check,
  XCircle,
  ClipboardList,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateContent as aiGenerateContent } from '../gemini-services';
import { cn } from '../lib/cn';
import type { ContentItem, ContentType, GeneratedContent, ReviewItem, ReviewStatus } from '../types';

const MAIN_TABS: { id: 'generate' | 'review' | 'calendar' | 'records'; label: string }[] = [
  { id: 'generate', label: '内容生成' },
  { id: 'review', label: '待审核' },
  { id: 'calendar', label: '内容日历' },
  { id: 'records', label: '发布记录' },
];

const CONTENT_TYPES: { id: ContentType; label: string }[] = [
  { id: 'policy', label: '政策解读' },
  { id: 'major', label: '专业推荐' },
  { id: 'case', label: '学员案例' },
  { id: 'reminder', label: '报名提醒' },
  { id: 'qa', label: '答疑科普' },
];

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  policy: '政策解读',
  major: '专业推荐',
  case: '学员案例',
  reminder: '报名提醒',
  qa: '答疑科普',
};

const PLATFORMS = [
  { id: 'xhs', label: '小红书', icon: Smartphone, color: 'text-red-500' },
  { id: 'dy', label: '抖音', icon: Video, color: 'text-gray-900' },
  { id: 'ks', label: '快手', icon: Video, color: 'text-orange-500' },
] as const;

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

function ContentFactory() {
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [contentType, setContentType] = useState<ContentType>('policy');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['xhs', 'dy']);
  const [requirements, setRequirements] = useState('');
  const [generatedContent, setGeneratedContent] = useState<Record<string, GeneratedContent>>({});
  const [activePreviewTab, setActivePreviewTab] = useState('xhs');
  const [activeMainTab, setActiveMainTab] = useState<'generate' | 'review' | 'calendar' | 'records'>('generate');
  const [recordsFilter, setRecordsFilter] = useState('all');
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [publishedRecords, setPublishedRecords] = useState<ContentItem[]>([]);
  const [reviewFilter, setReviewFilter] = useState<'all' | ReviewStatus>('all');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, []);

  const showError = (message: string) => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
    }
    setErrorMsg(message);
    errorTimerRef.current = setTimeout(() => setErrorMsg(''), 4000);
  };

  const loadReviewItems = async () => {
    setReviewLoading(true);
    try {
      const data = await fetchJson<ReviewItem[]>('/api/content/reviews?limit=100');
      setReviewItems(data);
    } catch {
      showError('审核队列加载失败，请确认后端服务已启动');
      setReviewItems([]);
    } finally {
      setReviewLoading(false);
    }
  };

  const loadPublishedRecords = async () => {
    setRecordsLoading(true);
    try {
      const data = await fetchJson<ContentItem[]>('/api/content/records?limit=100');
      setPublishedRecords(data);
    } catch {
      showError('发布记录加载失败，请确认后端服务已启动');
      setPublishedRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadReviewItems(), loadPublishedRecords()]);
  }, []);

  const handleApprove = async (id: string) => {
    try {
      const updated = await fetchJson<ReviewItem>(`/api/content/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      setReviewItems((current) => current.map((item) => item.id === id ? updated : item));
    } catch {
      showError('通过审核失败，请稍后重试');
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) {
      return;
    }

    try {
      const updated = await fetchJson<ReviewItem>(`/api/content/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', rejectReason: rejectReason.trim() }),
      });
      setReviewItems((current) => current.map((item) => item.id === id ? updated : item));
      setRejectingId(null);
      setRejectReason('');
    } catch {
      showError('驳回失败，请稍后重试');
    }
  };

  const handleSubmitForReview = async () => {
    const contentTypeLabel = CONTENT_TYPES.find((item) => item.id === contentType)?.label || '';
    const firstPlatform = selectedPlatforms[0];
    const title = (firstPlatform && generatedContent[firstPlatform]?.title) || '新生成内容';

    try {
      const created = await fetchJson<ReviewItem>('/api/content/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          type: contentType,
          platforms: selectedPlatforms,
        }),
      });
      setReviewItems((current) => [created, ...current]);
      setActiveMainTab('review');
    } catch {
      showError('提交审核失败，请稍后重试');
    }
  };

  const handleGenerate = async () => {
    if (selectedPlatforms.length === 0) {
      showError('请至少选择一个发布平台');
      return;
    }

    setLoading(true);
    try {
      const contentTypeLabel = CONTENT_TYPES.find((item) => item.id === contentType)?.label || '';
      const result = await aiGenerateContent(contentTypeLabel, selectedPlatforms, requirements);
      setGeneratedContent(result);
      if (selectedPlatforms.length > 0) {
        setActivePreviewTab(selectedPlatforms[0]);
      }
    } catch {
      showError('AI 生成失败，请检查网络或 API 配置后重试');
    } finally {
      setLoading(false);
    }
  };

  const filteredReviewItems = useMemo(
    () => reviewItems.filter((item) => reviewFilter === 'all' || item.status === reviewFilter),
    [reviewFilter, reviewItems],
  );

  const filteredRecords = useMemo(
    () => publishedRecords.filter((record) => recordsFilter === 'all' || record.platforms.includes(recordsFilter)),
    [publishedRecords, recordsFilter],
  );

  const calendarItemsByDay = useMemo(() => {
    const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    return publishedRecords.reduce<Record<string, ContentItem[]>>((acc, record) => {
      const parsedDate = Date.parse(record.createdAt);
      if (Number.isNaN(parsedDate)) {
        return acc;
      }

      const dayIndex = (new Date(parsedDate).getDay() + 6) % 7;
      const dayLabel = dayLabels[dayIndex];
      return {
        ...acc,
        [dayLabel]: [...(acc[dayLabel] ?? []), record],
      };
    }, {});
  }, [publishedRecords]);

  const unscheduledRecords = useMemo(
    () => publishedRecords.filter((record) => Number.isNaN(Date.parse(record.createdAt))),
    [publishedRecords],
  );

  return (
    <div className="h-full flex flex-col gap-6">
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl shadow-lg"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">{errorMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex bg-white border border-gray-200 p-1 rounded-xl shadow-sm w-fit">
        {MAIN_TABS.map((tab) => {
          const pendingCount = tab.id === 'review' ? reviewItems.filter((item) => item.status === 'pending').length : 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveMainTab(tab.id)}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5',
                activeMainTab === tab.id ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600',
              )}
            >
              {tab.label}
              {pendingCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold leading-none">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeMainTab === 'generate' && (
          <motion.div
            key="generate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0"
          >
            <div className="w-full lg:w-[400px] bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col overflow-y-auto">
              <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <Sparkles className="w-5 h-5 text-emerald-600" />
                </div>
                <h2 className="font-bold text-gray-900">AI 生成控制面板</h2>
              </div>

              <div className="space-y-6 flex-1">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">内容类型</label>
                  <div className="grid grid-cols-2 gap-2">
                    {CONTENT_TYPES.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setContentType(item.id)}
                        className={cn(
                          'px-3 py-2 rounded-xl text-sm font-medium border transition-all',
                          contentType === item.id ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-100 text-gray-600 hover:border-gray-200',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">目标平台</label>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map((platform) => (
                      <button
                        key={platform.id}
                        onClick={() => {
                          setSelectedPlatforms((current) => current.includes(platform.id)
                            ? current.filter((id) => id !== platform.id)
                            : [...current, platform.id]);
                        }}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-all',
                          selectedPlatforms.includes(platform.id)
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-white border-gray-100 text-gray-600 hover:border-gray-200',
                        )}
                      >
                        <platform.icon className={cn('w-4 h-4', selectedPlatforms.includes(platform.id) ? 'text-emerald-600' : platform.color)} />
                        {platform.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">补充要求 (可选)</label>
                  <textarea
                    value={requirements}
                    onChange={(event) => setRequirements(event.target.value)}
                    placeholder="例如：针对在职人员，强调周末上课，名额有限..."
                    className="w-full h-32 p-4 bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-2xl text-sm transition-all resize-none"
                  />
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || selectedPlatforms.length === 0}
                className={cn(
                  'w-full mt-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20',
                  loading || selectedPlatforms.length === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98]',
                )}
              >
                {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {loading ? 'AI 正在思考中...' : '开始 AI 生成内容'}
              </button>
            </div>

            <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h2 className="font-bold text-gray-900">生成结果预览</h2>
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    {selectedPlatforms.map((platformId) => (
                      <button
                        key={platformId}
                        onClick={() => setActivePreviewTab(platformId)}
                        className={cn(
                          'px-4 py-1.5 rounded-lg text-xs font-bold transition-all',
                          activePreviewTab === platformId ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600',
                        )}
                      >
                        {PLATFORMS.find((platform) => platform.id === platformId)?.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                    <Edit3 className="w-5 h-5" />
                  </button>
                  <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col items-center justify-center space-y-4">
                      <div className="w-12 h-12 border-4 border-emerald-100 border-t-emerald-500 rounded-full animate-spin" />
                      <p className="text-sm text-gray-500 font-medium">正在为您创作精彩内容...</p>
                    </motion.div>
                  ) : generatedContent[activePreviewTab] ? (
                    <motion.div key="content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-8">
                      <div className="space-y-2">
                        <h3 className="text-2xl font-bold text-gray-900">{generatedContent[activePreviewTab].title}</h3>
                        <div className="h-1 w-20 bg-emerald-500 rounded-full" />
                      </div>

                      <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {generatedContent[activePreviewTab].content}
                      </div>

                      <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-3">
                        <div className="flex items-center gap-2 text-emerald-700">
                          <ImageIcon className="w-4 h-4" />
                          <span className="text-xs font-bold uppercase tracking-wider">建议配图描述</span>
                        </div>
                        <p className="text-sm text-emerald-800 italic">{generatedContent[activePreviewTab].image_desc}</p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center text-gray-300">
                      <Sparkles className="w-16 h-16 mb-4 opacity-10" />
                      <p className="text-sm font-medium">在左侧输入要求，点击生成按钮开始创作</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {generatedContent[activePreviewTab] && (
                <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-3">
                  <button className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition-all">编辑修改</button>
                  <button className="px-6 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2" onClick={() => void handleSubmitForReview()}>
                    <CheckCircle className="w-4 h-4" />
                    提交审核
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeMainTab === 'review' && (
          <motion.div key="review" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '待审核', count: reviewItems.filter((item) => item.status === 'pending').length, color: 'text-amber-600 bg-amber-50 border-amber-100' },
                { label: '已通过', count: reviewItems.filter((item) => item.status === 'approved').length, color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
                { label: '已驳回', count: reviewItems.filter((item) => item.status === 'rejected').length, color: 'text-red-600 bg-red-50 border-red-100' },
              ].map((stat) => (
                <div key={stat.label} className={cn('p-4 rounded-2xl border flex items-center gap-3', stat.color)}>
                  <ClipboardList className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium opacity-70">{stat.label}</p>
                    <p className="text-2xl font-bold">{stat.count}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {([['all', '全部'], ['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setReviewFilter(value)}
                  className={cn(
                    'px-4 py-1.5 rounded-xl text-xs font-bold border transition-all',
                    reviewFilter === value ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-50">
                {reviewLoading ? (
                  <div className="py-16 text-center text-gray-400">加载审核队列中...</div>
                ) : filteredReviewItems.length === 0 ? (
                  <div className="py-16 text-center text-gray-400">
                    <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">暂无{reviewFilter !== 'all' ? { pending: '待审核', approved: '已通过', rejected: '已驳回' }[reviewFilter] : ''}内容</p>
                  </div>
                ) : filteredReviewItems.map((item) => {
                  const statusConfig = {
                    pending: { label: '待审核', cls: 'text-amber-600 bg-amber-50 border-amber-100' },
                    approved: { label: '已通过', cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
                    rejected: { label: '已驳回', cls: 'text-red-600 bg-red-50 border-red-100' },
                  }[item.status];

                  return (
                    <div key={item.id} className="p-6 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">{CONTENT_TYPE_LABELS[item.type]}</span>
                            {item.platforms.map((platformId) => (
                              <span key={platformId} className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg">
                                {PLATFORMS.find((platform) => platform.id === platformId)?.label}
                              </span>
                            ))}
                            <span className="text-[10px] text-gray-400">{item.generatedAt}</span>
                          </div>
                          <h4 className="font-bold text-gray-900 text-sm leading-snug">{item.title}</h4>
                          {item.rejectReason && (
                            <p className="mt-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-100">
                              <strong>驳回原因：</strong>{item.rejectReason}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={cn('px-2 py-1 rounded-lg text-[10px] font-bold border', statusConfig.cls)}>{statusConfig.label}</span>
                          {item.status === 'pending' && (
                            <>
                              <button onClick={() => void handleApprove(item.id)} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 text-white text-xs font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-sm shadow-emerald-500/20">
                                <Check className="w-3.5 h-3.5" /> 通过
                              </button>
                              <button onClick={() => { setRejectingId(item.id); setRejectReason(''); }} className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-100 text-xs font-bold rounded-xl hover:bg-red-100 transition-all">
                                <XCircle className="w-3.5 h-3.5" /> 驳回
                              </button>
                            </>
                          )}
                          {item.status === 'rejected' && (
                            <button onClick={() => void handleApprove(item.id)} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-all">
                              <Check className="w-3.5 h-3.5" /> 重新通过
                            </button>
                          )}
                        </div>
                      </div>

                      <AnimatePresence>
                        {rejectingId === item.id && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-end gap-3 pt-2 border-t border-red-50">
                            <div className="flex-1">
                              <label className="block text-xs font-bold text-red-600 mb-1.5">驳回原因（必填）</label>
                              <textarea
                                value={rejectReason}
                                onChange={(event) => setRejectReason(event.target.value)}
                                placeholder="请说明修改意见，AI 将根据此意见重新生成内容..."
                                className="w-full p-3 bg-red-50 border border-red-100 focus:border-red-300 focus:ring-0 rounded-xl text-sm resize-none text-gray-700"
                                rows={2}
                                autoFocus
                              />
                            </div>
                            <div className="flex flex-col gap-2 pb-0.5">
                              <button onClick={() => void handleReject(item.id)} disabled={!rejectReason.trim()} className="px-4 py-2 bg-red-500 text-white text-xs font-bold rounded-xl hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                                确认驳回
                              </button>
                              <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-4 py-2 bg-gray-100 text-gray-500 text-xs font-bold rounded-xl hover:bg-gray-200 transition-all">
                                取消
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {activeMainTab === 'calendar' && (
          <motion.div key="calendar" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-gray-900">本周发布计划</h3>
                <button className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition-all">
                  <Plus className="w-4 h-4" />
                  新增计划
                </button>
              </div>
              {recordsLoading ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center text-gray-500">
                  <Calendar className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p className="text-sm font-medium">加载内容日历中...</p>
                </div>
              ) : publishedRecords.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center text-gray-500">
                  <Calendar className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p className="text-sm font-medium">暂无真实排期数据</p>
                  <p className="mt-2 text-xs text-gray-400">发布记录产生后会自动进入内容日历视图。</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
                    {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day) => (
                      <div key={day} className="space-y-2">
                        <div className="border-b border-gray-100 py-2 text-center text-xs font-bold uppercase text-gray-400">
                          {day}
                        </div>
                        <div className="min-h-[200px] space-y-2">
                          {(calendarItemsByDay[day] ?? []).length === 0 ? (
                            <div className="rounded-xl border-2 border-dashed border-gray-100 p-4 text-center text-xs text-gray-300">
                              暂无排期
                            </div>
                          ) : (calendarItemsByDay[day] ?? []).map((record) => {
                            const primaryPlatform = record.platforms[0] ?? 'xhs';
                            const platform = PLATFORMS.find((item) => item.id === primaryPlatform) ?? PLATFORMS[0];
                            return (
                              <div key={record.id} className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs">
                                <div className={cn('mb-1 flex items-center gap-1 font-bold', platform.color)}>
                                  <platform.icon className="h-3 w-3" />
                                  {platform.label}
                                </div>
                                <p className="truncate text-emerald-700">{record.title}</p>
                                <p className="mt-1 flex items-center gap-1 text-emerald-500"><Clock className="h-3 w-3" /> {record.createdAt}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {unscheduledRecords.length > 0 && (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                      <p className="font-bold mb-2">以下内容缺少可解析的发布时间，暂未进入周历：</p>
                      <ul className="space-y-1 list-disc pl-5">
                        {unscheduledRecords.map((record) => (
                          <li key={record.id}>{record.title}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeMainTab === 'records' && (
          <motion.div key="records" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900">发布记录</h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => setRecordsFilter('all')} className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all', recordsFilter === 'all' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border-gray-100')}>
                    全部
                  </button>
                  {PLATFORMS.map((platform) => (
                    <button
                      key={platform.id}
                      onClick={() => setRecordsFilter(platform.id)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all', recordsFilter === platform.id ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border-gray-100')}
                    >
                      {platform.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {recordsLoading ? (
                  <div className="py-16 text-center text-gray-400">加载发布记录中...</div>
                ) : filteredRecords.length === 0 ? (
                  <div className="py-16 text-center text-gray-400">暂无发布记录</div>
                ) : filteredRecords.map((record) => (
                  <div key={record.id} className="p-6 hover:bg-gray-50 transition-colors group">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {record.platforms.map((platformId) => (
                            <span key={platformId} className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg">
                              {PLATFORMS.find((platform) => platform.id === platformId)?.label}
                            </span>
                          ))}
                          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">{CONTENT_TYPE_LABELS[record.type]}</span>
                          <span className="text-[10px] text-gray-400">{record.createdAt}</span>
                        </div>
                        <h4 className="font-bold text-gray-900 mb-3">{record.title}</h4>
                        <div className="flex items-center gap-6 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {record.stats.views.toLocaleString()}</span>
                          <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" /> {record.stats.likes}</span>
                          <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> {record.stats.comments}</span>
                          <span className="flex items-center gap-1 text-emerald-600 font-bold">线索 +{record.stats.leads}</span>
                        </div>
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

export default ContentFactory;
