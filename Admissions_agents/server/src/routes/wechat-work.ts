import { Router } from 'express';
import { db } from '../db';
import {
  getWechatWorkConfig,
  sendTextMessageToUser,
  listFollowUsers,
  listExternalContactIds,
  getExternalContactDetail,
} from '../services/wechat-work';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { getTenantScope, resolveTenantForWrite } from '../middleware/tenant';

export const wechatWorkRouter = Router();

wechatWorkRouter.post('/webhook/message', (req, res) => {
  const body = req.body as Record<string, unknown>;

  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, role, action, resource_type, resource_id, before_json, after_json, ip, ua, status_code, created_at)
      VALUES (NULL, 'wechat-work', NULL, 'external_message', 'wechat_work_message', ?, ?, NULL, ?, ?, 200, datetime('now'))
    `).run(
      String(body.MsgId ?? body.msg_id ?? ''),
      JSON.stringify(body).slice(0, 4000),
      (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null,
      (req.headers['user-agent'] as string) || null
    );
  } catch {
    // ignore
  }

  res.json({ success: true, data: { received: true }, error: null });
});

wechatWorkRouter.use(requireAuth, requireRole(['admin', 'tenant_admin']));

wechatWorkRouter.get('/status', (_req, res) => {
  const config = getWechatWorkConfig();
  res.json({
    success: true,
    data: {
      configured: Boolean(config),
      corpId: config?.corpId ?? null,
      agentId: config?.agentId ?? null,
      contactSecretConfigured: Boolean(config?.contactSecret),
    },
    error: null,
  });
});

wechatWorkRouter.post('/send-test', async (req: AuthedRequest, res) => {
  const body = req.body as { toUser?: string; content?: string };
  if (!body.toUser || !body.content) {
    return res.status(400).json({ success: false, data: null, error: 'toUser 与 content 必填' });
  }

  const result = await sendTextMessageToUser({ toUser: body.toUser, content: body.content });
  if (result.stub) {
    return res.json({ success: true, data: { stub: true, note: '未配置企业微信，返回 stub 结果' }, error: null });
  }
  if (!result.success) {
    return res.status(502).json({ success: false, data: null, error: result.error || '发送失败' });
  }
  res.json({ success: true, data: { delivered: true }, error: null });
});

wechatWorkRouter.get('/follow-users', async (_req: AuthedRequest, res) => {
  const config = getWechatWorkConfig();
  if (!config?.contactSecret) {
    return res.json({ success: true, data: [], error: null, notConfigured: true });
  }

  const users = await listFollowUsers();
  res.json({ success: true, data: users, error: null });
});

wechatWorkRouter.post('/contacts/sync', async (req: AuthedRequest, res) => {
  const config = getWechatWorkConfig();
  if (!config?.contactSecret) {
    return res.status(400).json({
      success: false,
      data: null,
      error: '未配置 WECHAT_WORK_CONTACT_SECRET，无法同步外部联系人',
    });
  }

  const scope = getTenantScope(req);
  const tenant = resolveTenantForWrite(scope);

  const body = req.body as { userId?: string };
  const followUsers = body.userId ? [body.userId] : await listFollowUsers();

  if (followUsers.length === 0) {
    return res.json({ success: true, data: { fetched: 0, inserted: 0, skipped: 0 }, error: null });
  }

  const insertLead = db.prepare(`
    INSERT INTO leads (source, nickname, contact, intent, last_message, status, assignee, tenant, created_at, updated_at)
    VALUES ('企微客户', ?, ?, 'medium', ?, 'contacted', ?, ?, datetime('now'), datetime('now'))
  `);
  const findExisting = db.prepare(
    `SELECT id FROM leads WHERE source = '企微客户' AND contact = ? AND tenant = ? LIMIT 1`
  );

  let fetched = 0;
  let inserted = 0;
  let skipped = 0;

  for (const followUserId of followUsers) {
    const externalIds = await listExternalContactIds(followUserId);
    for (const externalId of externalIds) {
      fetched += 1;
      const detail = await getExternalContactDetail(externalId);
      if (!detail) continue;

      const contact = externalId;
      const existing = findExisting.get(contact, tenant) as { id: number } | undefined;
      if (existing) {
        skipped += 1;
        continue;
      }

      const lastMessage = detail.follow_info.remark
        ? `${detail.external_contact.name}（备注：${detail.follow_info.remark}）`
        : detail.external_contact.name;

      insertLead.run(
        detail.external_contact.name || '企微外部联系人',
        contact,
        lastMessage,
        followUserId,
        tenant
      );
      inserted += 1;

      // 轻微节流，避免触发企微 API 限流
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  res.json({
    success: true,
    data: { fetched, inserted, skipped, followUsers: followUsers.length },
    error: null,
  });
});
