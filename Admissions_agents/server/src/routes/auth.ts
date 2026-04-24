import { Router } from 'express';
import { db } from '../db';
import { hashPassword, verifyPassword } from '../services/password';
import { signJwt } from '../services/jwt';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: 'admin' | 'tenant_admin' | 'specialist' | 'student';
  phone: string | null;
  wechat_work_userid: string | null;
  tenant: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

const VALID_ROLES = new Set(['admin', 'tenant_admin', 'specialist', 'student']);

const toPublicUser = (row: UserRow) => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: row.role,
  phone: row.phone,
  wechatWorkUserId: row.wechat_work_userid,
  tenant: row.tenant,
  isActive: row.is_active === 1,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const body = req.body as { username?: string; password?: string };
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return res.status(400).json({ success: false, data: null, error: 'username 和 password 必填' });
  }

  const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as UserRow | undefined;
  if (!row || row.is_active !== 1) {
    return res.status(401).json({ success: false, data: null, error: '用户不存在或已停用' });
  }

  if (!verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ success: false, data: null, error: '用户名或密码错误' });
  }

  db.prepare(`UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(row.id);

  const token = signJwt({
    sub: row.id,
    username: row.username,
    role: row.role,
    name: row.name,
    tenant: row.tenant,
  });

  res.json({
    success: true,
    data: { token, user: toPublicUser(row) },
    error: null,
  });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.sub) as UserRow | undefined;
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '用户不存在' });
  }
  res.json({ success: true, data: toPublicUser(row), error: null });
});

authRouter.post('/change-password', requireAuth, (req: AuthedRequest, res) => {
  const body = req.body as { oldPassword?: string; newPassword?: string };
  if (!body.oldPassword || !body.newPassword || body.newPassword.length < 6) {
    return res.status(400).json({ success: false, data: null, error: '旧密码必填，新密码至少 6 位' });
  }

  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.sub) as UserRow | undefined;
  if (!row || !verifyPassword(body.oldPassword, row.password_hash)) {
    return res.status(401).json({ success: false, data: null, error: '旧密码错误' });
  }

  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
    hashPassword(body.newPassword),
    row.id
  );

  res.json({ success: true, data: { changed: true }, error: null });
});

authRouter.get('/users', requireAuth, requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const user = req.user!;
  const rows = user.role === 'admin'
    ? db.prepare(`SELECT * FROM users ORDER BY id ASC`).all() as UserRow[]
    : db.prepare(`SELECT * FROM users WHERE tenant = ? ORDER BY id ASC`).all(user.tenant) as UserRow[];

  res.json({ success: true, data: rows.map(toPublicUser), error: null });
});

authRouter.post('/users', requireAuth, requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const body = req.body as {
    username?: string;
    password?: string;
    name?: string;
    role?: string;
    phone?: string;
    wechatWorkUserId?: string;
    tenant?: string;
  };

  const caller = req.user!;
  const username = body.username?.trim() || '';
  const password = body.password || '';
  const name = body.name?.trim() || '';
  const role = body.role || 'specialist';
  const tenant = caller.role === 'admin' ? (body.tenant?.trim() || 'default') : caller.tenant;

  if (!username || !password || !name) {
    return res.status(400).json({ success: false, data: null, error: 'username、password、name 必填' });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ success: false, data: null, error: 'role 非法' });
  }
  if (caller.role === 'tenant_admin' && (role === 'admin' || role === 'tenant_admin')) {
    return res.status(403).json({ success: false, data: null, error: '乙方管理员只能创建招生专员和学员账号' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, name, role, phone, wechat_work_userid, tenant, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(username, hashPassword(password), name, role, body.phone || null, body.wechatWorkUserId || null, tenant);

    const created = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid) as UserRow;
    res.status(201).json({ success: true, data: toPublicUser(created), error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) {
      return res.status(409).json({ success: false, data: null, error: '用户名已存在' });
    }
    res.status(500).json({ success: false, data: null, error: message });
  }
});

authRouter.patch('/users/:id', requireAuth, requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as UserRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '用户不存在' });
  }

  const caller = req.user!;
  if (caller.role === 'tenant_admin' && existing.tenant !== caller.tenant) {
    return res.status(403).json({ success: false, data: null, error: '仅能操作本租户用户' });
  }

  const body = req.body as {
    name?: string;
    phone?: string | null;
    wechatWorkUserId?: string | null;
    isActive?: boolean;
    password?: string;
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name.trim()); }
  if (body.phone !== undefined) { updates.push('phone = ?'); params.push(body.phone); }
  if (body.wechatWorkUserId !== undefined) { updates.push('wechat_work_userid = ?'); params.push(body.wechatWorkUserId); }
  if (body.isActive !== undefined) { updates.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }
  if (body.password !== undefined && body.password.length >= 6) {
    updates.push('password_hash = ?');
    params.push(hashPassword(body.password));
  }

  if (updates.length === 0) {
    return res.json({ success: true, data: toPublicUser(existing), error: null });
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as UserRow;
  res.json({ success: true, data: toPublicUser(updated), error: null });
});
