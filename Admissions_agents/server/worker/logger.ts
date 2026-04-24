import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'server/logs');
const LOG_FILE = path.join(LOG_DIR, `rpa-${new Date().toISOString().slice(0, 10)}.log`);

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = 'info' | 'warn' | 'error';

const format = (level: LogLevel, scope: string, message: string, extra?: Record<string, unknown>): string => {
  const timestamp = new Date().toISOString();
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}${extraStr}`;
};

const write = (line: string): void => {
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`);
};

export const logger = {
  info: (scope: string, message: string, extra?: Record<string, unknown>): void => {
    write(format('info', scope, message, extra));
  },
  warn: (scope: string, message: string, extra?: Record<string, unknown>): void => {
    write(format('warn', scope, message, extra));
  },
  error: (scope: string, message: string, extra?: Record<string, unknown>): void => {
    write(format('error', scope, message, extra));
  },
};
