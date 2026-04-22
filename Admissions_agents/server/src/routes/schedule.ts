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

type AttendanceRow = {
  id: number;
  student_name: string;
  course_name: string;
  date: string;
  status: 'present' | 'absent' | 'late' | 'leave';
};

const scheduleRouter = Router();

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

scheduleRouter.get('/summary', (_req, res) => {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mondayIso = formatLocalDate(monday);
  const sundayIso = formatLocalDate(sunday);

  const thisWeekCourseCount = (db.prepare(`SELECT COUNT(*) as count FROM courses WHERE date BETWEEN ? AND ?`).get(mondayIso, sundayIso) as { count: number }).count;
  const studyingCount = (db.prepare(`SELECT COUNT(*) as count FROM leads WHERE status = 'enrolled'`).get() as { count: number }).count;
  const totalAttendance = (db.prepare(`SELECT COUNT(*) as count FROM attendance_records`).get() as { count: number }).count;
  const presentCount = (db.prepare(`SELECT COUNT(*) as count FROM attendance_records WHERE status = 'present'`).get() as { count: number }).count;
  const pendingReminderCount = (db.prepare(`SELECT COUNT(*) as count FROM attendance_records WHERE status IN ('absent', 'late')`).get() as { count: number }).count;

  res.json({
    success: true,
    data: {
      thisWeekCourseCount,
      studyingCount,
      attendanceRate: totalAttendance === 0 ? 0 : Math.round((presentCount / totalAttendance) * 100),
      pendingReminderCount,
    },
    error: null,
  });
});

scheduleRouter.get('/courses', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, major, teacher, time, date, location, students, batch
    FROM courses
    ORDER BY date ASC, id ASC
  `).all() as CourseRow[];

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

scheduleRouter.get('/attendance', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, student_name, course_name, date, status
    FROM attendance_records
    ORDER BY date DESC, id DESC
  `).all() as AttendanceRow[];

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: String(row.id),
      studentName: row.student_name,
      courseName: row.course_name,
      date: row.date,
      status: row.status,
    })),
    error: null,
  });
});

export { scheduleRouter };
