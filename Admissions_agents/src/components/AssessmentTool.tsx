/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Lock,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';

type FormField = { key: string; label: string; options: string[] };

type FormConfig = {
  id: number;
  name: string;
  type: string;
  fields: FormField[];
  agreement?: { type: string; version: string; content: string };
};

type AssessmentReport = {
  matchedMajors?: Array<{ name: string; reason: string }>;
  suggestedSchoolLevel?: string;
  timeline?: string;
  concerns?: string[];
  nextStep?: string;
};

type Deposit = {
  id: number;
  outTradeNo: string;
  amountYuan: number;
  status: 'pending' | 'paid' | 'failed' | 'refunding' | 'refunded' | 'canceled';
  codeUrl: string | null;
  paidAt: string | null;
  stub?: boolean;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.data as T;
}

const PHONE_REGEX = /^1[3-9]\d{9}$/;

function AssessmentTool() {
  const formIdParam = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('formId') || '1';
  }, []);

  const referralCodeParam = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('ref') || '').trim().toUpperCase();
    return /^[0-9A-Z]{4,16}$/.test(raw) ? raw : null;
  }, []);

  const [form, setForm] = useState<FormConfig | null>(null);
  const [step, setStep] = useState<'questions' | 'submit' | 'result'>('questions');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [leadId, setLeadId] = useState<number | null>(null);
  const [referrerInfo, setReferrerInfo] = useState<{ code: string; referrerName: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchJson<FormConfig>(`/api/lead-forms/${formIdParam}`);
        setForm(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '测评表单加载失败');
      }
    };
    void load();
  }, [formIdParam]);

  useEffect(() => {
    if (!referralCodeParam) return;
    const lookup = async () => {
      try {
        const data = await fetchJson<{ code: string; referrerName: string }>(
          `/api/referrals/public/by-code/${encodeURIComponent(referralCodeParam)}`
        );
        setReferrerInfo(data);
      } catch {
        setReferrerInfo(null);
      }
    };
    void lookup();
  }, [referralCodeParam]);

  const currentField = form?.fields[currentIndex];
  const isLastQuestion = form ? currentIndex === form.fields.length - 1 : false;

  const selectOption = (option: string) => {
    if (!currentField) return;
    setAnswers((prev) => ({ ...prev, [currentField.key]: option }));
    setTimeout(() => {
      if (isLastQuestion) {
        setStep('submit');
      } else {
        setCurrentIndex(currentIndex + 1);
      }
    }, 200);
  };

  const submit = async () => {
    if (!form) return;

    if (!PHONE_REGEX.test(phone)) {
      setErrorMsg('请输入正确的手机号');
      return;
    }

    if (!consentChecked) {
      setErrorMsg('请勾选同意《个人信息授权书》');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    try {
      const data = await fetchJson<{ leadId: number; report: AssessmentReport }>(
        `/api/lead-forms/${form.id}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, answers, consentChecked, referralCode: referralCodeParam ?? undefined }),
        }
      );
      setReport(data.report);
      setLeadId(data.leadId);
      setStep('result');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (errorMsg && !form) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-emerald-50 to-white">
        <div className="p-6 bg-white rounded-xl shadow text-center max-w-sm">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <div className="text-gray-700">{errorMsg}</div>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const progress = step === 'questions'
    ? ((currentIndex + 1) / form.fields.length) * 100
    : step === 'submit'
      ? 100
      : 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      <div className="max-w-lg mx-auto p-4">
        <header className="py-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full">
            <Sparkles className="w-3 h-3" />
            AI 专业匹配测评
          </div>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">{form.name}</h1>
          <p className="mt-1 text-sm text-gray-500">1 分钟找到最适合你的学历提升方案</p>
          {referrerInfo && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 text-xs rounded-full border border-rose-200">
              🎁 你正被「{referrerInfo.referrerName}」邀请 · 完成首单两人共享奖励
            </div>
          )}
        </header>

        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {step === 'questions' && currentField && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <div className="text-xs text-gray-400 mb-1">
              问题 {currentIndex + 1} / {form.fields.length}
            </div>
            <div className="text-lg font-medium text-gray-900 mb-6">{currentField.label}</div>
            <div className="space-y-2">
              {currentField.options.map((option) => (
                <button
                  key={option}
                  onClick={() => selectOption(option)}
                  className={cn(
                    'w-full p-4 text-left border-2 rounded-xl text-sm transition-all',
                    answers[currentField.key] === option
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-gray-200 hover:border-emerald-300 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span>{option}</span>
                    {answers[currentField.key] === option && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                </button>
              ))}
            </div>
            {currentIndex > 0 && (
              <button
                onClick={() => setCurrentIndex(currentIndex - 1)}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700"
              >
                ← 上一题
              </button>
            )}
          </div>
        )}

        {step === 'submit' && (
          <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            <div className="text-center py-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <div className="mt-2 text-lg font-medium text-gray-900">答题完成！</div>
              <div className="mt-1 text-sm text-gray-500">留下手机号，立刻领取你的专业匹配报告</div>
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-1">手机号 *</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="请输入 11 位手机号"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-emerald-500 focus:outline-none text-base"
              />
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-1"
                />
                <div className="text-xs text-gray-600 leading-relaxed">
                  我已阅读并同意
                  <button
                    type="button"
                    onClick={() => setShowAgreement(true)}
                    className="text-emerald-600 underline mx-1"
                  >
                    《个人信息授权书》
                  </button>
                  ，同意将手机号与答案提交给服务方用于专业匹配与招生咨询。
                </div>
              </label>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMsg}
              </div>
            )}

            <button
              onClick={() => void submit()}
              disabled={submitting || !phone || !consentChecked}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  生成中…
                </>
              ) : (
                <>
                  获取我的专业匹配报告
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-1 text-xs text-gray-400">
              <ShieldCheck className="w-3 h-3" />
              授权时间、IP、协议版本号将加密留痕，可随时撤回
            </div>
          </div>
        )}

        {step === 'result' && report && (
          <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
            <div className="text-center py-2">
              <Sparkles className="w-10 h-10 text-emerald-500 mx-auto" />
              <div className="mt-2 text-lg font-semibold text-gray-900">你的专业匹配报告</div>
              {leadId && (
                <div className="mt-1 text-xs text-gray-400">报告编号 · {leadId}</div>
              )}
            </div>

            <NextStepFunnel leadId={leadId} phone={phone} />


            {report.matchedMajors && report.matchedMajors.length > 0 && (
              <Section title="推荐专业">
                <div className="space-y-2">
                  {report.matchedMajors.map((major, idx) => (
                    <div key={idx} className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <div className="font-medium text-emerald-900">{major.name}</div>
                      <div className="text-xs text-emerald-700 mt-0.5">{major.reason}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {report.suggestedSchoolLevel && (
              <Section title="建议院校层次">
                <div className="text-sm text-gray-700">{report.suggestedSchoolLevel}</div>
              </Section>
            )}

            {report.timeline && (
              <Section title="学习时间规划">
                <div className="text-sm text-gray-700">{report.timeline}</div>
              </Section>
            )}

            {report.concerns && report.concerns.length > 0 && (
              <Section title="我们发现你可能担心">
                <ul className="space-y-1 text-sm text-gray-700">
                  {report.concerns.map((item, idx) => (
                    <li key={idx}>· {item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {report.nextStep && (
              <div className="p-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl">
                <div className="text-xs opacity-80 mb-1">建议下一步</div>
                <div className="text-sm font-medium">{report.nextStep}</div>
              </div>
            )}

            <div className="text-center text-xs text-gray-400">
              稍后招生顾问会通过刚才留下的手机号与你联系
            </div>
          </div>
        )}

        <footer className="py-4 text-center text-xs text-gray-400">
          本服务由合规平台提供，严禁任何「包过 / 保录取」等承诺
        </footer>
      </div>

      {showAgreement && form.agreement && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50 p-4" onClick={() => setShowAgreement(false)}>
          <div className="bg-white w-full max-w-lg max-h-[80vh] rounded-t-2xl md:rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="font-medium">个人信息授权书 · {form.agreement.version}</div>
              <button onClick={() => setShowAgreement(false)} className="text-gray-400 hover:text-gray-600">
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
                {form.agreement.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  );
}

function NextStepFunnel({ leadId, phone }: { leadId: number | null; phone: string }) {
  const [showDeposit, setShowDeposit] = useState(false);
  const [softCtaClicked, setSoftCtaClicked] = useState<string | null>(null);

  const recordSoftIntent = async (action: string) => {
    setSoftCtaClicked(action);
    // 静默记录到后端，作为软转化漏斗数据（即便拿不到 200 也不影响用户）
    try {
      await fetch('/api/lead-forms/soft-cta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, leadId, action }),
      });
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="text-xs text-gray-500 uppercase tracking-wide">选择你的下一步</div>
        <div className="text-sm text-gray-700 mt-1">三个方式，总有一个适合你现在</div>
      </div>

      {/* 🥇 强转化：锁定定金 */}
      <button
        onClick={() => setShowDeposit(true)}
        className="w-full p-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl shadow text-left hover:from-emerald-600 hover:to-emerald-700 transition-all"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold flex items-center gap-1.5">
              <Lock className="w-4 h-4" />
              🥇 立即锁定报名名额
            </div>
            <div className="text-xs opacity-90 mt-1">
              支付 500 元定金优先锁专业 · 全额缴费后退还
            </div>
          </div>
          <ChevronRight className="w-4 h-4" />
        </div>
      </button>

      {/* 🥈 中转化：加顾问微信领完整资料 */}
      <button
        onClick={() => void recordSoftIntent('add_advisor_wechat')}
        className="w-full p-4 bg-white border-2 border-emerald-200 text-gray-800 rounded-xl text-left hover:border-emerald-400 transition-all"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium flex items-center gap-1.5">
              🥈 加顾问微信领取 · 完整专业对比表
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {softCtaClicked === 'add_advisor_wechat'
                ? '✓ 已记录 · 顾问会在 24 小时内主动联系你'
                : '比在线回答更详细；报告 PDF + 学员案例包'}
            </div>
          </div>
          {softCtaClicked === 'add_advisor_wechat' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* 🥉 弱转化：关注公众号接收政策提醒 */}
      <button
        onClick={() => void recordSoftIntent('subscribe_newsletter')}
        className="w-full p-4 bg-white border border-gray-200 text-gray-700 rounded-xl text-left hover:bg-gray-50 transition-all"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium flex items-center gap-1.5">
              🥉 接收政策提醒（不打扰）
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {softCtaClicked === 'subscribe_newsletter'
                ? '✓ 已订阅 · 政策变化时会短信通知你'
                : '仅在招生政策变化时给你发一条短信'}
            </div>
          </div>
          {softCtaClicked === 'subscribe_newsletter' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      <div className="text-center text-[10px] text-gray-400 pt-2">
        选择任何一项都不代表你必须报名。
      </div>

      {showDeposit && <DepositEntry leadId={leadId} phone={phone} />}
    </div>
  );
}

function DepositEntry({ leadId, phone }: { leadId: number | null; phone: string }) {
  const [showModal, setShowModal] = useState(false);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const createOrder = async () => {
    setCreating(true);
    setErrorMsg('');
    try {
      const data = await fetchJson<Deposit>('/api/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, phone }),
      });
      setDeposit(data);
      setShowModal(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '创建订单失败');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!showModal || !deposit || deposit.status !== 'pending') return;

    const pollInterval = setInterval(async () => {
      try {
        const updated = await fetchJson<Deposit>(`/api/deposits/${deposit.outTradeNo}`);
        setDeposit(updated);
        if (updated.status !== 'pending') {
          clearInterval(pollInterval);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [showModal, deposit]);

  return (
    <>
      <div className="p-4 border border-emerald-200 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-xl space-y-2">
        <div className="flex items-start gap-2">
          <Lock className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">锁定你的报名名额</div>
            <div className="text-xs text-gray-600 mt-1">
              支付 <span className="font-semibold text-emerald-700">500 元定金</span> 锁定名额，
              缴清全额学费后定金全额退还。
            </div>
          </div>
        </div>
        <button
          onClick={() => void createOrder()}
          disabled={creating}
          className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              生成订单中…
            </>
          ) : (
            <>
              立即锁定 · 500 元
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>
        {errorMsg && (
          <div className="text-xs text-red-600">{errorMsg}</div>
        )}
      </div>

      {showModal && deposit && (
        <DepositModal deposit={deposit} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

function DepositModal({ deposit, onClose }: { deposit: Deposit; onClose: () => void }) {
  const isPaid = deposit.status === 'paid';
  const isFailed = deposit.status === 'failed';

  const qrImageUrl = deposit.codeUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(deposit.codeUrl)}&size=240x240`
    : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="font-semibold">微信扫码支付</div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-center space-y-4">
          {isPaid ? (
            <>
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <div className="text-lg font-semibold text-gray-900">支付成功</div>
              <div className="text-sm text-gray-600">
                你已锁定 500 元定金，招生顾问会尽快与你联系。
              </div>
              <div className="text-xs text-gray-400">订单号 {deposit.outTradeNo}</div>
            </>
          ) : isFailed ? (
            <>
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
              <div className="text-lg font-semibold text-gray-900">支付失败</div>
              <div className="text-sm text-gray-600">请稍后重试</div>
            </>
          ) : (
            <>
              <div className="text-gray-900 text-lg font-semibold">
                <span className="text-emerald-700">¥{deposit.amountYuan}</span>
              </div>
              {deposit.stub ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 text-left space-y-1">
                  <div className="font-medium">⚠️ 当前为演示模式</div>
                  <div>
                    服务器未配置微信支付商户证书，此订单为 stub。
                    配置 <code>WECHATPAY_*</code> 环境变量后，将生成真实可扫码支付的订单。
                  </div>
                  <div className="mt-1 text-gray-600 break-all">
                    code_url: {deposit.codeUrl}
                  </div>
                </div>
              ) : qrImageUrl ? (
                <div>
                  <img src={qrImageUrl} alt="微信支付二维码" className="mx-auto" />
                  <div className="text-xs text-gray-500 mt-2">请使用微信扫码支付</div>
                </div>
              ) : (
                <div className="text-sm text-red-600">未获取到支付二维码</div>
              )}
              <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto" />
              <div className="text-xs text-gray-400">等待支付中…</div>
            </>
          )}
        </div>

        <div className="px-4 py-3 bg-gray-50 text-xs text-gray-500 text-center">
          定金在学费全额缴纳后可申请退还
        </div>
      </div>
    </div>
  );
}

export default AssessmentTool;
