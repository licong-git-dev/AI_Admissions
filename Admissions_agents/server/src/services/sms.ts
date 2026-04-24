import crypto from 'crypto';

export type AliyunSmsConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  otpTemplateCode: string;
  endpoint: string;
};

export const getAliyunSmsConfig = (): AliyunSmsConfig | null => {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const otpTemplateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE_OTP;
  const endpoint = process.env.ALIYUN_SMS_ENDPOINT || 'https://dysmsapi.aliyuncs.com';

  if (!accessKeyId || !accessKeySecret || !signName || !otpTemplateCode) {
    return null;
  }

  return { accessKeyId, accessKeySecret, signName, otpTemplateCode, endpoint };
};

const percentEncode = (str: string): string =>
  encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');

export type SendOtpResult = {
  success: boolean;
  stub?: boolean;
  messageId?: string;
  error?: string;
};

export const sendOtpSms = async (phone: string, code: string, ttlSeconds: number = 300): Promise<SendOtpResult> => {
  const config = getAliyunSmsConfig();
  if (!config) {
    console.log(`[sms] [STUB] 短信验证码: phone=${phone} code=${code} ttl=${ttlSeconds}s`);
    return { success: true, stub: true };
  }

  const params: Record<string, string> = {
    AccessKeyId: config.accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    SignName: config.signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomBytes(16).toString('hex'),
    SignatureVersion: '1.0',
    TemplateCode: config.otpTemplateCode,
    TemplateParam: JSON.stringify({ code, ttl: String(Math.floor(ttlSeconds / 60)) }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalized = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k]!)}`)
    .join('&');

  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  const signature = crypto
    .createHmac('sha1', `${config.accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');

  const queryString = `Signature=${percentEncode(signature)}&${canonicalized}`;
  const url = `${config.endpoint}/?${queryString}`;

  try {
    const response = await fetch(url);
    const data = (await response.json()) as { Code?: string; Message?: string; BizId?: string };
    if (data.Code !== 'OK') {
      return { success: false, error: `阿里云返回 ${data.Code}: ${data.Message}` };
    }
    return { success: true, messageId: data.BizId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `SMS 发送异常：${message}` };
  }
};
