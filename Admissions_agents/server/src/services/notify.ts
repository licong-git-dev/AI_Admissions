import { db } from '../db';
import { sendTextMessageToUser } from './wechat-work';

type UserForNotify = { id: number; name: string; username: string; wechat_work_userid: string | null };

const resolveUser = (hint: string | number | null): UserForNotify | null => {
  if (!hint) return null;

  if (typeof hint === 'number' || /^\d+$/.test(String(hint))) {
    return db.prepare(`SELECT id, name, username, wechat_work_userid FROM users WHERE id = ?`).get(Number(hint)) as UserForNotify | undefined ?? null;
  }

  return db.prepare(`SELECT id, name, username, wechat_work_userid FROM users WHERE username = ? OR name = ? LIMIT 1`).get(hint, hint) as UserForNotify | undefined ?? null;
};

export const notifyAssigneeNewLead = async (assigneeHint: string | number | null, leadSummary: { nickname: string; source: string; intent: string; content: string }): Promise<void> => {
  const user = resolveUser(assigneeHint);
  if (!user || !user.wechat_work_userid) return;

  const text = [
    `【新线索推送】`,
    `昵称：${leadSummary.nickname}`,
    `来源：${leadSummary.source}`,
    `意向：${leadSummary.intent}`,
    `内容：${leadSummary.content.slice(0, 120)}`,
    ``,
    `请尽快在系统中处理。`,
  ].join('\n');

  await sendTextMessageToUser({ toUser: user.wechat_work_userid, content: text }).catch(() => undefined);
};

export const notifyAdminNewDeal = async (deal: { schoolName: string; majorName: string; totalTuitionYuan: number; suspicious: boolean; suspiciousReason: string | null }): Promise<void> => {
  const admins = db.prepare(`SELECT id, name, username, wechat_work_userid FROM users WHERE role = 'admin' AND wechat_work_userid IS NOT NULL`).all() as UserForNotify[];
  if (admins.length === 0) return;

  const text = [
    `【新成交登记】`,
    `院校/专业：${deal.schoolName} / ${deal.majorName}`,
    `学费：¥${deal.totalTuitionYuan.toFixed(2)}`,
    deal.suspicious ? `⚠️ 疑似异常：${deal.suspiciousReason || '需人工复核'}` : `✅ 链路完整`,
  ].join('\n');

  await Promise.all(admins.map((admin) =>
    sendTextMessageToUser({ toUser: admin.wechat_work_userid!, content: text }).catch(() => undefined)
  ));
};
