/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ===== 枚举类型 =====

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'following'
  | 'interested'
  | 'enrolled'
  | 'lost';

export type IntentLevel = 'high' | 'medium' | 'low';

export type PaymentStatus = 'paid' | 'partial' | 'overdue' | 'pending';

export type PaymentMethod = '全款' | '分期';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';

export type ContentType = 'policy' | 'major' | 'case' | 'reminder' | 'qa';

export type ContentStatus = 'draft' | 'pending' | 'approved' | 'published';

// ===== 线索与学员 =====

export interface Lead {
  id: string;
  source: string;
  nickname: string;
  intent: IntentLevel;
  lastMessage: string;
  status: LeadStatus;
  assignee: string;
  contact?: string;
  createdAt: string;
  latestFollowupAt?: string | null;
  latestNextAction?: string | null;
  latestNextFollowupAt?: string | null;
}

export type StudentStatus = 'enrolled' | 'paid' | 'admitted' | 'studying' | 'graduated';

export interface Student {
  id: string;
  leadId?: string;
  name: string;
  phone: string;
  wechat: string;
  education: string;
  job: string;
  major: string;
  source: string;
  status: StudentStatus;
  tags: string[];
  lastContactDaysAgo?: number;
  enrollment?: EnrollmentRecord | null;
  payment?: PaymentSummary | null;
}

// ===== 缴费 =====

export interface PaymentRecord {
  id: string;
  leadId?: string;
  studentName: string;
  major: string;
  totalAmount: number;
  paidAmount: number;
  method: PaymentMethod;
  installments?: number;
  paidInstallments?: number;
  status: PaymentStatus;
  lastPayDate: string;
  nextPayDate?: string;
  agentName?: string;
}

// ===== 排课 =====

export interface CourseItem {
  id: string;
  name: string;
  major: string;
  teacher: string;
  time: string;
  date: string;
  location: string;
  students: number;
  batch: string;
}

export interface AttendanceRecord {
  id: string;
  studentName: string;
  courseName: string;
  date: string;
  status: AttendanceStatus;
}

export interface ScheduleSummary {
  thisWeekCourseCount: number;
  studyingCount: number;
  attendanceRate: number;
  pendingReminderCount: number;
}

// ===== 内容 =====

export interface ContentItem {
  id: string;
  title: string;
  type: ContentType;
  platforms: string[];
  status: ContentStatus;
  stats: {
    views: number;
    likes: number;
    comments: number;
    leads: number;
  };
  createdAt: string;
}

export interface GeneratedContent {
  title: string;
  content: string;
  image_desc: string;
}

// ===== 院校素材库 =====

export interface Major {
  name: string;
  fee: number;
  duration: string;
  passRate: string;
  requirements?: string;
  advantages?: string;
}

export interface School {
  id: string;
  name: string;
  level?: string;
  admissionTypes?: string[];
  description?: string;
  majors: Major[];
}

// ===== 微信助手 =====

export interface ChatContact {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: number;
  intent: IntentLevel;
  platform: string;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'agent';
  content: string;
  time: string;
}

export interface AiScript {
  text: string;
  type: 'direct' | 'value' | 'action' | 'guide';
}

export interface AiScriptResult {
  scripts: AiScript[];
  keyPoints: string[];
}

export interface StudentProfileResult {
  profile: {
    intentMajor: string;
    mainConcerns: string;
    stage: string;
    decisionFactor: string;
  };
  callPrep: {
    openingTopic: string;
    keyPoints: string[];
    objectionHandling: Array<{
      objection: string;
      response: string;
    }>;
    closingAction: string;
  };
}

// ===== 内容审核 =====

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface ReviewItem {
  id: string;
  title: string;
  type: ContentType;
  platforms: string[];
  generatedAt: string;
  status: ReviewStatus;
  rejectReason?: string;
}

// ===== AI 分析结果 =====

export interface IntentAnalysis {
  intent: IntentLevel;
  analysis: string;
  concerns: string[];
  suggestion: string;
  urgency: string;
}

export interface FollowUpRecord {
  id: number;
  leadId: number;
  channel: string;
  content: string;
  nextAction: string | null;
  nextFollowupAt: string | null;
  createdAt: string;
}

export interface EnrollmentRecord {
  id: number;
  leadId: number;
  schoolName: string;
  majorName: string;
  stage: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  id: number;
  leadId: number;
  totalAmount: number;
  paidAmount: number;
  method: PaymentMethod;
  firstPaidAt: string | null;
  nextPaymentDueAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalCard {
  id: number;
  leadId: number;
  schoolName: string;
  majorName: string;
  duration: string;
  tuitionAmount: number;
  serviceAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  installmentsNote: string | null;
  suitableFor: string | null;
  riskNote: string | null;
  proposalText: string;
  copyText: string;
  createdAt: string;
  updatedAt: string;
}

export type MaterialStatus = 'uploaded' | 'pending' | 'optional';

export interface StudentMaterial {
  id: number;
  leadId: number;
  name: string;
  status: MaterialStatus;
  uploadedAt: string | null;
  note: string | null;
}

export interface DashboardSummary {
  todayNewLeads: number;
  totalLeads: number;
  contactedLeads: number;
  interestedLeads: number;
  enrolledLeads: number;
  pendingFollowUps: number;
  pendingPaymentReminders: number;
  contentGeneratedCount: number;
  contentPublishedCount: number;
  contentViews: number;
  contentLeads: number;
  performance: Array<{
    name: string;
    leads: number;
    followUps: number;
    interested: number;
    enrolled: number;
  }>;
  funnel: Array<{
    value: number;
    name: string;
    fill: string;
  }>;
  trend: Array<{
    date: string;
    leads: number;
    followUps: number;
  }>;
  sources: Array<{
    source: string;
    count: number;
  }>;
}
