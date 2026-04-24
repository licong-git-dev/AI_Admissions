import { Router } from 'express';
import { db } from '../db';

type CrawlerSourceRow = {
  id: number;
  name: string;
  domain: string;
  type: string;
  frequency_hours: number;
  is_enabled: number;
  last_crawled_at: string | null;
  created_at: string;
};

type CrawlerItemRow = {
  id: number;
  source_id: number;
  title: string;
  url: string;
  summary: string | null;
  crawled_at: string;
  fed_to_factory_at: string | null;
};

const toSource = (row: CrawlerSourceRow) => ({
  id: row.id,
  name: row.name,
  domain: row.domain,
  type: row.type,
  frequencyHours: row.frequency_hours,
  isEnabled: row.is_enabled === 1,
  lastCrawledAt: row.last_crawled_at,
  createdAt: row.created_at,
});

const toItem = (row: CrawlerItemRow & { source_name?: string }) => ({
  id: row.id,
  sourceId: row.source_id,
  sourceName: row.source_name,
  title: row.title,
  url: row.url,
  summary: row.summary,
  crawledAt: row.crawled_at,
  fedToFactoryAt: row.fed_to_factory_at,
});

export const crawlerRouter = Router();

crawlerRouter.get('/sources', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM crawler_sources ORDER BY id ASC`).all() as CrawlerSourceRow[];
  res.json({ success: true, data: rows.map(toSource), error: null });
});

crawlerRouter.patch('/sources/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM crawler_sources WHERE id = ?`).get(req.params.id) as CrawlerSourceRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '采集源不存在' });
  }

  const body = req.body as { isEnabled?: boolean; frequencyHours?: number };

  if (body.frequencyHours !== undefined && (!Number.isInteger(body.frequencyHours) || body.frequencyHours < 1 || body.frequencyHours > 720)) {
    return res.status(400).json({ success: false, data: null, error: 'frequencyHours 必须为 1-720 的整数' });
  }

  db.prepare(`
    UPDATE crawler_sources
    SET is_enabled = ?, frequency_hours = ?
    WHERE id = ?
  `).run(
    body.isEnabled === undefined ? existing.is_enabled : body.isEnabled ? 1 : 0,
    body.frequencyHours ?? existing.frequency_hours,
    req.params.id
  );

  const updated = db.prepare(`SELECT * FROM crawler_sources WHERE id = ?`).get(req.params.id) as CrawlerSourceRow;
  res.json({ success: true, data: toSource(updated), error: null });
});

crawlerRouter.get('/items', (req, res) => {
  const { sourceId, limit } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (typeof sourceId === 'string' && sourceId) {
    filters.push('ci.source_id = ?');
    params.push(Number(sourceId));
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const pageSize = Math.min(Math.max(1, Number(limit) || 50), 200);

  const rows = db.prepare(`
    SELECT ci.*, cs.name as source_name
    FROM crawler_items ci
    LEFT JOIN crawler_sources cs ON cs.id = ci.source_id
    ${where}
    ORDER BY ci.crawled_at DESC
    LIMIT ?
  `).all(...params, pageSize) as Array<CrawlerItemRow & { source_name: string }>;

  res.json({ success: true, data: rows.map(toItem), error: null });
});
