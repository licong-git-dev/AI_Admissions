import { Router } from 'express';
import { db } from '../db';

type PaymentRow = {
  id: number;
  leadId: number;
  studentName: string;
  major: string | null;
  totalAmount: number;
  paidAmount: number;
  method: string;
  firstPaidAt: string | null;
  nextPaymentDueAt: string | null;
  createdAt: string;
  agentName: string | null;
};

const paymentsRouter = Router();

const toPaymentStatus = (row: PaymentRow): 'paid' | 'partial' | 'overdue' | 'pending' => {
  if (row.totalAmount > 0 && row.paidAmount >= row.totalAmount) {
    return 'paid';
  }

  if (row.nextPaymentDueAt && Date.parse(row.nextPaymentDueAt) < Date.now()) {
    return 'overdue';
  }

  if (row.paidAmount === 0) {
    return 'pending';
  }

  return 'partial';
};

paymentsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`
    WITH latest_payment AS (
      SELECT pr.id, pr.lead_id, pr.total_amount, pr.paid_amount, pr.method, pr.first_paid_at, pr.next_payment_due_at, pr.created_at
      FROM payment_records pr
      INNER JOIN (
        SELECT lead_id, MAX(id) AS latest_id
        FROM payment_records
        GROUP BY lead_id
      ) latest ON latest.latest_id = pr.id
    )
    SELECT
      lp.id,
      lp.lead_id AS leadId,
      l.nickname AS studentName,
      e.major_name AS major,
      lp.total_amount AS totalAmount,
      lp.paid_amount AS paidAmount,
      lp.method,
      lp.first_paid_at AS firstPaidAt,
      lp.next_payment_due_at AS nextPaymentDueAt,
      lp.created_at AS createdAt,
      l.assignee AS agentName
    FROM latest_payment lp
    INNER JOIN leads l ON l.id = lp.lead_id
    LEFT JOIN enrollments e ON e.lead_id = lp.lead_id
    ORDER BY lp.created_at DESC, lp.id DESC
  `).all() as PaymentRow[];

  const payments = rows.map((row) => {
    const status = toPaymentStatus(row);
    const isInstallment = row.method === '分期';
    const installments = isInstallment ? 2 : undefined;
    const paidInstallments = isInstallment
      ? status === 'paid'
        ? 2
        : row.paidAmount > 0
          ? 1
          : 0
      : undefined;

    return {
      id: String(row.id),
      leadId: String(row.leadId),
      studentName: row.studentName,
      major: row.major ?? '待确认',
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount,
      method: isInstallment ? '分期' : '全款',
      installments,
      paidInstallments,
      status,
      lastPayDate: row.createdAt,
      nextPayDate: row.nextPaymentDueAt ?? undefined,
      agentName: row.agentName ?? '未分配',
    };
  });

  res.json({ success: true, data: payments, error: null });
});

export { paymentsRouter };
