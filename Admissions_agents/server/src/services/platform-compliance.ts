/**
 * 平台合规二次扫描器
 *
 * 来源：
 * - 小红书 2025-11 教培治理公告「七大重点赛道」
 * - 小红书《交易导流违规管细则》（禁止站外交易引导）
 * - 抖音教培内容治理规则
 * - 市场监管总局典型处罚案例（2025）
 *
 * 职责：
 * - 检测内容中的站外导流语（微信号 / QQ / 手机号）
 * - 检测虚假承诺特征（完整度超过违规词库的短语 + 正则模式）
 * - 检测隐性误导（具体金额暗示 + 限时紧迫感）
 */

export type ComplianceIssue = {
  severity: 'block' | 'warn';
  category: string;
  match: string;
  rule: string;
};

export type ComplianceScanResult = {
  pass: boolean;
  issues: ComplianceIssue[];
  sanitized: string;
};

// 七大教培监管赛道关键词（触发平台算法监管）
const RESTRICTED_CATEGORIES = [
  '高校招生', '语言培训', '学历提升', 'K12', '素质教育', '游学研学', '论文辅导', '海外留学',
];

// 站外导流违规模式（小红书《交易导流违规管细则》）
const OFF_PLATFORM_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /微信[号：:]\s*[a-zA-Z0-9_]+/g, rule: '评论/正文含微信号，违反站外导流禁令' },
  { pattern: /\bwx[_-]?[a-zA-Z0-9_]+\b/gi, rule: '含 wx 前缀个人微信号格式' },
  { pattern: /\bQQ[：:]\s*\d{5,}/g, rule: '含 QQ 号，违反站外导流' },
  { pattern: /1[3-9]\d{9}/g, rule: '正文含 11 位手机号，不允许在笔记内直投' },
  { pattern: /扫码(?:加|咨询|联系|加群)/g, rule: '扫码引导语触发算法检测' },
  { pattern: /(?:加|联系|咨询)我?微信/g, rule: '"加微信"类引导在小红书新规后高风险' },
  { pattern: /私信我?(?:报名|缴费|价格|学费)/g, rule: '引导到站外交易链路' },
];

// 夸大效果 / 虚假承诺正则模式（补违规词库之外的变体）
const OVERPROMISE_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /\d+\s*天\s*过/g, rule: 'N 天过（XX）型快速承诺' },
  { pattern: /零基础\s*(?:直接|轻松|X*天)?(?:通过|上岸|拿证)/g, rule: '零基础夸大效果' },
  { pattern: /最后\s*(?:一次|\d+\s*(?:天|小时|分钟))/g, rule: '制造虚假紧迫感' },
  { pattern: /仅限(?:今天|今日|本月|\d+\s*(?:名|位|小时))/g, rule: '限时仅限型紧迫感' },
  { pattern: /(?:命题|阅卷|出题)\s*老师/g, rule: '暗示考试机构关联（广告法禁止）' },
  { pattern: /(?:内部|特殊|特别)\s*(?:渠道|名额|指标|关系)/g, rule: '内部关系类夸大' },
];

// 软性提示（不 block，但建议警告）
const SOFT_WARN_PATTERNS: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /(?:通过率|考试|录取)\s*[:：]?\s*\d{2,}\s*%/g, rule: '具体数字通过率需可证明；无证据支持时容易被监管引用' },
  { pattern: /99[.％%]\s*以?上/g, rule: '高通过率数字需证据' },
  { pattern: /国家\s*(?:重点|认证|授权)/g, rule: '需有官方授权证明，否则虚假背书' },
];

/**
 * 扫描内容，返回 block 类问题时算"不通过"，仅 warn 类不阻塞
 */
export const scanPlatformCompliance = (text: string, extraBlockWords: string[] = []): ComplianceScanResult => {
  const issues: ComplianceIssue[] = [];
  let sanitized = text;

  // 1. 额外黑名单（来自 DB violation_words 的 active 列表）
  for (const word of extraBlockWords) {
    if (!word) continue;
    if (text.includes(word)) {
      issues.push({ severity: 'block', category: '违规词库', match: word, rule: '命中 violation_words 表' });
      sanitized = sanitized.split(word).join('[已过滤]');
    }
  }

  // 2. 站外导流
  for (const { pattern, rule } of OFF_PLATFORM_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        issues.push({ severity: 'block', category: '站外导流', match: m, rule });
      }
      sanitized = sanitized.replace(pattern, '[已过滤]');
    }
  }

  // 3. 夸大承诺
  for (const { pattern, rule } of OVERPROMISE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        issues.push({ severity: 'block', category: '虚假承诺', match: m, rule });
      }
      sanitized = sanitized.replace(pattern, '[已过滤]');
    }
  }

  // 4. 软性警告（不改原文，仅记录）
  for (const { pattern, rule } of SOFT_WARN_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        issues.push({ severity: 'warn', category: '可疑表述', match: m, rule });
      }
    }
  }

  const hasBlockIssue = issues.some((i) => i.severity === 'block');
  return { pass: !hasBlockIssue, issues, sanitized };
};

export const getRestrictedCategories = (): string[] => [...RESTRICTED_CATEGORIES];
