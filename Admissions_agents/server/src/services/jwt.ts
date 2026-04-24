import crypto from 'crypto';

const ALG = 'HS256';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export type JwtPayload = {
  sub: number;
  username: string;
  role: 'admin' | 'tenant_admin' | 'specialist' | 'student';
  name: string;
  tenant: string;
  kind?: 'user' | 'student';
  leadId?: number;
  phone?: string;
  iat?: number;
  exp?: number;
};

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/=+$/g, '').replaceAll('+', '-').replaceAll('/', '_');

const b64urlDecode = (str: string): Buffer => {
  const padded = str.replaceAll('-', '+').replaceAll('_', '/');
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64');
};

const getSecret = (): Buffer => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET 未配置或长度不足 16');
  }
  return Buffer.from(secret, 'utf8');
};

export const signJwt = (payload: JwtPayload, ttlSeconds: number = DEFAULT_TTL_SECONDS): string => {
  const header = { alg: ALG, typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat, exp: iat + ttlSeconds };

  const headerPart = b64url(Buffer.from(JSON.stringify(header), 'utf8'));
  const payloadPart = b64url(Buffer.from(JSON.stringify(fullPayload), 'utf8'));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = crypto.createHmac('sha256', getSecret()).update(signingInput).digest();
  return `${signingInput}.${b64url(signature)}`;
};

export const verifyJwt = (token: string): JwtPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = crypto.createHmac('sha256', getSecret()).update(signingInput).digest();
  const provided = b64urlDecode(signaturePart);

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8')) as JwtPayload;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};
