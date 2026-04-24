import crypto from 'crypto';

const ITERATIONS_LOG = 15;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const hashPassword = (plaintext: string): string => {
  if (plaintext.length < 6) {
    throw new Error('密码长度不能少于 6 位');
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const derivedKey = crypto.scryptSync(plaintext, salt, KEY_LENGTH, { N: 2 ** ITERATIONS_LOG });
  return `scrypt$${ITERATIONS_LOG}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
};

export const verifyPassword = (plaintext: string, stored: string): boolean => {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const iterationsLog = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'base64');
  const expected = Buffer.from(parts[3]!, 'base64');

  if (!Number.isInteger(iterationsLog) || iterationsLog < 10 || iterationsLog > 20) return false;

  const derivedKey = crypto.scryptSync(plaintext, salt, expected.length, { N: 2 ** iterationsLog });

  if (derivedKey.length !== expected.length) return false;
  return crypto.timingSafeEqual(derivedKey, expected);
};
