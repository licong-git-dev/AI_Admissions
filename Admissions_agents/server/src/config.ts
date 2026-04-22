import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });
dotenv.config();

const parsePort = (value: string | undefined, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

export const config = {
  port: parsePort(process.env.PORT, 8787),
  nodeEnv: process.env.NODE_ENV || 'production',
  enableDbSeed: process.env.ENABLE_DB_SEED === 'true',
  portalStudentLeadId: parsePort(process.env.PORTAL_STUDENT_LEAD_ID, 3),
  portalAccessToken: process.env.PORTAL_ACCESS_TOKEN || '',
  dbPath: process.env.DB_PATH || 'server/data/admissions.db',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};
