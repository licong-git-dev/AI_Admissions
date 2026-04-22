import { Router } from 'express';
import { db } from '../db';

type ContentTypeCode = 'policy' | 'major' | 'case' | 'reminder' | 'qa';
type PlatformId = 'xhs' | 'dy' | 'ks';

type ContentRow = {
  id: number;
  title: string;
  type: ContentTypeCode;
  platforms_json: string;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  reject_reason: string | null;
  generated_at: string;
  published_at: string | null;
  views: number;
  likes: number;
  comments: number;
  leads: number;
};

type CreateReviewBody = {
  title?: string;
  type?: ContentTypeCode;
  platforms?: PlatformId[];
};

type UpdateReviewBody = {
  status?: 'approved' | 'rejected';
  rejectReason?: string;
};

const contentRouter = Router();
const CONTENT_TYPES: ContentTypeCode[] = ['policy', 'major', 'case', 'reminder', 'qa'];
const PLATFORM_IDS: PlatformId[] = ['xhs', 'dy', 'ks'];
const MAX_PAGE_SIZE = 100;

const parsePlatforms = (value: string): PlatformId[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is PlatformId => typeof item === 'string' && PLATFORM_IDS.includes(item as PlatformId))
      : [];
  } catch {
    return [];
  }
};

contentRouter.get('/reviews', (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE) : 50;
  const rows = db.prepare(`
    SELECT id, title, type, platforms_json, status, reject_reason, generated_at
    FROM content_items
    WHERE status IN ('pending', 'approved', 'rejected')
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as Array<Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'reject_reason' | 'generated_at'>>;

  const items = rows.map((row) => ({
    id: `r${row.id}`,
    title: row.title,
    type: row.type,
    platforms: parsePlatforms(row.platforms_json),
    status: row.status,
    generatedAt: row.generated_at,
    rejectReason: row.reject_reason ?? undefined,
  }));

  res.json({ success: true, data: items, error: null });
});

contentRouter.post('/reviews', (req, res) => {
  const body = req.body as CreateReviewBody;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() as ContentTypeCode : undefined;
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((item): item is PlatformId => typeof item === 'string' && PLATFORM_IDS.includes(item as PlatformId))
    : [];

  if (!title || !type || !CONTENT_TYPES.includes(type) || platforms.length === 0) {
    return res.status(400).json({ success: false, data: null, error: 'title、type、platforms 为合法必填项' });
  }

  const result = db.prepare(`
    INSERT INTO content_items (title, type, platforms_json, status, generated_at, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))
  `).run(title, type, JSON.stringify(platforms));

  const row = db.prepare(`
    SELECT id, title, type, platforms_json, status, reject_reason, generated_at
    FROM content_items
    WHERE id = ?
  `).get(result.lastInsertRowid) as Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'reject_reason' | 'generated_at'>;

  res.status(201).json({
    success: true,
    data: {
      id: `r${row.id}`,
      title: row.title,
      type: row.type,
      platforms: parsePlatforms(row.platforms_json),
      status: row.status,
      generatedAt: row.generated_at,
      rejectReason: row.reject_reason ?? undefined,
    },
    error: null,
  });
});

contentRouter.patch('/reviews/:id', (req, res) => {
  const rawId = Number(req.params.id.replace(/^r/, ''));
  if (!Number.isInteger(rawId) || rawId <= 0) {
    return res.status(400).json({ success: false, data: null, error: '内容 ID 非法' });
  }

  const existing = db.prepare('SELECT id FROM content_items WHERE id = ?').get(rawId) as { id: number } | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '内容不存在' });
  }

  const body = req.body as UpdateReviewBody;
  const status = body.status;
  const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason.trim() : '';

  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  if (status === 'rejected' && !rejectReason) {
    return res.status(400).json({ success: false, data: null, error: 'rejectReason 为必填项' });
  }

  db.prepare(`
    UPDATE content_items
    SET status = ?, reject_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, status === 'rejected' ? rejectReason : null, rawId);

  const row = db.prepare(`
    SELECT id, title, type, platforms_json, status, reject_reason, generated_at
    FROM content_items
    WHERE id = ?
  `).get(rawId) as Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'reject_reason' | 'generated_at'>;

  res.json({
    success: true,
    data: {
      id: `r${row.id}`,
      title: row.title,
      type: row.type,
      platforms: parsePlatforms(row.platforms_json),
      status: row.status,
      generatedAt: row.generated_at,
      rejectReason: row.reject_reason ?? undefined,
    },
    error: null,
  });
});

contentRouter.get('/records', (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE) : 50;
  const rows = db.prepare(`
    SELECT id, title, type, platforms_json, status, published_at, views, likes, comments, leads
    FROM content_items
    WHERE status = 'published'
    ORDER BY published_at DESC, id DESC
    LIMIT ?
  `).all(limit) as Array<Pick<ContentRow, 'id' | 'title' | 'type' | 'platforms_json' | 'status' | 'published_at' | 'views' | 'likes' | 'comments' | 'leads'>>;

  const items = rows.map((row) => ({
    id: String(row.id),
    title: row.title,
    type: row.type,
    platforms: parsePlatforms(row.platforms_json),
    status: 'published' as const,
    stats: {
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      leads: row.leads,
    },
    createdAt: row.published_at ?? '',
  }));

  res.json({ success: true, data: items, error: null });
});

export { contentRouter };
