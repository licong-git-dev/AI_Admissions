/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Building2,
  ShieldCheck,
  Bot,
  Database,
  ChevronRight,
  Globe,
  Lock,
  Bell,
  GraduationCap,
  Plus,
  Edit3,
  Trash2,
  BookOpen,
  X,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/cn';
import type { School } from '../types';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

function Settings() {
  const [activeTab, setActiveTab] = useState<'general' | 'materials'>('general');
  const [schools, setSchools] = useState<School[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showAddSchool, setShowAddSchool] = useState(false);
  const [rpaEnabled, setRpaEnabled] = useState([true, true, false]);
  const [schoolName, setSchoolName] = useState('');
  const [schoolLevel, setSchoolLevel] = useState('普通本科');
  const [schoolDescription, setSchoolDescription] = useState('');
  const [selectedAdmissionTypes, setSelectedAdmissionTypes] = useState<string[]>(['专升本']);
  const [savingSchool, setSavingSchool] = useState(false);

  useEffect(() => {
    let alive = true;

    const loadSchools = async () => {
      setLoadingSchools(true);
      try {
        const data = await fetchJson<School[]>('/api/schools');
        if (!alive) {
          return;
        }
        setSchools(data);
        setErrorMsg('');
      } catch {
        if (!alive) {
          return;
        }
        setSchools([]);
        setErrorMsg('院校素材库加载失败，请确认后端服务已启动');
      } finally {
        if (alive) {
          setLoadingSchools(false);
        }
      }
    };

    void loadSchools();

    return () => {
      alive = false;
    };
  }, []);

  const handleCreateSchool = async () => {
    if (!schoolName.trim()) {
      setErrorMsg('院校名称不能为空');
      return;
    }

    setSavingSchool(true);
    try {
      const created = await fetchJson<School>('/api/schools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: schoolName.trim(),
          level: schoolLevel,
          admissionTypes: selectedAdmissionTypes,
          description: schoolDescription.trim(),
        }),
      });
      setSchools((current) => [...current, created]);
      setShowAddSchool(false);
      setSchoolName('');
      setSchoolLevel('普通本科');
      setSchoolDescription('');
      setSelectedAdmissionTypes(['专升本']);
      setErrorMsg('');
    } catch {
      setErrorMsg('新增院校失败，请检查名称是否重复');
    } finally {
      setSavingSchool(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">系统设置</h2>
        <button disabled title="暂未开放：当前版本仅展示设置项" className="px-6 py-2.5 bg-gray-200 text-gray-500 rounded-xl font-bold text-sm cursor-not-allowed">
          保存更改（暂未开放）
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="flex bg-white border border-gray-200 p-1 rounded-xl shadow-sm w-fit">
        {[
          { id: 'general' as const, label: '基础设置' },
          { id: 'materials' as const, label: '院校素材库' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-bold transition-all',
              activeTab === tab.id ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'general' && (
          <motion.div key="general" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex items-center gap-3 text-gray-900 mb-2">
                  <Building2 className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-bold">机构信息</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">机构名称</label>
                    <input type="text" defaultValue="某某学历提升机构" className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">联系电话</label>
                    <input type="text" defaultValue="400-123-4567" className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">机构简介</label>
                    <textarea defaultValue="专注学历提升，合作20+院校，通过率行业领先" className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm h-20 resize-none" />
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex items-center gap-3 text-gray-900 mb-2">
                  <Bot className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-bold">AI 能力配置</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { label: 'Gemini 智能引擎', status: '已连接', color: 'text-emerald-600 bg-emerald-50' },
                    { label: 'Imagen 图像生成', status: '待配置', color: 'text-gray-500 bg-gray-50' },
                    { label: 'Google Search 实时数据', status: '待配置', color: 'text-gray-500 bg-gray-50' },
                    { label: 'AI Chatbot 智能客服', status: '待配置', color: 'text-gray-500 bg-gray-50' },
                    { label: '快速响应模式', status: '待配置', color: 'text-gray-500 bg-gray-50' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between p-3 rounded-xl border border-gray-50">
                      <span className="text-sm text-gray-700">{item.label}</span>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${item.color}`}>{item.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex items-center gap-3 text-gray-900 mb-2">
                  <Database className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-bold">RPA 自动化配置</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { label: '多平台私信监控', desc: '每30分钟扫描一次' },
                    { label: '内容自动发布', desc: '按内容日历定时发布' },
                    { label: '个人微信辅助', desc: '话术推荐+人工确认发送' },
                  ].map((item, index) => (
                    <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                          <Globe className="w-4 h-4 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{item.label}</p>
                          <p className="text-[10px] text-gray-400">{item.desc}</p>
                        </div>
                      </div>
                      <div
                        onClick={() => setRpaEnabled((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))}
                        className={cn('w-10 h-5 rounded-full relative cursor-pointer transition-all', rpaEnabled[index] ? 'bg-emerald-500' : 'bg-gray-300')}
                      >
                        <div className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all', rpaEnabled[index] ? 'right-0.5' : 'left-0.5')} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex items-center gap-3 text-gray-900 mb-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-bold">安全与权限</h3>
                </div>
                <div className="space-y-2">
                  <button className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-all group">
                    <div className="flex items-center gap-3">
                      <Lock className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-700">账号管理</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500" />
                  </button>
                  <button className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-all group">
                    <div className="flex items-center gap-3">
                      <Bell className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-700">通知设置</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'materials' && (
          <motion.div key="materials" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">录入合作院校和专业信息，AI生成内容时将以此为依据。</p>
              <button
                onClick={() => setShowAddSchool(true)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition-all"
              >
                <Plus className="w-4 h-4" />
                新增院校
              </button>
            </div>

            {loadingSchools ? (
              <div className="rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center text-gray-400 shadow-sm">加载院校素材库中...</div>
            ) : schools.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center text-gray-500">
                <GraduationCap className="mx-auto mb-3 h-10 w-10 opacity-40" />
                <p className="text-sm font-medium">暂无院校素材数据</p>
              </div>
            ) : schools.map((school) => (
              <div key={school.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                      <GraduationCap className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{school.name}</h3>
                      <p className="text-xs text-gray-500">{school.majors.length} 个专业</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button disabled title="暂未开放：院校编辑后续接入" className="p-2 rounded-lg text-gray-300 cursor-not-allowed">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button disabled title="暂未开放：院校删除后续接入" className="p-2 rounded-lg text-gray-300 cursor-not-allowed">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="px-6 py-4 border-b border-gray-50 bg-blue-50/50">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {school.level && <span className="px-2 py-1 rounded-lg bg-white text-blue-700 text-xs font-bold border border-blue-100">{school.level}</span>}
                    {(school.admissionTypes ?? []).map((item) => (
                      <span key={`${school.id}-${item}`} className="px-2 py-1 rounded-lg bg-white text-emerald-700 text-xs font-bold border border-emerald-100">{item}</span>
                    ))}
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{school.description || '待补充院校背书说明'}</p>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl bg-white px-3 py-2 border border-gray-100">
                      <p className="text-gray-400 uppercase font-bold mb-1">机构背书</p>
                      <p className="text-gray-700">展示院校层次、招生类型、合作说明，降低纯话术成交的不信任感。</p>
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 border border-gray-100">
                      <p className="text-gray-400 uppercase font-bold mb-1">通过率口径</p>
                      <p className="text-gray-700">每个专业单独呈现通过率，避免顾问临场口径不一致。</p>
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 border border-gray-100">
                      <p className="text-gray-400 uppercase font-bold mb-1">报读要求</p>
                      <p className="text-gray-700">把专业要求和优势写清楚，方便报价和方案页复用。</p>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-50 bg-gray-50/30">
                        <th className="text-left px-6 py-3 font-medium">专业名称</th>
                        <th className="text-right px-6 py-3 font-medium">学费</th>
                        <th className="text-left px-6 py-3 font-medium">学制</th>
                        <th className="text-left px-6 py-3 font-medium">通过率</th>
                        <th className="text-right px-6 py-3 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {school.majors.map((major) => (
                        <tr key={`${school.id}-${major.name}`} className="hover:bg-gray-50 transition-colors group">
                          <td className="px-6 py-3 font-bold text-gray-900">
                            <div className="flex items-center gap-2">
                              <BookOpen className="w-4 h-4 text-emerald-500" />
                              {major.name}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right font-bold text-emerald-600">¥{major.fee.toLocaleString()}</td>
                          <td className="px-6 py-3 text-gray-600">{major.duration}</td>
                          <td className="px-6 py-3">
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">
                              {major.passRate}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="inline-flex flex-col items-end gap-1">
                              <button disabled title="暂未开放：专业编辑后续接入" className="text-xs text-gray-300 font-bold cursor-not-allowed">编辑</button>
                              {(major.requirements || major.advantages) && (
                                <span className="text-[10px] text-gray-400 max-w-[180px] text-right">
                                  {[major.requirements, major.advantages].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 border-t border-gray-50">
                  <button disabled title="暂未开放：添加专业后续接入" className="w-full py-2 border-2 border-dashed border-gray-100 rounded-xl text-gray-300 text-xs font-bold cursor-not-allowed">
                    + 添加专业（暂未开放）
                  </button>
                </div>
              </div>
            ))}

            <AnimatePresence>
              {showAddSchool && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowAddSchool(false)}
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl p-8"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-bold text-gray-900">新增合作院校</h3>
                      <button onClick={() => setShowAddSchool(false)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">院校名称</label>
                        <input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} type="text" placeholder="输入院校全称" className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">院校层次</label>
                        <select value={schoolLevel} onChange={(event) => setSchoolLevel(event.target.value)} className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm">
                          <option>普通本科</option>
                          <option>211院校</option>
                          <option>985院校</option>
                          <option>开放大学</option>
                          <option>成人高校</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">招生类型</label>
                        <div className="flex flex-wrap gap-2">
                          {['专升本', '高起专', '高起本', '硕士', '博士'].map((item) => (
                            <button
                              key={item}
                              onClick={() => setSelectedAdmissionTypes((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])}
                              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all', selectedAdmissionTypes.includes(item) ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-gray-100 text-gray-500 hover:border-emerald-200 hover:text-emerald-600')}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">院校简介</label>
                        <textarea value={schoolDescription} onChange={(event) => setSchoolDescription(event.target.value)} placeholder="简要介绍院校特色和优势..." className="w-full bg-gray-50 border-transparent focus:bg-white focus:border-emerald-500 focus:ring-0 rounded-xl text-sm h-20 resize-none" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                      <button onClick={() => setShowAddSchool(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 transition-all">
                        取消
                      </button>
                      <button onClick={() => void handleCreateSchool()} disabled={savingSchool} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                        {savingSchool ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Settings;
