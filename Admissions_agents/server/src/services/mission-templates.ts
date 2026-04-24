/**
 * 预置任务模板
 *
 * 每个模板定义：
 * - type (唯一标识)
 * - defaultTitle
 * - goal 参数 schema
 * - 默认目标
 */

import { getPersonaForMission } from './agent-personas';

export type MissionTemplate = {
  type: string;
  title: string;
  description: string;
  defaultGoal: Record<string, unknown>;
  goalHint: string;
  personaId: string;     // 绑定到 agent-personas
};

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    type: 'daily_content_sprint',
    title: '每日内容冲刺',
    description: '「小招」自动生成今日 3 条小红书招生笔记草稿，经合规扫描后提交到审核队列（需要人工审批）',
    defaultGoal: {
      platforms: ['xhs'],
      dailyCount: 3,
      topics: ['专升本政策解读', '会计学专业推荐', '学员逆袭案例'],
    },
    goalHint: '指定平台、数量、主题。小招会自动拉素材库、生成内容、做合规扫描、提交审核。',
    personaId: 'xiaozhao',
  },
  {
    type: 'lead_followup_sweep',
    title: '高意向线索跟进扫描',
    description: '「小线」扫描当前高意向未跟进的线索，为每条生成推荐话术，通过企微推送给对应专员（需要人工审批）',
    defaultGoal: {
      minIntent: 'medium',
      maxResults: 20,
    },
    goalHint: '指定意向门槛和最大处理量。小线会查询、生成话术、聚合成清单推送给专员。',
    personaId: 'xiaoxian',
  },
  {
    type: 'weekly_report',
    title: '周度经营报表',
    description: '「小报」拉取过去 7 天的经营指标（线索/成交/分成/异常），生成自然语言摘要，推送给管理员（需要人工审批）',
    defaultGoal: {
      period: '本周',
      recipients: 'admins',
    },
    goalHint: '小报会自动聚合 dashboard、deals、异常成交等数据，生成摘要并推送。',
    personaId: 'xiaobao',
  },
  {
    type: 'daily_briefing',
    title: '今日战报（AI 员工自述）',
    description: '「小报」把过去 24 小时的活动汇总成一段第一人称叙事，推送到老板的企业微信',
    defaultGoal: {
      pushToAdmins: true,
    },
    goalHint: '小报会聚合 24h 指标（线索/内容/mission）+ 用第一人称口吻汇报，直接推到企微。',
    personaId: 'xiaobao',
  },
];

export const getMissionTemplate = (type: string): MissionTemplate | undefined =>
  MISSION_TEMPLATES.find((t) => t.type === type);

export { getPersonaForMission };
