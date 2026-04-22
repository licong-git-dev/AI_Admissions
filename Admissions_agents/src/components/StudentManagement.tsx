/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Filter,
  LayoutGrid,
  List,
  Plus,
  MoreVertical,
  Phone,
  MessageSquare,
  ChevronRight,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { STATUS_LABELS } from '../constants';
import type { FollowUpRecord, PaymentRecord, Student, StudentMaterial } from '../types';
import { cn } from '../lib/cn';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

const today = new Date();
const daysAgo = (n: number) => {
  const date = new Date(today);
  date.setDate(date.getDate() - n);
  return date.toISOString().slice(0, 10);
};

function StudentManagement() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [detailTab, setDetailTab] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [materials, setMaterials] = useState<StudentMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let alive = true;

    const loadStudents = async () => {
      setLoading(true);
      try {
        const data = await fetchJson<Student[]>('/api/students');
        if (!alive) {
          return;
        }
        setStudents(data);
        setErrorMsg('');
      } catch {
        if (!alive) {
          return;
        }
        setStudents([]);
        setErrorMsg('学员数据加载失败，请确认后端服务已启动');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void loadStudents();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedStudent?.leadId) {
      setFollowUps([]);
      setMaterials([]);
      return;
    }

    let alive = true;
    setDetailLoading(true);
    setMaterialsLoading(true);

    const loadDetailData = async () => {
      try {
        const [followUpData, materialData] = await Promise.all([
          fetchJson<FollowUpRecord[]>(`/api/leads/${selectedStudent.leadId}/follow-ups`),
          fetchJson<StudentMaterial[]>(`/api/leads/${selectedStudent.leadId}/materials`),
        ]);
        if (!alive) {
          return;
        }
        setFollowUps(followUpData);
        setMaterials(materialData);
      } catch {
        if (!alive) {
          return;
        }
        setFollowUps([]);
        setMaterials([]);
      } finally {
        if (alive) {
          setDetailLoading(false);
          setMaterialsLoading(false);
        }
      }
    };

    void loadDetailData();

    return () => {
      alive = false;
    };
  }, [selectedStudent?.leadId]);

  const filteredStudents = useMemo(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();

    return students.filter((student) => {
      if (normalizedSearchText.length === 0) {
        return true;
      }

      return [student.name, student.phone, student.major, student.source]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchText);
    });
  }, [searchText, students]);

  const selectedPayment: PaymentRecord | null = selectedStudent?.payment
    ? {
        id: String(selectedStudent.payment.id),
        leadId: String(selectedStudent.payment.leadId),
        studentName: selectedStudent.name,
        major: selectedStudent.major,
        totalAmount: selectedStudent.payment.totalAmount,
        paidAmount: selectedStudent.payment.paidAmount,
        method: selectedStudent.payment.method,
        installments: selectedStudent.payment.method === '分期' ? 2 : undefined,
        paidInstallments: selectedStudent.payment.method === '分期'
          ? selectedStudent.payment.paidAmount >= selectedStudent.payment.totalAmount && selectedStudent.payment.totalAmount > 0
            ? 2
            : selectedStudent.payment.paidAmount > 0
              ? 1
              : 0
          : undefined,
        status: ((selectedStudent.payment.paidAmount >= selectedStudent.payment.totalAmount && selectedStudent.payment.totalAmount > 0)
          ? 'paid'
          : selectedStudent.payment.nextPaymentDueAt && Date.parse(selectedStudent.payment.nextPaymentDueAt) < Date.now()
            ? 'overdue'
            : selectedStudent.payment.paidAmount === 0
              ? 'pending'
              : 'partial') as PaymentRecord['status'],
        lastPayDate: selectedStudent.payment.firstPaidAt ?? selectedStudent.payment.createdAt,
        nextPayDate: selectedStudent.payment.nextPaymentDueAt ?? undefined,
        agentName: undefined,
      }
    : null;

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-[300px]">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              type="text"
              placeholder="搜索姓名、手机号、专业..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border-gray-200 focus:border-emerald-500 focus:ring-0 rounded-xl text-sm transition-all shadow-sm"
            />
          </div>
          <button className="p-2.5 bg-white border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-all shadow-sm">
            <Filter className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
            <button onClick={() => setViewMode('grid')} className={cn('p-1.5 rounded-lg transition-all', viewMode === 'grid' ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400')}>
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('list')} className={cn('p-1.5 rounded-lg transition-all', viewMode === 'list' ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400')}>
              <List className="w-4 h-4" />
            </button>
          </div>
          <button className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">
            <Plus className="w-4 h-4" />
            新增学员
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center text-gray-400 shadow-sm">加载中...</div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredStudents.map((student) => (
              <motion.div
                key={student.id}
                layoutId={student.id}
                onClick={() => setSelectedStudent(student)}
                className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
                    {student.name[0]}
                  </div>
                  <button className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 opacity-0 group-hover:opacity-100 transition-all">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1 mb-4">
                  <h3 className="font-bold text-gray-900">{student.name}</h3>
                  <p className="text-xs text-gray-500">{student.major} · {student.education}</p>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-lg border border-emerald-100">
                    {STATUS_LABELS[student.status]}
                  </span>
                  {student.tags.map((tag) => {
                    const tagClassName = tag === '逾期催缴'
                      ? 'bg-red-50 text-red-600 border-red-100'
                      : tag === '待缴费'
                        ? 'bg-amber-50 text-amber-600 border-amber-100'
                        : 'bg-gray-50 text-gray-500 border-gray-100';
                    return (
                      <span key={tag} className={cn('px-2 py-0.5 text-[10px] font-bold rounded-lg border', tagClassName)}>
                        {tag}
                      </span>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-gray-50 flex items-center justify-between">
                  <div className="flex -space-x-2">
                    <div className="w-6 h-6 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-[10px] text-blue-600 font-bold">
                      <Phone className="w-3 h-3" />
                    </div>
                    <div className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-[10px] text-emerald-600 font-bold">
                      <MessageSquare className="w-3 h-3" />
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">
                    最近沟通: {student.lastContactDaysAgo === undefined ? '暂无' : student.lastContactDaysAgo === 0 ? '今天' : student.lastContactDaysAgo === 1 ? '昨天' : `${student.lastContactDaysAgo}天前`}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-4 font-medium">姓名</th>
                  <th className="text-left px-6 py-4 font-medium">专业</th>
                  <th className="text-left px-6 py-4 font-medium">状态</th>
                  <th className="text-left px-6 py-4 font-medium">手机号</th>
                  <th className="text-left px-6 py-4 font-medium">来源</th>
                  <th className="text-right px-6 py-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setSelectedStudent(student)}>
                    <td className="px-6 py-4 font-bold text-gray-900">{student.name}</td>
                    <td className="px-6 py-4 text-gray-600">{student.major}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-lg border border-emerald-100">
                        {STATUS_LABELS[student.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{student.phone}</td>
                    <td className="px-6 py-4 text-gray-500">{student.source}</td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedStudent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedStudent(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div layoutId={selectedStudent.id} className="relative w-full max-w-5xl h-[80vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-white">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-2xl">
                    {selectedStudent.name[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-bold text-gray-900">{selectedStudent.name}</h2>
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-full border border-emerald-100">
                        {STATUS_LABELS[selectedStudent.status]}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 font-medium">
                      {selectedStudent.major} · {selectedStudent.education} · {selectedStudent.job}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-100 transition-all">
                    <Phone className="w-5 h-5" />
                  </button>
                  <button className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-100 transition-all">
                    <MessageSquare className="w-5 h-5" />
                  </button>
                  <button className="px-6 py-3 bg-emerald-500 text-white rounded-2xl font-bold text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20">
                    编辑资料
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-hidden flex">
                <div className="w-[350px] border-r border-gray-100 p-8 overflow-y-auto space-y-8">
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">基本信息</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">手机号</span>
                        <span className="text-gray-900 font-medium">{selectedStudent.phone}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">微信号</span>
                        <span className="text-gray-900 font-medium">{selectedStudent.wechat}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">来源渠道</span>
                        <span className="text-gray-900 font-medium">{selectedStudent.source}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">报名院校</span>
                        <span className="text-gray-900 font-medium">{selectedStudent.enrollment?.schoolName ?? '待确认'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">标签</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedStudent.tags.map((tag) => {
                        const tagClassName = tag === '逾期催缴'
                          ? 'bg-red-50 text-red-600 border-red-200'
                          : tag === '待缴费'
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : 'bg-gray-50 text-gray-600 border-gray-100';
                        return (
                          <span key={tag} className={cn('px-3 py-1.5 text-xs font-bold rounded-xl border', tagClassName)}>
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex border-b border-gray-100 px-8">
                    {['沟通记录', '缴费记录', '材料清单', '状态流转'].map((tab, index) => (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(index)}
                        className={cn('px-6 py-4 text-sm font-bold transition-all border-b-2', detailTab === index ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-600')}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-8">
                    {detailTab === 0 && (
                      <div className="space-y-6">
                        {detailLoading ? (
                          <p className="text-sm text-gray-400">加载沟通记录中...</p>
                        ) : followUps.length === 0 ? (
                          <p className="text-sm text-gray-400">暂无沟通记录</p>
                        ) : followUps.map((item, index) => (
                          <div key={`${item.id}-${index}`} className="flex gap-6 group">
                            <div className="flex flex-col items-center shrink-0">
                              <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg', item.channel === 'wechat' ? 'bg-emerald-500' : item.channel === 'phone' ? 'bg-blue-500' : 'bg-amber-500')}>
                                {item.channel === 'phone' ? <Phone className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                              </div>
                              {index !== followUps.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 my-2" />}
                            </div>
                            <div className="pb-8">
                              <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">{item.createdAt}</p>
                              <h4 className="font-bold text-gray-900 mb-2">{item.channel === 'phone' ? '电话沟通' : item.channel === 'wechat' ? '微信沟通' : '系统记录'}</h4>
                              <p className="text-sm text-gray-600 leading-relaxed">{item.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {detailTab === 1 && (() => {
                      const payment = selectedPayment;
                      if (!payment) {
                        return (
                          <div className="text-center py-12 text-gray-400">
                            <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p className="text-sm">暂无真实缴费记录</p>
                          </div>
                        );
                      }

                      const statusLabel = payment.status === 'paid' ? '已结清' : payment.status === 'overdue' ? '逾期未缴' : payment.status === 'partial' ? '分期中' : '待缴费';
                      const statusColor = payment.status === 'paid' ? 'text-emerald-600' : payment.status === 'overdue' ? 'text-red-600' : 'text-amber-600';

                      return (
                        <div className="space-y-4">
                          <div className="p-5 rounded-2xl border border-gray-100 flex items-center justify-between">
                            <div>
                              <p className="font-bold text-gray-900">应缴总额</p>
                              <p className="text-2xl font-bold text-gray-900 mt-1">¥{payment.totalAmount.toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-gray-500">已缴金额 · <span className={cn('font-bold text-xs', statusColor)}>{statusLabel}</span></p>
                              <p className={cn('text-2xl font-bold mt-1', statusColor)}>¥{payment.paidAmount.toLocaleString()}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="rounded-2xl border border-gray-100 p-4">
                              <p className="text-xs font-bold text-gray-400 uppercase">缴费方式</p>
                              <p className="mt-2 text-sm font-bold text-gray-900">{payment.method}</p>
                            </div>
                            <div className="rounded-2xl border border-gray-100 p-4">
                              <p className="text-xs font-bold text-gray-400 uppercase">记录时间</p>
                              <p className="mt-2 text-sm font-bold text-gray-900">{payment.lastPayDate || '-'}</p>
                            </div>
                            <div className="rounded-2xl border border-gray-100 p-4 md:col-span-2">
                              <p className="text-xs font-bold text-gray-400 uppercase">下次应缴</p>
                              <p className="mt-2 text-sm font-bold text-gray-900">{payment.nextPayDate ?? '暂无计划'}</p>
                            </div>
                          </div>
                          {payment.paidAmount < payment.totalAmount && (
                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 text-sm text-amber-700">
                              待缴余额：<span className="font-bold">¥{(payment.totalAmount - payment.paidAmount).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {detailTab === 2 && (
                      materialsLoading ? (
                        <div className="py-10 text-center text-sm text-gray-400">加载材料清单中...</div>
                      ) : materials.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center text-gray-500">
                          <AlertCircle className="mx-auto mb-3 h-10 w-10 opacity-40" />
                          <p className="text-sm font-medium">暂无材料数据</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {materials.map((material) => (
                            <div key={material.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-4 transition-all hover:border-emerald-100">
                              <div className="flex items-center gap-3">
                                <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', material.status === 'uploaded' ? 'bg-emerald-50' : material.status === 'pending' ? 'bg-amber-50' : 'bg-gray-100')}>
                                  {material.status === 'uploaded'
                                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    : material.status === 'pending'
                                      ? <Clock className="h-4 w-4 text-amber-600" />
                                      : <AlertCircle className="h-4 w-4 text-gray-500" />}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-gray-900">{material.name}</p>
                                  <p className="text-[10px] text-gray-400">{material.note ?? '暂无备注'}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={cn('rounded-lg px-2 py-1 text-[10px] font-bold', material.status === 'uploaded' ? 'bg-emerald-50 text-emerald-600' : material.status === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-500')}>
                                  {material.status === 'uploaded' ? '已上传' : material.status === 'pending' ? '待提交' : '可选'}
                                </span>
                                {material.uploadedAt && <p className="mt-1 text-[10px] text-gray-400">{material.uploadedAt}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    )}

                    {detailTab === 3 && (() => {
                      const schoolName = selectedStudent.enrollment?.schoolName || '待确认院校';
                      const totalFee = selectedPayment?.totalAmount ? `¥${selectedPayment.totalAmount.toLocaleString()}` : '学费待确认';
                      const steps = [
                        { status: '已联系', date: followUps[followUps.length - 1]?.createdAt ?? '-', desc: '已有真实跟进记录', active: followUps.length > 0 },
                        { status: '已报名', date: selectedStudent.enrollment?.createdAt ?? '-', desc: `提交报名资料至${schoolName}`, active: Boolean(selectedStudent.enrollment) },
                        { status: '已缴费', date: selectedPayment?.lastPayDate ?? '-', desc: `完成缴费 ${totalFee}`, active: Boolean(selectedPayment && selectedPayment.paidAmount > 0) },
                      ].filter((step) => step.date !== '-');

                      return (
                        <div className="space-y-6">
                          {steps.map((step, index) => (
                            <div key={`${step.status}-${index}`} className="flex gap-4">
                              <div className="flex flex-col items-center shrink-0">
                                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center border-2', step.active ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-emerald-50 border-emerald-200 text-emerald-600')}>
                                  <CheckCircle2 className="w-4 h-4" />
                                </div>
                                {index !== steps.length - 1 && <div className="w-0.5 flex-1 my-1 bg-emerald-200" />}
                              </div>
                              <div className="pb-4">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="font-bold text-gray-900 text-sm">{step.status}</p>
                                  {step.active && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">已记录</span>}
                                </div>
                                <p className="text-xs text-gray-500">{step.date}</p>
                                <p className="text-sm text-gray-600 mt-1">{step.desc}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StudentManagement;
