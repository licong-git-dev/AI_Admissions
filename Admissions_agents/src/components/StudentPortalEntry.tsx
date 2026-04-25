/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Smartphone,
  LogOut,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  User,
  CreditCard,
  FileText,
  GraduationCap,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../lib/cn';
import {
  clearStudentToken,
  getStudentToken,
  setStudentToken,
  studentJson,
  type StudentProfile,
} from '../lib/student-auth';

type EnrollmentSlim = { schoolName: string; majorName: string; stage: string; note: string | null } | null;
type PaymentSlim = {
  totalAmount: number;
  paidAmount: number;
  method: string;
  firstPaidAt: string | null;
  nextPaymentDueAt: string | null;
} | null;
type MaterialSlim = { id: number; name: string; status: string; uploadedAt: string | null; note: string | null };
type DepositSlim = { id: number; outTradeNo: string; amount: number; status: string; paidAt: string | null; createdAt: string };

type ProfileData = {
  phone: string;
  lead: { id: number; nickname: string; tenant: string; status: string; source: string; contact: string } | null;
  enrollment: EnrollmentSlim;
  payment: PaymentSlim;
  materials: MaterialSlim[];
  deposits: DepositSlim[];
};

const STAGE_LABELS: Record<string, string> = {
  consulting: '咨询中',
  applying: '报名中',
  applied: '已报名',
  reviewing: '材料审核中',
  completed: '已完成',
};

const STATUS_LABELS: Record<string, string> = {
  new: '新线索',
  contacted: '已联系',
  following: '跟进中',
  interested: '意向明确',
  enrolled: '已报名',
  lost: '已流失',
};

const DEPOSIT_STATUS_LABELS: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  refunding: '退款中',
  refunded: '已退款',
  failed: '失败',
  canceled: '已取消',
};

function StudentPortalEntry() {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => Boolean(getStudentToken()));
  const [profile, setProfile] = useState<StudentProfile | null>(null);

  const handleLoggedIn = (p: StudentProfile) => {
    setProfile(p);
    setLoggedIn(true);
  };

  const handleLogout = () => {
    clearStudentToken();
    setLoggedIn(false);
    setProfile(null);
  };

  if (!loggedIn) {
    return <StudentLogin onLoggedIn={handleLoggedIn} />;
  }

  return <PortalDashboard profile={profile} onLogout={handleLogout} />;
}

function StudentLogin({ onLoggedIn }: { onLoggedIn: (p: StudentProfile) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hint, setHint] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const requestCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setErrorMsg('请输入正确的手机号');
      return;
    }
    setSending(true);
    setErrorMsg('');
    try {
      const data = await studentJson<{ stub: boolean; hint: string }>('/api/student/request-code', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setHint(data.stub ? data.hint : '验证码已发送，请查收短信');
      setStep('code');
      setCountdown(60);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setErrorMsg('请输入 6 位数字验证码');
      return;
    }
    setVerifying(true);
    setErrorMsg('');
    try {
      const data = await studentJson<{ token: string; profile: StudentProfile }>('/api/student/verify-code', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      });
      setStudentToken(data.token);
      onLoggedIn(data.profile);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '验证失败');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-blue-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-emerald-600" />
            <div>
              <div className="font-bold">学员自助端</div>
              <div className="text-xs text-gray-500">使用登记过的手机号登录</div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {step === 'phone' && (
            <>
              <div>
                <label className="block text-sm text-gray-700 mb-1">手机号</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="请输入 11 位手机号"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-emerald-500 focus:outline-none text-base"
                />
              </div>
              {errorMsg && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {errorMsg}
                </div>
              )}
              <button
                onClick={() => void requestCode()}
                disabled={sending || !phone}
                className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                获取验证码
              </button>
            </>
          )}

          {step === 'code' && (
            <>
              <div className="text-sm text-gray-600">
                已向 <span className="font-medium text-gray-900">{phone}</span> 发送验证码
              </div>
              {hint && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                  {hint}
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-700 mb-1">6 位验证码</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-emerald-500 focus:outline-none text-base tracking-widest text-center"
                />
              </div>
              {errorMsg && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {errorMsg}
                </div>
              )}
              <button
                onClick={() => void verify()}
                disabled={verifying || code.length !== 6}
                className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                登录
              </button>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <button onClick={() => setStep('phone')} className="text-gray-500 hover:text-gray-700">
                  更换手机号
                </button>
                <button
                  onClick={() => void requestCode()}
                  disabled={countdown > 0 || sending}
                  className="text-emerald-600 hover:text-emerald-700 disabled:text-gray-400"
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '重发验证码'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 bg-gray-50 text-xs text-gray-500 flex items-center gap-1 border-t border-gray-100">
          <ShieldCheck className="w-3 h-3" />
          登录即视为同意《隐私政策》
        </div>
      </div>
    </div>
  );
}

