import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';

type AuditLogRow = {
  id: number;
  user_id: number | null;
  username: string | null;
  role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  ua: string | null;
  status_code: number | null;
  created_at: string;
};

const toLog = (row: AuditLogRow) => ({
  id: row.id,
  userId: row.user_id,
  username: row.username,
  role: row.role,
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  before: row.before_json,
  after: row.after_json,
  ip: row.ip,
  ua: row.ua,
  statusCode: row.status_code,
  createdAt: row.created_at,
});

export const auditRouter = Router();

auditRouter.use(requireAuth, requireRole(['admin', 'tenant_admin']));

auditRouter.get('/', (req: AuthedRequest, res) => {
  const { userId, resourceType, since, until, limit } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (typeof userId === 'string' && userId) {
    filters.push('user_id = ?');
    params.push(Number(userId));
  }
  if (typeof resourceType === 'string' && resourceType) {
    filters.push('resource_type = ?');
    params.push(resourceType);
  }
  if (typeof since === 'string' && since) {
    filters.push('datetime(created_at) >= datetime(?)');
    params.push(since);
  }
  if (typeof until === 'string' && until) {
    filters.push('datetime(created_at) <= datetime(?)');
    params.push(until);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const pageSize = Math.min(Math.max(1, Number(limit) || 100), 500);

  const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ?`).all(...params, pageSize) as AuditLogRow[];

  res.json({ success: true, data: rows.map(toLog), error: null });
});

auditRouter.get('/suspicious-deals', (req: AuthedRequest, res) => {
  const user = req.user!;
  const where = user.role === 'admin' ? 'WHERE suspicious = 1' : 'WHERE suspicious = 1 AND tenant = ?';
  const params = user.role === 'admin' ? [] : [user.tenant];

  const rows = db.prepare(`
    SELECT d.id, d.lead_id as leadId, d.school_name as schoolName, d.major_name as majorName,
           d.total_tuition as totalTuitionFen, d.commission_amount as commissionAmountFen,
           d.suspicious_reason as suspiciousReason, d.signed_at as signedAt, d.status,
           l.nickname as leadNickname, l.source as leadSource,
           (SELECT COUNT(*) FROM followups f WHERE f.lead_id = d.lead_id) as followupCount
    FROM deals d
    LEFT JOIN leads l ON l.id = d.lead_id
    ${where}
    ORDER BY d.id DESC
    LIMIT 200
  `).all(...params);

  res.json({ success: true, data: rows, error: null });
});
