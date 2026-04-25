/**
 * Job 失败错误分类
 *
 * - transient：临时性故障，应重试（网络抖动、限流、超时、上游 5xx）
 * - permanent：永久性故障，立即终止（参数非法、数据缺失、权限问题、4xx）
 *
 * 策略：宁可 transient 也不 permanent — 错判 transient 只是多重试一次，错判 permanent 会让真实可恢复错误失败。
 */

export type ErrorCategory = 'transient' | 'permanent';

const TRANSIENT_PATTERNS = [
  /\b429\b/i,
  /\brate.?limit/i,
  /\bquota/i,
  /\bbusy/i,
  /\btoo many requests/i,
  /\b50[234]\b/, // 502 / 503 / 504
  /\btemporarily unavailable/i,
  /\btimeout|\btimed out/i,
  /\bECONNRESET\b/,
  /\bETIMEDOUT\b/,
  /\bENOTFOUND\b/,
  /\bECONNREFUSED\b/,
  /\bsocket hang up/i,
  /\bnetwork.*(error|fail)/i,
  /\bfetch.*fail/i,
  /\baccess.?token/i, // wechat-work token 偶发刷新失败
];

const PERMANENT_PATTERNS = [
  /\b400\b/,
  /\b401\b/,
  /\b403\b/,
  /\b404\b/,
  /\b不存在\b/,
  /\b非法\b/,
  /\b缺失\b/,
  /\b未配置\b/,
  /\bnot found\b/i,
  /\binvalid/i,
  /\bmalformed/i,
  /\bunauthorized/i,
  /\bforbidden/i,
  /\bunsupported/i,
  /\bbad request/i,
  /\bvalidation\s+(failed|error)/i,
  /\bunknown\s+(tool|handler|mission_type)/i,
];

export const classifyError = (errorMessage: string | undefined | null): ErrorCategory => {
  const msg = String(errorMessage ?? '').trim();
  if (!msg) return 'transient';

  for (const re of PERMANENT_PATTERNS) {
    if (re.test(msg)) return 'permanent';
  }
  for (const re of TRANSIENT_PATTERNS) {
    if (re.test(msg)) return 'transient';
  }
  // 默认：偏保守，按 transient 走（让 job-queue 退避重试一次再说）
  return 'transient';
};