function PortalDashboard({ profile, onLogout }: { profile: StudentProfile | null; onLogout: () => void }) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const result = await studentJson<ProfileData>('/api/student/profile');
      setData(result);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const name = profile?.name || data?.lead?.nickname || '学员';
  const hasLead = Boolean(data?.lead);

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm font-semibold">
              {name.slice(0, 1)}
            </div>
            <div>
              <div className="font-medium text-sm">{name}</div>
              <div className="text-xs text-gray-500">{data?.phone}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <LogOut className="w-3 h-3" />
            退出
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {errorMsg}
          </div>
        )}

        {!hasLead && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 space-y-1">
            <div className="font-medium">暂未找到您的报名记录</div>
            <div className="text-xs">
              系统中没有以手机号 {data?.phone} 创建的线索。如果你已报名，可能是顾问使用了其他联系方式登记。
              建议联系招生顾问核对。
            </div>
          </div>
        )}

        {hasLead && data?.lead && (
          <Card title="当前状态" icon={GraduationCap}>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">
                {STATUS_LABELS[data.lead.status] || data.lead.status}
              </span>
              <span className="text-xs text-gray-500">来源：{data.lead.source}</span>
            </div>
          </Card>
        )}

        {data?.enrollment && (
          <Card title="报读信息" icon={GraduationCap}>
            <div className="space-y-1 text-sm">
              <Row label="院校" value={data.enrollment.schoolName || '—'} />
              <Row label="专业" value={data.enrollment.majorName || '—'} />
              <Row label="阶段" value={STAGE_LABELS[data.enrollment.stage] || data.enrollment.stage} />
              {data.enrollment.note && <Row label="备注" value={data.enrollment.note} />}
            </div>
          </Card>
        )}

        {data?.payment && (
          <Card title="缴费信息" icon={CreditCard}>
            <div className="space-y-1 text-sm">
              <Row label="方式" value={data.payment.method} />
              <Row label="应缴" value={`¥${data.payment.totalAmount.toFixed(2)}`} />
              <Row label="已缴" value={`¥${data.payment.paidAmount.toFixed(2)}`} accent="text-emerald-600" />
              <Row label="待缴" value={`¥${(data.payment.totalAmount - data.payment.paidAmount).toFixed(2)}`} accent="text-orange-600" />
              {data.payment.nextPaymentDueAt && (
                <Row label="下次催缴" value={new Date(data.payment.nextPaymentDueAt).toLocaleDateString()} />
              )}
            </div>
          </Card>
        )}

        {data?.deposits && data.deposits.length > 0 && (
          <Card title="定金订单" icon={CreditCard}>
            <div className="space-y-2">
              {data.deposits.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                  <div>
                    <div className="text-gray-900">¥{(d.amount / 100).toFixed(2)}</div>
                    <div className="text-xs text-gray-500">{d.outTradeNo}</div>
                  </div>
                  <span className={cn(
                    'px-2 py-0.5 rounded text-xs',
                    d.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-700'
                  )}>
                    {DEPOSIT_STATUS_LABELS[d.status] || d.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {data?.materials && data.materials.length > 0 && (
          <Card title="材料清单" icon={FileText}>
            <div className="space-y-2">
              {data.materials.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <div>
                    <div className="text-gray-900">{m.name}</div>
                    {m.note && <div className="text-xs text-gray-500">{m.note}</div>}
                  </div>
                  {m.status === 'uploaded' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : m.status === 'pending' ? (
                    <Clock className="w-4 h-4 text-amber-500" />
                  ) : (
                    <span className="text-xs text-gray-400">可选</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <ReferralWidget />

        <div className="pt-6 text-center text-xs text-gray-400 space-y-1">
          <div>遇到问题请联系招生顾问</div>
          <div>
            <a href="#" className="text-emerald-600 hover:underline">申请删除我的数据</a>
            <span className="mx-1">·</span>
            <a href="#" className="text-emerald-600 hover:underline">撤回授权</a>
          </div>
        </div>
      </div>
    </div>
  );
}

type MyReferral = {
  eligible: boolean;
  reason?: string;
  currentStatus?: string;
  nickname?: string;
  code?: string;
  invitedCount?: number;
  convertedCount?: number;
  totalEarnedFen?: number;
  totalPendingFen?: number;
};

function ReferralWidget() {
  const [data, setData] = useState<MyReferral | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const result = await studentJson<MyReferral>('/api/student/referrals/me');
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    };
    void load();
  }, []);

  if (error || !data) return null;

  if (!data.eligible) {
    if (data.reason === 'not_enrolled') {
      return (
        <div className="bg-rose-50 border border-rose-100 rounded-xl p-4">
          <div className="text-sm text-rose-700 font-medium">🎁 推荐有奖（待解锁）</div>
          <div className="text-xs text-rose-600 mt-1">
            完成报名后，可拿到专属推荐码 — 朋友通过你成交，你拿 ¥200，朋友拿 ¥100。
          </div>
        </div>
      );
    }
    return null;
  }

  const shareUrl = `${window.location.origin}/assessment?formId=1&ref=${data.code}`;

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(`我在用 AI 招生助手做学历提升测评，输入我的推荐码 ${data.code} 报名首单，咱俩都能领奖励。\n${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('复制失败，请手动选择文字');
    }
  };

  return (
    <div className="bg-gradient-to-br from-rose-50 via-white to-emerald-50 border border-rose-200 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-rose-700">🎁 我的推荐码</div>
        <div className="text-[10px] text-gray-500">推荐人 ¥200 · 被推荐人 ¥100</div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="font-mono text-2xl font-bold text-gray-900 tracking-widest">{data.code}</div>
        <button
          onClick={copyShare}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded"
        >
          {copied ? '已复制' : '复制邀请文案'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label="已邀请" value={data.invitedCount ?? 0} />
        <Mini label="已转化" value={data.convertedCount ?? 0} accent="text-emerald-600" />
        <Mini label="累计奖励" value={`¥${((data.totalEarnedFen ?? 0) / 100).toFixed(0)}`} accent="text-rose-600" />
      </div>

      {(data.totalPendingFen ?? 0) > 0 && (
        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          有 ¥{((data.totalPendingFen ?? 0) / 100).toFixed(0)} 待发放，正在处理中
        </div>
      )}

      <div className="mt-3 text-[10px] text-gray-500 break-all">{shareUrl}</div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="p-2 bg-white rounded border border-gray-100">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={cn('text-lg font-semibold', accent ?? 'text-gray-900')}>{value}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-emerald-600" />
        <div className="font-medium text-sm">{title}</div>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={cn(accent || 'text-gray-900')}>{value}</span>
    </div>
  );
}

export default StudentPortalEntry;
