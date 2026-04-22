/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Upload,
  BookOpen,
  CreditCard,
  FileText,
  MapPin,
  User,
  Phone,
  GraduationCap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/cn';
import { STATUS_LABELS } from '../constants';
import type { CourseItem, PaymentRecord, Student, StudentMaterial } from '../types';

async function fetchJson<T>(url: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'x-portal-token': token,
      ...(options?.headers ?? {}),
    },
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }

  return payload.data as T;
}

type PortalTab = 'progress' | 'payment' | 'courses' | 'materials';

const TABS: { id: PortalTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'progress', label: '报名进度', icon: GraduationCap },
  { id: 'payment', label: '缴费信息', icon: CreditCard },
  { id: 'courses', label: '课程安排', icon: BookOpen },
  { id: 'materials', label: '材料清单', icon: FileText },
];

const STATUS_STEPS = [
  { key: 'enrolled', label: '已报名', desc: '完成报名表填写' },
  { key: 'paid', label: '已缴费', desc: '完成缴费手续' },
  { key: 'admitted', label: '已录取', desc: '收到院校录取通知' },
  { key: 'studying', label: '在读', desc: '正在进行课程学习' },
  { key: 'graduated', label: '已毕业', desc: '完成学业，获得证书' },
] as const;

function StudentPortal() {
  const [activeTab, setActiveTab] = useState<PortalTab>('progress');
  const [student, setStudent] = useState<Student | null>(null);
  const [materials, setMaterials] = useState<StudentMaterial[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submittingMaterialId, setSubmittingMaterialId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [portalToken, setPortalToken] = useState('');

  useEffect(() => {
    let alive = true;

    const loadStudent = async () => {
      setLoading(true);
      try {
        const token = new URLSearchParams(window.location.search).get('portalToken') || '';
        if (!token) {
          setStudent(null);
          setErrorMsg('缺少学员端访问凭证，请联系招生专员获取专属链接');
          return;
        }

        setPortalToken(token);
        const studentData = await fetchJson<Student>('/api/students/me', token);
        if (!alive) {
          return;
        }

        setStudent(studentData);
        setErrorMsg('');
      } catch {
        if (!alive) {
          return;
        }
        setStudent(null);
        setErrorMsg('学员端数据加载失败，请确认后端服务已启动');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void loadStudent();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!student?.leadId) {
      setMaterials([]);
      setCourses([]);
      return;
    }

    let alive = true;
    setDetailLoading(true);

    const loadDetails = async () => {
      try {
        const [materialData, courseData] = await Promise.all([
          fetchJson<StudentMaterial[]>('/api/students/me/materials', portalToken),
          fetchJson<CourseItem[]>(`/api/courses?major=${encodeURIComponent(student.major)}`, portalToken),
        ]);

        if (!alive) {
          return;
        }

        setMaterials(materialData);
        setCourses(courseData.slice(0, 3));
      } catch {
        if (!alive) {
          return;
        }
        setMaterials([]);
        setCourses([]);
      } finally {
        if (alive) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetails();

    return () => {
      alive = false;
    };
  }, [portalToken, student?.leadId, student?.major]);

  const payment: PaymentRecord | null = useMemo(() => {
    if (!student?.payment) {
      return null;
    }

    return {
      id: String(student.payment.id),
      leadId: String(student.payment.leadId),
      studentName: student.name,
      major: student.major,
      totalAmount: student.payment.totalAmount,
      paidAmount: student.payment.paidAmount,
      method: student.payment.method,
      installments: student.payment.method === '分期' ? 2 : undefined,
      paidInstallments: student.payment.method === '分期'
        ? student.payment.paidAmount >= student.payment.totalAmount && student.payment.totalAmount > 0
          ? 2
          : student.payment.paidAmount > 0
            ? 1
            : 0
        : undefined,
      status: ((student.payment.paidAmount >= student.payment.totalAmount && student.payment.totalAmount > 0)
        ? 'paid'
        : student.payment.nextPaymentDueAt && Date.parse(student.payment.nextPaymentDueAt) < Date.now()
          ? 'overdue'
          : student.payment.paidAmount === 0
            ? 'pending'
            : 'partial'),
      lastPayDate: student.payment.firstPaidAt ?? student.payment.createdAt,
      nextPayDate: student.payment.nextPaymentDueAt ?? undefined,
      agentName: undefined,
    };
  }, [student]);

  const currentStepIndex = useMemo(() => {
    if (!student) {
      return -1;
    }

    const index = STATUS_STEPS.findIndex((step) => step.key === student.status);
    return index >= 0 ? index : 0;
  }, [student]);

  const uploadedMaterialCount = materials.filter((material) => material.status === 'uploaded').length;
  const requiredMaterialCount = materials.filter((material) => material.status !== 'optional').length;

  const handleMaterialUpload = async (material: StudentMaterial) => {
    if (!portalToken) {
      setErrorMsg('缺少学员端访问凭证，请联系招生专员获取专属链接');
      return;
    }

    setSubmittingMaterialId(material.id);
    try {
      const updated = await fetchJson<StudentMaterial>(
        `/api/students/me/materials/${material.id}`,
        portalToken,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'uploaded',
            uploadedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          }),
        },
      );
      setMaterials((current) => current.map((item) => item.id === updated.id ? updated : item));
      setErrorMsg('');
    } catch {
      setErrorMsg('材料状态更新失败，请稍后重试');
    } finally {
      setSubmittingMaterialId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <p className="text-sm">加载学员端数据中...</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <p className="text-sm">{errorMsg || '暂无学员数据，请联系招生专员'}</p>
      </div>
    );
  }

  const schoolName = student.enrollment?.schoolName ?? '待确认院校';
  const agentName = student.tags.find((tag) => !['待缴费', '逾期催缴'].includes(tag)) || '招生专员';

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-[480px] mx-auto px-4 py-6 space-y-5">
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-3xl p-6 text-white shadow-lg shadow-emerald-500/30">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <User className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{student.name}</h2>
              <p className="text-emerald-100 text-sm">{student.major} · {student.education}</p>
            </div>
            <div className="ml-auto">
              <span className="px-3 py-1.5 bg-white/20 rounded-xl text-xs font-bold">
                {STATUS_LABELS[student.status] ?? '进行中'}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/10 rounded-2xl p-3">
              <p className="text-emerald-200 text-[10px] font-medium mb-1">意向院校</p>
              <p className="text-white text-sm font-bold">{schoolName}</p>
            </div>
            <div className="bg-white/10 rounded-2xl p-3">
              <p className="text-emerald-200 text-[10px] font-medium mb-1">招生专员</p>
              <p className="text-white text-sm font-bold">{agentName}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-[11px] font-bold transition-all border',
                activeTab === tab.id
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200 shadow-sm'
                  : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200',
              )}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'progress' && (
            <motion.div key="progress" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <h3 className="font-bold text-gray-900 mb-6">报名进度</h3>
              <div className="relative">
                <div className="absolute left-[18px] top-0 bottom-0 w-0.5 bg-gray-100" />
                <div className="space-y-6">
                  {STATUS_STEPS.map((step, index) => {
                    const isDone = index <= currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    return (
                      <div key={step.key} className="flex items-start gap-4 relative">
                        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0 z-10 border-2', isDone ? isCurrent ? 'bg-emerald-500 border-emerald-500 shadow-md shadow-emerald-500/30' : 'bg-emerald-100 border-emerald-200' : 'bg-white border-gray-200')}>
                          {isDone ? <CheckCircle2 className={cn('w-4 h-4', isCurrent ? 'text-white' : 'text-emerald-500')} /> : <div className="w-2 h-2 rounded-full bg-gray-200" />}
                        </div>
                        <div className={cn('pt-1.5', isDone ? '' : 'opacity-40')}>
                          <p className={cn('text-sm font-bold', isCurrent ? 'text-emerald-600' : isDone ? 'text-gray-700' : 'text-gray-400')}>
                            {step.label}
                            {isCurrent && <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full">当前</span>}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{step.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'payment' && (
            <motion.div key="payment" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
                <h3 className="font-bold text-gray-900">缴费概览</h3>
                {!payment ? (
                  <p className="text-sm text-gray-400">暂无缴费记录，请联系招生专员</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-400 mb-1">应缴总额</p>
                        <p className="text-2xl font-bold text-gray-900">¥{payment.totalAmount.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400 mb-1">已缴金额</p>
                        <p className="text-2xl font-bold text-emerald-600">¥{payment.paidAmount.toLocaleString()}</p>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                        <span>缴费进度</span>
                        <span>{Math.round(payment.paidAmount / Math.max(payment.totalAmount, 1) * 100)}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${payment.paidAmount / Math.max(payment.totalAmount, 1) * 100}%` }} />
                      </div>
                    </div>
                    {payment.totalAmount > payment.paidAmount && (
                      <div className="flex items-center justify-between p-3 bg-amber-50 rounded-2xl border border-amber-100">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500" />
                          <div>
                            <p className="text-xs font-bold text-amber-700">待缴余额</p>
                            <p className="text-[10px] text-amber-500">{payment.nextPayDate ? `下次缴费日：${payment.nextPayDate}` : '请联系招生专员'}</p>
                          </div>
                        </div>
                        <p className="text-lg font-bold text-amber-600">¥{(payment.totalAmount - payment.paidAmount).toLocaleString()}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {payment && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
                  <h3 className="font-bold text-gray-900 mb-4">缴费详情</h3>
                  <div className="space-y-3 text-sm">
                    {[
                      { label: '缴费方式', value: payment.method },
                      { label: '最近缴费', value: payment.lastPayDate },
                      ...(payment.installments ? [
                        { label: '分期期数', value: `${payment.installments}期` },
                        { label: '已缴期数', value: `${payment.paidInstallments}/${payment.installments}期` },
                      ] : []),
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between py-2 border-b border-gray-50 last:border-0">
                        <span className="text-gray-400">{row.label}</span>
                        <span className="font-bold text-gray-700">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'courses' && (
            <motion.div key="courses" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">
              <h3 className="font-bold text-gray-700 px-1">近期课程</h3>
              {detailLoading ? (
                <div className="rounded-3xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">加载课程安排中...</div>
              ) : courses.length === 0 ? (
                <div className="rounded-3xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">暂无课程安排</div>
              ) : courses.map((course) => (
                <div key={course.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex flex-col items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold">{course.date.slice(5, 7)}月</span>
                      <span className="text-sm font-bold leading-none">{course.date.slice(8, 10)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-gray-900 text-sm">{course.name}</h4>
                      <p className="text-xs text-gray-400 mt-0.5">{course.teacher} · {course.batch}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-xs text-gray-500"><Clock className="w-3 h-3" />{course.time}</span>
                        <span className="flex items-center gap-1 text-xs text-gray-500"><MapPin className="w-3 h-3" />{course.location}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-center text-xs text-gray-400 py-2">仅显示最近3节课程</p>
            </motion.div>
          )}

          {activeTab === 'materials' && (
            <motion.div key="materials" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-gray-900">材料清单</h3>
                <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-lg">
                  {uploadedMaterialCount}/{requiredMaterialCount} 已完成
                </span>
              </div>
              {detailLoading ? (
                <div className="text-center py-10 text-sm text-gray-400">加载材料清单中...</div>
              ) : materials.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-400">暂无材料清单</div>
              ) : (
                <div className="space-y-4">
                  {materials.map((material) => (
                    <div key={material.id} className={cn(
                      'flex items-start gap-4 p-4 rounded-2xl border',
                      material.status === 'uploaded' ? 'bg-emerald-50/50 border-emerald-100' : material.status === 'pending' ? 'bg-amber-50/50 border-amber-100' : 'bg-gray-50 border-gray-100',
                    )}>
                      <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', material.status === 'uploaded' ? 'bg-emerald-100' : material.status === 'pending' ? 'bg-amber-100' : 'bg-gray-100')}>
                        {material.status === 'uploaded'
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          : material.status === 'pending'
                            ? <Clock className="w-4 h-4 text-amber-500" />
                            : <FileText className="w-4 h-4 text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={cn('text-sm font-bold', material.status === 'uploaded' ? 'text-emerald-700' : material.status === 'pending' ? 'text-amber-700' : 'text-gray-400')}>
                            {material.name}
                            {material.status === 'optional' && <span className="ml-2 text-[10px] text-gray-400 font-normal">可选</span>}
                          </p>
                          {material.status === 'uploaded' && <span className="text-[10px] text-emerald-600 font-bold">已上传</span>}
                        </div>
                        {material.note && <p className="text-[11px] text-gray-500 mt-0.5">{material.note}</p>}
                        {material.uploadedAt && <p className="text-[10px] text-gray-400 mt-1">上传于 {material.uploadedAt}</p>}
                      </div>
                      {material.status !== 'uploaded' && (
                        <button
                          onClick={() => void handleMaterialUpload(material)}
                          disabled={submittingMaterialId === material.id}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition-all shrink-0 disabled:cursor-not-allowed disabled:opacity-50',
                            material.status === 'pending' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                          )}
                        >
                          <Upload className="w-3 h-3" /> {submittingMaterialId === material.id ? '提交中...' : '上传'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-center text-xs text-gray-400 mt-6">如有疑问请联系招生专员</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3 pb-4">
          <button className="flex-1 py-3.5 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold text-sm hover:bg-gray-50 transition-all flex items-center justify-center gap-2">
            <Phone className="w-4 h-4" /> 电话联系专员
          </button>
          <button className="flex-1 py-3.5 bg-emerald-500 text-white rounded-2xl font-bold text-sm hover:bg-emerald-600 transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2">
            <GraduationCap className="w-4 h-4" /> 微信咨询
          </button>
        </div>
      </div>
    </div>
  );
}

export default StudentPortal;
