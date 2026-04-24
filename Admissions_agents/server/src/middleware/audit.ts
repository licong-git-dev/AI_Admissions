import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import type { AuthedRequest } from './auth';

const RESOURCE_PATTERNS: Array<{ pattern: RegExp; resourceType: string }> = [
  { pattern: /^\/api\/leads(?:\/|$)/, resourceType: 'lead' },
  { pattern: /^\/api\/deals(?:\/|$)/, resourceType: 'deal' },
  { pattern: /^\/api\/deposits(?:\/|$)/, resourceType: 'deposit' },
  { pattern: /^\/api\/content(?:\/|$)/, resourceType: 'content' },
  { pattern: /^\/api\/rpa\/accounts(?:\/|$)/, resourceType: 'rpa_account' },
  { pattern: /^\/api\/agreements(?:\/|$)/, resourceType: 'agreement' },
  { pattern: /^\/api\/violation-words(?:\/|$)/, resourceType: 'violation_word' },
  { pattern: /^\/api\/auth\/users(?:\/|$)/, resourceType: 'user' },
  { pattern: /^\/api\/settlement(?:\/|$)/, resourceType: 'settlement' },
];

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const resolveResourceType = (path: string): string | null => {
  for (const { pattern, resourceType } of RESOURCE_PATTERNS) {
    if (pattern.test(path)) return resourceType;
  }
  return null;
};

const extractResourceId = (path: string): string | null => {
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^[0-9a-zA-Z_-]+$/.test(last) && last !== 'api') return last;
  return null;
};

const clipJson = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  try {
    const str = JSON.stringify(value);
    if (str.length > 4000) return str.slice(0, 4000) + '…';
    return str;
  } catch {
    return null;
  }
};

const SENSITIVE_FIELD_PATTERN = /^(password|newPassword|oldPassword|cookies|apiKey|api_v3_key|private_key)$/i;

const redact = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = SENSITIVE_FIELD_PATTERN.test(k) ? '***REDACTED***' : redact(v);
    }
    return result as unknown as T;
  }
  return value;
};

export const auditLog = (req: AuthedRequest, res: Response, next: NextFunction): void => {
  if (!AUDITED_METHODS.has(req.method)) {
    return next();
  }

  const resourceType = resolveResourceType(req.path);
  if (!resourceType) {
    return next();
  }

  const resourceId = extractResourceId(req.path);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
  const ua = (req.headers['user-agent'] as string) || null;
  const beforeJson = clipJson(redact(req.body));

  res.on('finish', () => {
    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, username, role, action, resource_type, resource_id, before_json, after_json, ip, ua, status_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, datetime('now'))
      `).run(
        req.user?.sub ?? null,
        req.user?.username ?? null,
        req.user?.role ?? null,
        `${req.method} ${req.path}`,
        resourceType,
        resourceId,
        beforeJson,
        ip,
        ua,
        res.statusCode
      );
    } catch {
      // 审计失败不影响主流程
    }
  });

  next();
};
