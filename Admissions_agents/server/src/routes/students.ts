import { Router, type Request } from 'express';
import { db } from '../db';
import { config } from '../config';

type StudentRow = {
  leadId: number;
  name: string;
  phone: string | null;
  source: string;
  major: string | null;
  leadStatus: string;
  assignee: string | null;
  lastFollowUpAt: string | null;
  enrollmentId: number | null;
  schoolName: string | null;
  majorName: string | null;
  enrollmentStage: string | null;
  enrollmentNote: string | null;
  enrollmentCreatedAt: string | null;
  enrollmentUpdatedAt: string | null;
  paymentId: number | null;
  totalAmount: number | null;
  paidAmount: number | null;
  paymentMethod: string | null;
  firstPaidAt: string | null;
  nextPaymentDueAt: string | null;
  paymentNote: string | null;
  paymentCreatedAt: string | null;
  paymentUpdatedAt: string | null;
};

const studentsRouter = Router();

const daysSince = (dateString: string | null): number | undefined => {
  if (!dateString) {
    return undefined;
  }

  const timestamp = Date.parse(dateString);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  const diff = Date.now() - timestamp;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
};

const mapStudentStatus = (row: StudentRow): 'enrolled' | 'paid' | 'admitted' | 'studying' | 'graduated' => {
  if ((row.totalAmount ?? 0) > 0 && (row.paidAmount ?? 0) >= (row.totalAmount ?? 0)) {
    return 'paid';
  }

  if (row.leadStatus === 'enrolled') {
    return 'enrolled';
  }

  return 'enrolled';
};

const buildTags = (row: StudentRow): string[] => {
  const tags: string[] = [];
  const totalAmount = row.totalAmount ?? 0;
  const paidAmount = row.paidAmount ?? 0;

  if (totalAmount > paidAmount) {
    if (row.nextPaymentDueAt && Date.parse(row.nextPaymentDueAt) < Date.now()) {
      tags.push('逾期催缴');
    } else {
      tags.push('待缴费');
    }
  }

  if (row.assignee) {
    tags.push(row.assignee);
  }

  return tags;
};

const getPortalLeadId = (req: Request): number | null => {
  const token = req.header('x-portal-token');
  if (!config.portalAccessToken || token !== config.portalAccessToken) {
    return null;
  }

  return config.portalStudentLeadId > 0 ? config.portalStudentLeadId : null;
};

studentsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`
    WITH latest_followup AS (
      SELECT f.lead_id, f.created_at
      FROM followups f
      INNER JOIN (
        SELECT lead_id, MAX(id) AS latest_id
        FROM followups
        GROUP BY lead_id
      ) latest ON latest.latest_id = f.id
    ),
    latest_payment AS (
      SELECT pr.id, pr.lead_id, pr.total_amount, pr.paid_amount, pr.method, pr.first_paid_at, pr.next_payment_due_at, pr.note, pr.created_at, pr.updated_at
      FROM payment_records pr
      INNER JOIN (
        SELECT lead_id, MAX(id) AS latest_id
        FROM payment_records
        GROUP BY lead_id
      ) latest ON latest.latest_id = pr.id
    )
    SELECT
      l.id AS leadId,
      l.nickname AS name,
      l.contact AS phone,
      l.source,
      e.major_name AS major,
      l.status AS leadStatus,
      l.assignee,
      lf.created_at AS lastFollowUpAt,
      e.id AS enrollmentId,
      e.school_name AS schoolName,
      e.major_name AS majorName,
      e.stage AS enrollmentStage,
      e.note AS enrollmentNote,
      e.created_at AS enrollmentCreatedAt,
      e.updated_at AS enrollmentUpdatedAt,
      lp.id AS paymentId,
      lp.total_amount AS totalAmount,
      lp.paid_amount AS paidAmount,
      lp.method AS paymentMethod,
      lp.first_paid_at AS firstPaidAt,
      lp.next_payment_due_at AS nextPaymentDueAt,
      lp.note AS paymentNote,
      lp.created_at AS paymentCreatedAt,
      lp.updated_at AS paymentUpdatedAt
    FROM leads l
    LEFT JOIN enrollments e ON e.lead_id = l.id
    LEFT JOIN latest_followup lf ON lf.lead_id = l.id
    LEFT JOIN latest_payment lp ON lp.lead_id = l.id
    WHERE l.status = 'enrolled' OR e.id IS NOT NULL OR lp.id IS NOT NULL
    ORDER BY COALESCE(lp.updated_at, e.updated_at, l.updated_at) DESC
  `).all() as StudentRow[];

  const students = rows.map((row) => ({
    id: String(row.leadId),
    leadId: String(row.leadId),
    name: row.name,
    phone: row.phone ?? '待补充',
    wechat: row.phone ?? '待补充',
    education: '待补充',
    job: '待补充',
    major: row.major ?? '待确认',
    source: row.source,
    status: mapStudentStatus(row),
    tags: buildTags(row),
    lastContactDaysAgo: daysSince(row.lastFollowUpAt),
    enrollment: row.enrollmentId
      ? {
          id: row.enrollmentId,
          leadId: row.leadId,
          schoolName: row.schoolName ?? '',
          majorName: row.majorName ?? '',
          stage: row.enrollmentStage ?? 'consulting',
          note: row.enrollmentNote,
          createdAt: row.enrollmentCreatedAt ?? '',
          updatedAt: row.enrollmentUpdatedAt ?? '',
        }
      : null,
    payment: row.paymentId
      ? {
          id: row.paymentId,
          leadId: row.leadId,
          totalAmount: row.totalAmount ?? 0,
          paidAmount: row.paidAmount ?? 0,
          method: row.paymentMethod === '分期' ? '分期' : '全款',
          firstPaidAt: row.firstPaidAt,
          nextPaymentDueAt: row.nextPaymentDueAt,
          note: row.paymentNote,
          createdAt: row.paymentCreatedAt ?? '',
          updatedAt: row.paymentUpdatedAt ?? '',
        }
      : null,
  }));

  res.json({ success: true, data: students, error: null });
});

