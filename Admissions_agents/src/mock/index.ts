import type { Lead, Student, PaymentRecord, CourseItem, AttendanceRecord, School, ReviewItem } from '../types';

// ===== 日期工具 =====
const _today = new Date();
const _fmt = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(_today); d.setDate(d.getDate() - n); return _fmt(d); };
const daysFromNow = (n: number) => { const d = new Date(_today); d.setDate(d.getDate() + n); return _fmt(d); };

// ===== 线索 =====
export const MOCK_LEADS: Lead[] = [
  { id: '1', source: '小红书', nickname: '考研小助手', intent: 'high', lastMessage: '专升本怎么报名？', status: 'new', assignee: '张三', createdAt: '10:24' },
  { id: '2', source: '抖音', nickname: '奋斗的小李', intent: 'medium', lastMessage: '学费可以分期吗？', status: 'contacted', assignee: '李四', createdAt: '09:45' },
  { id: '3', source: '快手', nickname: '老王爱学习', intent: 'low', lastMessage: '好的知道了', status: 'contacted', assignee: '张三', createdAt: '昨天' },
  { id: '4', source: '小红书', nickname: '想提升学历的喵', intent: 'high', lastMessage: '会计专业通过率高吗？', status: 'interested', assignee: '王五', createdAt: '昨天' },
];

// ===== 学员（6人，与缴费/考勤数据一致）=====
export const MOCK_STUDENTS: Student[] = [
  { id: '1', name: '王小明', phone: '13800138000', wechat: 'wx_xiaoming', education: '大专', job: '会计助理', major: '会计学', source: '小红书', status: 'studying', tags: ['价格敏感', '急需学历'], lastContactDaysAgo: 2 },
  { id: '2', name: '李华', phone: '13911112222', wechat: 'lihua_001', education: '高中', job: '销售', major: '工商管理', source: '抖音', status: 'paid', tags: ['在职考公'], lastContactDaysAgo: 5 },
  { id: '3', name: '赵六', phone: '13622223333', wechat: 'zhao6_study', education: '大专', job: '工厂工人', major: '计算机科学', source: '快手', status: 'studying', tags: ['逾期催缴'], lastContactDaysAgo: 1 },
  { id: '4', name: '张伟', phone: '13733334444', wechat: 'zhangwei_pro', education: '大专', job: '技术员', major: '法学', source: '快手', status: 'enrolled', tags: ['待缴费'], lastContactDaysAgo: 3 },
  { id: '5', name: '刘芳', phone: '13855556666', wechat: 'liufang_up', education: '大专', job: '护士', major: '护理学', source: '小红书', status: 'studying', tags: ['在职学习'], lastContactDaysAgo: 7 },
  { id: '6', name: '陈强', phone: '13966667777', wechat: 'chenqiang88', education: '大专', job: '行政', major: '会计学', source: '抖音', status: 'studying', tags: ['积极配合'], lastContactDaysAgo: 4 },
];

// ===== 缴费 =====
export const MOCK_PAYMENTS: PaymentRecord[] = [
  { id: '1', studentName: '王小明', major: '会计学', totalAmount: 28000, paidAmount: 28000, method: '全款', status: 'paid', lastPayDate: daysAgo(30), agentName: '张三' },
  { id: '2', studentName: '李华', major: '工商管理', totalAmount: 32000, paidAmount: 16000, method: '分期', installments: 4, paidInstallments: 2, status: 'partial', lastPayDate: daysAgo(16), nextPayDate: daysFromNow(14), agentName: '李四' },
  { id: '3', studentName: '赵六', major: '计算机科学', totalAmount: 35000, paidAmount: 8750, method: '分期', installments: 4, paidInstallments: 1, status: 'overdue', lastPayDate: daysAgo(60), nextPayDate: daysAgo(7), agentName: '张三' },
  { id: '4', studentName: '张伟', major: '法学', totalAmount: 30000, paidAmount: 0, method: '全款', status: 'pending', lastPayDate: '-', agentName: '王五' },
  { id: '5', studentName: '刘芳', major: '护理学', totalAmount: 26000, paidAmount: 26000, method: '全款', status: 'paid', lastPayDate: daysAgo(25), agentName: '王五' },
  { id: '6', studentName: '陈强', major: '会计学', totalAmount: 28000, paidAmount: 14000, method: '分期', installments: 2, paidInstallments: 1, status: 'partial', lastPayDate: daysAgo(17), nextPayDate: daysFromNow(11), agentName: '李四' },
];

// ===== 排课 =====
export const MOCK_COURSES: CourseItem[] = [
  { id: '1', name: '高等数学（一）', major: '会计学', teacher: '王教授', time: '09:00-11:30', date: daysFromNow(4), location: '线上直播', students: 35, batch: '2026春季班' },
  { id: '2', name: '管理学原理', major: '工商管理', teacher: '李教授', time: '14:00-16:30', date: daysFromNow(4), location: '线上直播', students: 28, batch: '2026春季班' },
  { id: '3', name: '基础会计', major: '会计学', teacher: '张教授', time: '09:00-11:30', date: daysFromNow(5), location: '教室A301', students: 35, batch: '2026春季班' },
  { id: '4', name: '计算机基础', major: '计算机科学', teacher: '赵教授', time: '14:00-16:30', date: daysFromNow(5), location: '机房B201', students: 22, batch: '2026春季班' },
  { id: '5', name: '英语（二）', major: '通用课程', teacher: '刘老师', time: '19:00-21:00', date: daysFromNow(3), location: '线上直播', students: 60, batch: '2026春季班' },
  { id: '6', name: '财务管理', major: '会计学', teacher: '陈教授', time: '09:00-11:30', date: daysFromNow(11), location: '线上直播', students: 35, batch: '2026春季班' },
];

