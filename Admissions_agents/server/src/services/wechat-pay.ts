import crypto from 'crypto';
import fs from 'fs';

export type WechatPayConfig = {
  mchid: string;
  appid: string;
  apiV3Key: string;
  serialNo: string;
  privateKey: string;
  notifyUrl: string;
};

export const getWechatPayConfig = (): WechatPayConfig | null => {
  const mchid = process.env.WECHATPAY_MCHID;
  const appid = process.env.WECHATPAY_APPID;
  const apiV3Key = process.env.WECHATPAY_API_V3_KEY;
  const serialNo = process.env.WECHATPAY_SERIAL_NO;
  const privateKeyPath = process.env.WECHATPAY_PRIVATE_KEY_PATH;
  const notifyUrl = process.env.WECHATPAY_NOTIFY_URL;

  if (!mchid || !appid || !apiV3Key || !serialNo || !privateKeyPath || !notifyUrl) {
    return null;
  }

  let privateKey: string;
  try {
    privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  } catch {
    return null;
  }

  return { mchid, appid, apiV3Key, serialNo, privateKey, notifyUrl };
};

const sign = (config: WechatPayConfig, method: string, pathWithQuery: string, timestamp: string, nonceStr: string, body: string): string => {
  const payload = `${method}\n${pathWithQuery}\n${timestamp}\n${nonceStr}\n${body}\n`;
  return crypto.sign('RSA-SHA256', Buffer.from(payload), config.privateKey).toString('base64');
};

const buildAuthHeader = (config: WechatPayConfig, method: string, pathWithQuery: string, body: string): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const signature = sign(config, method, pathWithQuery, timestamp, nonceStr, body);

  const params: Record<string, string> = {
    mchid: config.mchid,
    nonce_str: nonceStr,
    timestamp,
    serial_no: config.serialNo,
    signature,
  };

  const encoded = Object.entries(params)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');

  return `WECHATPAY2-SHA256-RSA2048 ${encoded}`;
};

export type CreateNativeOrderInput = {
  outTradeNo: string;
  amountFen: number;
  description: string;
};

export type CreateNativeOrderResult = {
  success: boolean;
  codeUrl?: string;
  error?: string;
  stub?: boolean;
};

export const createNativeOrder = async (input: CreateNativeOrderInput): Promise<CreateNativeOrderResult> => {
  const config = getWechatPayConfig();
  if (!config) {
    return {
      success: true,
      codeUrl: `weixin://stub/pay?trade_no=${encodeURIComponent(input.outTradeNo)}`,
      stub: true,
    };
  }

  const payload = {
    appid: config.appid,
    mchid: config.mchid,
    description: input.description,
    out_trade_no: input.outTradeNo,
    notify_url: config.notifyUrl,
    amount: { total: input.amountFen, currency: 'CNY' },
  };

  const body = JSON.stringify(payload);
  const path = '/v3/pay/transactions/native';
  const authorization = buildAuthHeader(config, 'POST', path, body);

  try {
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });

    const data = (await response.json().catch(() => ({}))) as { code_url?: string; message?: string };
    if (!response.ok) {
      return { success: false, error: data.message || `微信支付返回 ${response.status}` };
    }

    return { success: true, codeUrl: data.code_url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `微信支付下单异常：${message}` };
  }
};

export type RefundInput = {
  outTradeNo: string;
  outRefundNo: string;
  amountFen: number;
  reason?: string;
};

export type RefundResult = {
  success: boolean;
  refundId?: string;
  error?: string;
  stub?: boolean;
};

export const createRefund = async (input: RefundInput): Promise<RefundResult> => {
  const config = getWechatPayConfig();
  if (!config) {
    return { success: true, refundId: `stub-refund-${input.outRefundNo}`, stub: true };
  }

  const payload = {
    out_trade_no: input.outTradeNo,
    out_refund_no: input.outRefundNo,
    reason: input.reason || '全额退款',
    notify_url: config.notifyUrl,
    amount: { refund: input.amountFen, total: input.amountFen, currency: 'CNY' },
  };

  const body = JSON.stringify(payload);
  const path = '/v3/refund/domestic/refunds';
  const authorization = buildAuthHeader(config, 'POST', path, body);

  try {
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });

    const data = (await response.json().catch(() => ({}))) as { refund_id?: string; message?: string };
    if (!response.ok) {
      return { success: false, error: data.message || `退款接口返回 ${response.status}` };
    }

    return { success: true, refundId: data.refund_id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `退款异常：${message}` };
  }
};

export type NotifyResource = {
  ciphertext: string;
  nonce: string;
  associated_data: string;
  algorithm: string;
};

export const decryptNotifyResource = (resource: NotifyResource): unknown => {
  const config = getWechatPayConfig();
  if (!config) {
    throw new Error('WechatPay 未配置，无法解密回调');
  }

  if (resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error(`不支持的算法：${resource.algorithm}`);
  }

  const key = Buffer.from(config.apiV3Key, 'utf8');
  const nonce = Buffer.from(resource.nonce, 'utf8');
  const associatedData = Buffer.from(resource.associated_data, 'utf8');
  const ciphertext = Buffer.from(resource.ciphertext, 'base64');

  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  decipher.setAAD(associatedData);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
};

export const generateOutTradeNo = (): string => {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const random = crypto.randomBytes(4).toString('hex');
  return `ADM${stamp}${random}`;
};
