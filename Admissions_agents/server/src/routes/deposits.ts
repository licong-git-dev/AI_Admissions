import { Router } from 'express';
import { db } from '../db';
import {
  createNativeOrder,
  createRefund,
  decryptNotifyResource,
  generateOutTradeNo,
  type NotifyResource,
} from '../services/wechat-pay';
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth';
import { getTenantScope, resolveTenantForWrite } from '../middleware/tenant';

type DepositRow = {
  id: number;
  lead_id: number | null;
  out_trade_no: string;
  amount: number;
  currency: string;
  description: string;
  status: string;
  code_url: string | null;
  transaction_id: string | null;
  payer_openid: string | null;
  paid_at: string | null;
  refund_no: string | null;
  refund_amount: number;
  refund_reason: string | null;
  refunded_at: string | null;
  meta_json: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_AMOUNT_FEN = 50000;
const PHONE_REGEX = /^1[3-9]\d{9}$/;

const toDeposit = (row: DepositRow) => ({
  id: row.id,
  leadId: row.lead_id,
  outTradeNo: row.out_trade_no,
  amountFen: row.amount,
  amountYuan: row.amount / 100,
  currency: row.currency,
  description: row.description,
  status: row.status,
  codeUrl: row.code_url,
  transactionId: row.transaction_id,
  paidAt: row.paid_at,
  refundAmountFen: row.refund_amount,
  refundedAt: row.refunded_at,
  phone: row.phone,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const depositsRouter = Router();

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body as { leadId?: number; phone?: string };

    if (body.phone && !PHONE_REGEX.test(body.phone)) {
      return res.status(400).json({ success: false, data: null, error: '手机号格式非法' });
    }

    let leadId = body.leadId;
    let tenant = 'default';
    if (!leadId && body.phone) {
      const lead = db.prepare(`SELECT id, tenant FROM leads WHERE contact = ? ORDER BY id DESC LIMIT 1`).get(body.phone) as { id: number; tenant: string } | undefined;
      if (lead) {
        leadId = lead.id;
        tenant = lead.tenant;
      }
    } else if (leadId) {
      const lead = db.prepare(`SELECT tenant FROM leads WHERE id = ?`).get(leadId) as { tenant: string } | undefined;
      if (lead) tenant = lead.tenant;
    }

    const outTradeNo = generateOutTradeNo();

    const order = await createNativeOrder({
      outTradeNo,
      amountFen: DEFAULT_AMOUNT_FEN,
      description: '招生平台学员报名意向定金',
    });

    if (!order.success || !order.codeUrl) {
      return res.status(500).json({ success: false, data: null, error: order.error || '下单失败' });
    }

    const result = db.prepare(`
      INSERT INTO deposits (lead_id, out_trade_no, amount, currency, description, status, code_url, phone, tenant, created_at, updated_at)
      VALUES (?, ?, ?, 'CNY', '招生平台学员报名意向定金', 'pending', ?, ?, ?, datetime('now'), datetime('now'))
    `).run(leadId ?? null, outTradeNo, DEFAULT_AMOUNT_FEN, order.codeUrl, body.phone ?? null, tenant);

    const created = db.prepare(`SELECT * FROM deposits WHERE id = ?`).get(result.lastInsertRowid) as DepositRow;

    res.status(201).json({
      success: true,
      data: { ...toDeposit(created), stub: order.stub === true },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

depositsRouter.get('/:outTradeNo', (req, res) => {
  const row = db.prepare(`SELECT * FROM deposits WHERE out_trade_no = ?`).get(req.params.outTradeNo) as DepositRow | undefined;
  if (!row) {
    return res.status(404).json({ success: false, data: null, error: '订单不存在' });
  }
  res.json({ success: true, data: toDeposit(row), error: null });
});

depositsRouter.post('/webhook/notify', async (req, res) => {
  try {
    const body = req.body as { resource?: NotifyResource; event_type?: string };

    if (!body.resource || !body.event_type) {
      return res.status(400).json({ code: 'FAIL', message: '缺少 resource 或 event_type' });
    }

    const decrypted = decryptNotifyResource(body.resource) as {
      out_trade_no?: string;
      transaction_id?: string;
      trade_state?: string;
      success_time?: string;
      payer?: { openid?: string };
    };

    if (!decrypted.out_trade_no) {
      return res.status(400).json({ code: 'FAIL', message: '缺少 out_trade_no' });
    }

    const existing = db.prepare(`SELECT * FROM deposits WHERE out_trade_no = ?`).get(decrypted.out_trade_no) as DepositRow | undefined;
    if (!existing) {
      return res.status(404).json({ code: 'FAIL', message: '订单不存在' });
    }

    if (existing.status === 'paid') {
      return res.json({ code: 'SUCCESS', message: 'OK' });
    }

    if (decrypted.trade_state === 'SUCCESS') {
      db.prepare(`
        UPDATE deposits
        SET status = 'paid',
            transaction_id = ?,
            payer_openid = ?,
            paid_at = ?,
            meta_json = ?,
            updated_at = datetime('now')
        WHERE out_trade_no = ?
      `).run(
        decrypted.transaction_id ?? null,
        decrypted.payer?.openid ?? null,
        decrypted.success_time ?? new Date().toISOString(),
        JSON.stringify(decrypted),
        decrypted.out_trade_no
      );
    } else {
      db.prepare(`
        UPDATE deposits
        SET status = 'failed',
            meta_json = ?,
            updated_at = datetime('now')
        WHERE out_trade_no = ?
      `).run(JSON.stringify(decrypted), decrypted.out_trade_no);
    }

    res.json({ code: 'SUCCESS', message: 'OK' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ code: 'FAIL', message });
  }
});

depositsRouter.post('/:outTradeNo/refund', requireAuth, requireRole(['admin', 'tenant_admin']), async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body as { reason?: string };
    const scope = getTenantScope(req);

    const existing = db.prepare(`SELECT * FROM deposits WHERE out_trade_no = ?`).get(req.params.outTradeNo) as DepositRow | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, data: null, error: '订单不存在' });
    }

    const depositTenant = ((existing as unknown) as { tenant?: string }).tenant;
    if (!scope.isPlatformAdmin && depositTenant && depositTenant !== scope.tenant) {
      return res.status(404).json({ success: false, data: null, error: '订单不存在' });
    }

    if (existing.status !== 'paid') {
      return res.status(400).json({ success: false, data: null, error: `当前状态为 ${existing.status}，无法退款` });
    }

    const outRefundNo = `RF${existing.out_trade_no}`;

    const refund = await createRefund({
      outTradeNo: existing.out_trade_no,
      outRefundNo,
      amountFen: existing.amount,
      reason: body.reason || '学员已完成全额学费缴纳',
    });

    if (!refund.success) {
      return res.status(500).json({ success: false, data: null, error: refund.error || '退款失败' });
    }

    db.prepare(`
      UPDATE deposits
      SET status = 'refunding',
          refund_no = ?,
          refund_amount = ?,
          refund_reason = ?,
          updated_at = datetime('now')
      WHERE out_trade_no = ?
    `).run(outRefundNo, existing.amount, body.reason || null, existing.out_trade_no);

    const updated = db.prepare(`SELECT * FROM deposits WHERE out_trade_no = ?`).get(existing.out_trade_no) as DepositRow;
    res.json({ success: true, data: { ...toDeposit(updated), stub: refund.stub === true }, error: null });
  } catch (error) {
    next(error);
  }
});

depositsRouter.get('/', requireAuth, requireRole(['admin', 'tenant_admin']), (req: AuthedRequest, res) => {
  const scope = getTenantScope(req);
  const { status, phone, leadId } = req.query;
  const filters: string[] = [];
  const params: (string | number)[] = [];

  if (!scope.isPlatformAdmin) {
    filters.push('tenant = ?');
    params.push(scope.tenant);
  }

  if (typeof status === 'string' && status) {
    filters.push('status = ?');
    params.push(status);
  }
  if (typeof phone === 'string' && phone) {
    filters.push('phone = ?');
    params.push(phone);
  }
  if (typeof leadId === 'string' && leadId) {
    filters.push('lead_id = ?');
    params.push(Number(leadId));
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM deposits ${where} ORDER BY id DESC LIMIT 200`).all(...params) as DepositRow[];

  res.json({ success: true, data: rows.map(toDeposit), error: null });
});
