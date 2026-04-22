import { Router } from 'express';
import { db } from '../db';

type SchoolRow = {
  id: number;
  name: string;
  level: string | null;
  admission_types_json: string;
  description: string | null;
};

type MajorRow = {
  school_id: number;
  name: string;
  fee: number;
  duration: string;
  pass_rate: string;
  requirements: string | null;
  advantages: string | null;
};

type CreateSchoolBody = {
  name?: string;
  level?: string;
  admissionTypes?: string[];
  description?: string;
};

const schoolsRouter = Router();
const SCHOOL_LEVELS = ['普通本科', '211院校', '985院校', '开放大学', '成人高校'];
const ADMISSION_TYPES = ['专升本', '高起专', '高起本', '硕士', '博士'];

const parseAdmissionTypes = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

schoolsRouter.get('/', (_req, res) => {
  const schoolRows = db.prepare(`
    SELECT id, name, level, admission_types_json, description
    FROM schools
    ORDER BY id ASC
  `).all() as SchoolRow[];
  const majorRows = db.prepare(`
    SELECT school_id, name, fee, duration, pass_rate, requirements, advantages
    FROM school_majors
    ORDER BY school_id ASC, id ASC
  `).all() as MajorRow[];

  const schools = schoolRows.map((school) => ({
    id: String(school.id),
    name: school.name,
    level: school.level ?? undefined,
    admissionTypes: parseAdmissionTypes(school.admission_types_json),
    description: school.description ?? undefined,
    majors: majorRows
      .filter((major) => major.school_id === school.id)
      .map((major) => ({
        name: major.name,
        fee: major.fee,
        duration: major.duration,
        passRate: major.pass_rate,
        requirements: major.requirements ?? undefined,
        advantages: major.advantages ?? undefined,
      })),
  }));

  res.json({ success: true, data: schools, error: null });
});

schoolsRouter.post('/', (req, res) => {
  const body = req.body as CreateSchoolBody;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const level = typeof body.level === 'string' ? body.level.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const admissionTypes = Array.isArray(body.admissionTypes)
    ? body.admissionTypes.filter((item): item is string => typeof item === 'string' && ADMISSION_TYPES.includes(item))
    : [];

  if (!name) {
    return res.status(400).json({ success: false, data: null, error: 'name 为必填项' });
  }

  if (level && !SCHOOL_LEVELS.includes(level)) {
    return res.status(400).json({ success: false, data: null, error: 'level 非法' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO schools (name, level, admission_types_json, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(name, level || null, JSON.stringify(admissionTypes), description || null);

    const row = db.prepare(`
      SELECT id, name, level, admission_types_json, description
      FROM schools
      WHERE id = ?
    `).get(result.lastInsertRowid) as SchoolRow;

    res.status(201).json({
      success: true,
      data: {
        id: String(row.id),
        name: row.name,
        level: row.level ?? undefined,
        admissionTypes: parseAdmissionTypes(row.admission_types_json),
        description: row.description ?? undefined,
        majors: [],
      },
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error && /UNIQUE/.test(error.message) ? '院校已存在' : '保存院校失败';
    res.status(400).json({ success: false, data: null, error: message });
  }
});

export { schoolsRouter };
