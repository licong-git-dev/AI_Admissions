import { Router, type Request } from 'express';
import { db } from '../db';
import { config } from '../config';

type MaterialStatus = 'uploaded' | 'pending' | 'optional';

type MaterialRow = {
  id: number;
  lead_id: number;
  name: string;
  status: MaterialStatus;
  uploaded_at: string | null;
  note: string | null;
};

type UpdateMaterialBody = {
  status?: MaterialStatus;
  note?: string;
  uploadedAt?: string | null;
};

const materialsRouter = Router();
const MATERIAL_STATUSES: MaterialStatus[] = ['uploaded', 'pending', 'optional'];

const getLeadExists = (leadId: string) => {
  return db.prepare('SELECT id FROM leads WHERE id = ?').get(leadId) as { id: number } | undefined;
};

const getPortalLeadId = (req: Request): number | null => {
  const token = req.header('x-portal-token');
  if (!config.portalAccessToken || token !== config.portalAccessToken) {
    return null;
  }

  return config.portalStudentLeadId > 0 ? config.portalStudentLeadId : null;
};

materialsRouter.get('/students/me/materials', (req, res) => {
  const portalLeadId = getPortalLeadId(req);
  if (!portalLeadId) {
    return res.status(401).json({ success: false, data: null, error: '未授权访问学员端' });
  }

  const leadId = String(portalLeadId);
  if (!getLeadExists(leadId)) {
    return res.status(404).json({ success: false, data: null, error: '当前学员不存在' });
  }

  const rows = db.prepare(`
    SELECT id, lead_id, name, status, uploaded_at, note
    FROM student_materials
    WHERE lead_id = ?
    ORDER BY id ASC
  `).all(leadId) as MaterialRow[];

  const materials = rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    name: row.name,
    status: row.status,
    uploadedAt: row.uploaded_at,
    note: row.note,
  }));

  res.json({ success: true, data: materials, error: null });
});

materialsRouter.patch('/students/me/materials/:materialId', (req, res) => {
  const portalLeadId = getPortalLeadId(req);
  if (!portalLeadId) {
    return res.status(401).json({ success: false, data: null, error: '未授权访问学员端' });
  }

  const materialId = Number(req.params.materialId);
  if (!Number.isInteger(materialId) || materialId <= 0) {
    return res.status(400).json({ success: false, data: null, error: '材料 ID 非法' });
  }

  const existing = db.prepare(`
    SELECT id, lead_id, name, status, uploaded_at, note
    FROM student_materials
    WHERE id = ?
  `).get(materialId) as MaterialRow | undefined;

  if (!existing || existing.lead_id !== portalLeadId) {
    return res.status(404).json({ success: false, data: null, error: '材料不存在' });
  }

  const body = req.body as UpdateMaterialBody;
  const status = body.status ?? existing.status;
  const note = typeof body.note === 'string' ? body.note.trim() : existing.note;
  const uploadedAt = body.uploadedAt === undefined ? existing.uploaded_at : body.uploadedAt;

  if (!MATERIAL_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, data: null, error: 'status 非法' });
  }

  db.prepare(`
    UPDATE student_materials
    SET status = ?, uploaded_at = ?, note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, uploadedAt, note ?? null, materialId);

  const updated = db.prepare(`
    SELECT id, lead_id, name, status, uploaded_at, note
    FROM student_materials
    WHERE id = ?
  `).get(materialId) as MaterialRow;

  res.json({
    success: true,
    data: {
      id: updated.id,
      leadId: updated.lead_id,
      name: updated.name,
      status: updated.status,
      uploadedAt: updated.uploaded_at,
      note: updated.note,
    },
    error: null,
  });
});

export { materialsRouter };
