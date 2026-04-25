/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LayoutDashboard,
  Factory,
  Users,
  MessageSquare,
  GraduationCap,
  CreditCard,
  Calendar,
  Settings,
  Smartphone,
  Rocket,
  ShieldCheck,
  Briefcase,
  Globe,
  Bot,
  Receipt,
  Gift,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'dashboard', label: '数据看板', icon: LayoutDashboard },
  { id: 'agent', label: 'AI 员工', icon: Bot },
  { id: 'factory', label: '内容工厂', icon: Factory },
  { id: 'acquisition', label: 'AI 获客', icon: Rocket },
  { id: 'leads', label: '线索管理', icon: Users },
  { id: 'assistant', label: '微信助手', icon: MessageSquare },
  { id: 'students', label: '学员管理', icon: GraduationCap },
  { id: 'payment', label: '缴费管理', icon: CreditCard },
  { id: 'schedule', label: '排课管理', icon: Calendar },
  { id: 'compliance', label: '合规中心', icon: ShieldCheck },
  { id: 'management', label: '经营管理', icon: Briefcase },
  { id: 'value-statement', label: '价值账单', icon: Receipt },
  { id: 'referrals', label: '转介绍', icon: Gift },
  { id: 'platform', label: '平台总控台', icon: Globe },
  { id: 'settings', label: '系统设置', icon: Settings },
  { id: 'portal', label: '学员自助端', icon: Smartphone },
];

export const INTENT_COLORS = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-orange-100 text-orange-700 border-orange-200',
  low: 'bg-gray-100 text-gray-700 border-gray-200',
};

export const STATUS_LABELS: Record<string, string> = {
  new: '新线索',
  contacted: '已联系',
  following: '跟进中',
  interested: '意向明确',
  enrolled: '已报名',
  lost: '已流失',
  paid: '已缴费',
  admitted: '已录取',
  studying: '在读',
  graduated: '已毕业',
};

export const LEAD_STATUS_OPTIONS = [
  { value: 'new', label: '新线索' },
  { value: 'contacted', label: '已联系' },
  { value: 'following', label: '跟进中' },
  { value: 'interested', label: '意向明确' },
  { value: 'enrolled', label: '已报名' },
  { value: 'lost', label: '已流失' },
] as const;

