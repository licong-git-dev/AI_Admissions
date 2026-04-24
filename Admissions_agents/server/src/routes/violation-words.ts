import { Router } from 'express';
import { db } from '../db';

type ViolationWordRow = {
  id: number;
  word: string;
  severity: string;
  reason: string | null;
  is_active: number;
  created_at: string;
};

const VALID_SEVERITIES = new Set(['block', 'warn']);
const MAX_WORD_LENGTH = 32;
const MAX_REASON_LENGTH = 200;

const toWord = (row: ViolationWordRow) => ({
  id: row.id,
  word: row.word,
  severity: row.severity,
  reason: row.reason,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
});

export const violationWordsRouter = Router();

violationWordsRouter.get('/', (req, res) => {
  const { active } = req.query;
  const rows = active === 'true'
    ? db.prepare(`SELECT * FROM violation_words WHERE is_active = 1 ORDER BY id ASC`).all() as ViolationWordRow[]
    : db.prepare(`SELECT * FROM violation_words ORDER BY id ASC`).all() as ViolationWordRow[];

  res.json({ success: true, data: rows.map(toWord), error: null });
});

violationWordsRouter.post('/', (req, res) => {
  const body = req.body as { word?: string; severity?: string; reason?: string };

  const word = (body.word || '').trim().slice(0, MAX_WORD_LENGTH);
  if (!word) {
    return res.status(400).json({ success: false, data: null, error: 'word 必填且不为空' });
  }

  const severity = body.severity || 'block';
  if (!VALID_SEVERITIES.has(severity)) {
    return res.status(400).json({ success: false, data: null, error: 'severity 非法' });
  }

  const reason = body.reason ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : null;

  try {
    const result = db.prepare(`
      INSERT INTO violation_words (word, severity, reason, is_active, created_at)
      VALUES (?, ?, ?, 1, datetime('now'))
    `).run(word, severity, reason);
    const created = db.prepare(`SELECT * FROM violation_words WHERE id = ?`).get(result.lastInsertRowid) as ViolationWordRow;
    res.status(201).json({ success: true, data: toWord(created), error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) {
      return res.status(409).json({ success: false, data: null, error: '该违规词已存在' });
    }
    res.status(500).json({ success: false, data: null, error: message });
  }
});

violationWordsRouter.patch('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM violation_words WHERE id = ?`).get(req.params.id) as ViolationWordRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '违规词不存在' });
  }

  const body = req.body as { severity?: string; reason?: string | null; isActive?: boolean };

  if (body.severity && !VALID_SEVERITIES.has(body.severity)) {
    return res.status(400).json({ success: false, data: null, error: 'severity 非法' });
  }

  const reason = body.reason === undefined
    ? existing.reason
    : body.reason === null
      ? null
      : body.reason.trim().slice(0, MAX_REASON_LENGTH);

  const isActive = body.isActive === undefined ? existing.is_active : body.isActive ? 1 : 0;

  db.prepare(`
    UPDATE violation_words
    SET severity = ?, reason = ?, is_active = ?
    WHERE id = ?
  `).run(body.severity ?? existing.severity, reason, isActive, req.params.id);

  const updated = db.prepare(`SELECT * FROM violation_words WHERE id = ?`).get(req.params.id) as ViolationWordRow;
  res.json({ success: true, data: toWord(updated), error: null });
});

violationWordsRouter.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM violation_words WHERE id = ?`).get(req.params.id) as ViolationWordRow | undefined;
  if (!existing) {
    return res.status(404).json({ success: false, data: null, error: '违规词不存在' });
  }

  db.prepare(`DELETE FROM violation_words WHERE id = ?`).run(req.params.id);
  res.json({ success: true, data: { deleted: true }, error: null });
});

export const loadActiveViolationWords = (): string[] => {
  const rows = db.prepare(`SELECT word FROM violation_words WHERE is_active = 1`).all() as Array<{ word: string }>;
  return rows.map((row) => row.word);
};