studentsRouter.get('/me', (req, res) => {
  const leadId = getPortalLeadId(req);
  if (!leadId) {
    return res.status(401).json({ success: false, data: null, error: '未授权访问学员端' });
  }

  const student = db.prepare(`
    WITH latest_followup AS (
      SELECT f.lead_id, f.created_at
      FROM followups f
      INNER JOIN (
        SELECT lead_id, MAX(id) AS latest_id
        FROM followups
        GROUP BY lead_id
      ) latest ON latest.latest_id = f.id
    ),
    latest_payment AS (
      SELECT pr.id, pr.lead_id, pr.total_amount, pr.paid_amount, pr.method, pr.first_paid_at, pr.next_payment_due_at, pr.note, pr.created_at, pr.updated_at
      FROM payment_records pr
      INNER JOIN (
        SELECT lead_id, MAX(id) AS latest_id
        FROM payment_records
        GROUP BY lead_id
      ) latest ON latest.latest_id = pr.id
    )
    SELECT
      l.id AS leadId,
      l.nickname AS name,
      l.contact AS phone,
      l.source,
      e.major_name AS major,
      l.status AS leadStatus,
      l.assignee,
      lf.created_at AS lastFollowUpAt,
      e.id AS enrollmentId,
      e.school_name AS schoolName,
      e.major_name AS majorName,
      e.stage AS enrollmentStage,
      e.note AS enrollmentNote,
      e.created_at AS enrollmentCreatedAt,
      e.updated_at AS enrollmentUpdatedAt,
      lp.id AS paymentId,
      lp.total_amount AS totalAmount,
      lp.paid_amount AS paidAmount,
      lp.method AS paymentMethod,
      lp.first_paid_at AS firstPaidAt,
      lp.next_payment_due_at AS nextPaymentDueAt,
      lp.note AS paymentNote,
      lp.created_at AS paymentCreatedAt,
      lp.updated_at AS paymentUpdatedAt
    FROM leads l
    LEFT JOIN enrollments e ON e.lead_id = l.id
    LEFT JOIN latest_followup lf ON lf.lead_id = l.id
    LEFT JOIN latest_payment lp ON lp.lead_id = l.id
    WHERE l.id = ?
    LIMIT 1
  `).get(leadId) as StudentRow | undefined;

  if (!student) {
    return res.status(404).json({ success: false, data: null, error: '当前学员不存在' });
  }

  res.json({
    success: true,
    data: {
      id: String(student.leadId),
      leadId: String(student.leadId),
      name: student.name,
      phone: student.phone ?? '待补充',
      wechat: student.phone ?? '待补充',
      education: '待补充',
      job: '待补充',
      major: student.major ?? '待确认',
      source: student.source,
      status: mapStudentStatus(student),
      tags: buildTags(student),
      lastContactDaysAgo: daysSince(student.lastFollowUpAt),
      enrollment: student.enrollmentId
        ? {
            id: student.enrollmentId,
            leadId: student.leadId,
            schoolName: student.schoolName ?? '',
            majorName: student.majorName ?? '',
            stage: student.enrollmentStage ?? 'consulting',
            note: student.enrollmentNote,
            createdAt: student.enrollmentCreatedAt ?? '',
            updatedAt: student.enrollmentUpdatedAt ?? '',
          }
        : null,
      payment: student.paymentId
        ? {
            id: student.paymentId,
            leadId: student.leadId,
            totalAmount: student.totalAmount ?? 0,
            paidAmount: student.paidAmount ?? 0,
            method: student.paymentMethod === '分期' ? '分期' : '全款',
            firstPaidAt: student.firstPaidAt,
            nextPaymentDueAt: student.nextPaymentDueAt,
            note: student.paymentNote,
            createdAt: student.paymentCreatedAt ?? '',
            updatedAt: student.paymentUpdatedAt ?? '',
          }
        : null,
    },
    error: null,
  });
});

export { studentsRouter };