export const MOCK_ATTENDANCE: AttendanceRecord[] = [
  { id: '1', studentName: '王小明', courseName: '高等数学（一）', date: daysAgo(5), status: 'present' },
  { id: '2', studentName: '李华', courseName: '管理学原理', date: daysAgo(5), status: 'present' },
  { id: '3', studentName: '赵六', courseName: '计算机基础', date: daysAgo(4), status: 'absent' },
  { id: '4', studentName: '张伟', courseName: '基础会计', date: daysAgo(4), status: 'late' },
  { id: '5', studentName: '刘芳', courseName: '英语（二）', date: daysAgo(3), status: 'present' },
  { id: '6', studentName: '陈强', courseName: '高等数学（一）', date: daysAgo(5), status: 'leave' },
];

// ===== 微信对话（每个 chat 有独立消息和学员画像）=====
export const MOCK_CHATS = [
  {
    id: '1', name: '王同学', lastMsg: '学费大概多少？', time: '10:24', unread: 2, avatar: 'W',
    profile: { major: '会计学', concern: '学费、通过率', stage: '意向明确' },
    messages: [
      { id: '1', type: 'user' as const, content: '老师你好，我想咨询一下专升本。', time: '10:20' },
      { id: '2', type: 'agent' as const, content: '同学你好！欢迎咨询。请问你目前是什么学历，想报什么专业呢？', time: '10:21' },
      { id: '3', type: 'user' as const, content: '我是大专在读，想报会计专业。学费大概多少？', time: '10:24' },
    ],
  },
  {
    id: '2', name: '李同学', lastMsg: '好的，我考虑一下', time: '09:45', unread: 0, avatar: 'L',
    profile: { major: '工商管理', concern: '上课时间、学制长短', stage: '考虑中' },
    messages: [
      { id: '1', type: 'user' as const, content: '请问你们专升本需要全脱产上课吗？我在职。', time: '09:30' },
      { id: '2', type: 'agent' as const, content: '不用脱产！我们的课程都安排在周末和晚上，完全不影响正常工作。', time: '09:32' },
      { id: '3', type: 'user' as const, content: '好的，我考虑一下', time: '09:45' },
    ],
  },
  {
    id: '3', name: '张同学', lastMsg: '什么时候截止报名？', time: '昨天', unread: 0, avatar: 'Z',
    profile: { major: '计算机科学', concern: '报名截止时间、录取率', stage: '已联系' },
    messages: [
      { id: '1', type: 'user' as const, content: '你好，请问2026年春季班还在招生吗？', time: '昨天 14:10' },
      { id: '2', type: 'agent' as const, content: '还在招生！目前名额还有少量剩余，建议尽快报名锁定位置。', time: '昨天 14:15' },
      { id: '3', type: 'user' as const, content: '什么时候截止报名？', time: '昨天 14:20' },
    ],
  },
  {
    id: '4', name: '赵同学', lastMsg: '可以加微信吗？', time: '昨天', unread: 0, avatar: 'Z',
    profile: { major: '护理学', concern: '院校选择、就业前景', stage: '新线索' },
    messages: [
      { id: '1', type: 'user' as const, content: '看到你们的帖子，想了解护理学专升本。', time: '昨天 16:05' },
      { id: '2', type: 'agent' as const, content: '你好！护理学是我们合作院校的热门专业，通过率93%，就业很好。', time: '昨天 16:08' },
      { id: '3', type: 'user' as const, content: '可以加微信吗？方便详细了解。', time: '昨天 16:12' },
    ],
  },
];

// ===== 内容审核队列 =====
export const MOCK_REVIEW_ITEMS: ReviewItem[] = [
  { id: 'r1', title: '2026专升本政策重磅更新：这3条变化直接影响你的报名资格', type: 'policy', platforms: ['xhs', 'dy'], generatedAt: '今天 09:15', status: 'pending' },
  { id: 'r2', title: '会计专业全解析：就业前景+学费+院校推荐一文看懂', type: 'major', platforms: ['xhs', 'ks'], generatedAt: '今天 08:30', status: 'pending' },
  { id: 'r3', title: '报名倒计时15天！错过又等一年，别让拖延毁了你的本科梦', type: 'reminder', platforms: ['dy', 'ks'], generatedAt: '昨天 20:00', status: 'approved' },
  { id: 'r4', title: '学历提升5个常见误区，80%的人都踩过坑', type: 'qa', platforms: ['dy'], generatedAt: '昨天 16:00', status: 'rejected', rejectReason: '内容过于保守，需要更强调机构通过率优势，请重新生成' },
];

// 保留向后兼容的全局消息导出（WeChatAssistant 已改为使用 chat.messages）
export const MOCK_MESSAGES = MOCK_CHATS[0].messages;

// ===== 院校素材库 =====
export const MOCK_SCHOOLS: School[] = [
  {
    id: '1',
    name: '广东开放大学',
    majors: [
      { name: '会计学', fee: 28000, duration: '2.5年', passRate: '95%' },
      { name: '工商管理', fee: 32000, duration: '2.5年', passRate: '92%' },
    ],
  },
  {
    id: '2',
    name: '华南师范大学',
    majors: [
      { name: '计算机科学', fee: 35000, duration: '3年', passRate: '88%' },
      { name: '法学', fee: 30000, duration: '2.5年', passRate: '90%' },
    ],
  },
  {
    id: '3',
    name: '暨南大学',
    majors: [
      { name: '护理学', fee: 26000, duration: '3年', passRate: '93%' },
    ],
  },
];
