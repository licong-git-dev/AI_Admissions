import { Router } from 'express';
import { db } from '../db';

type CourseRow = {
  id: number;
  name: string;
  major: string;
  teacher: string;
  time: string;
  date: string;
  location: string;
  students: number;
  batch: string;
};

const coursesRouter = Router();

coursesRouter.get('/', (req, res) => {
  const major = typeof req.query.major === 'string' ? req.query.major.trim() : '';
  const limit = 20;

  const rows = major
    ? db.prepare(`
        SELECT id, name, major, teacher, time, date, location, students, batch
        FROM courses
        WHERE major = ? OR major = '通用课程'
        ORDER BY date ASC, id ASC
        LIMIT ?
      `).all(major, limit) as CourseRow[]
    : db.prepare(`
        SELECT id, name, major, teacher, time, date, location, students, batch
        FROM courses
        ORDER BY date ASC, id ASC
        LIMIT ?
      `).all(limit) as CourseRow[];

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      major: row.major,
      teacher: row.teacher,
      time: row.time,
      date: row.date,
      location: row.location,
      students: row.students,
      batch: row.batch,
    })),
    error: null,
  });
});

export { coursesRouter };
