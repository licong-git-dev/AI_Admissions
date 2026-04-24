import dotenv from 'dotenv';
dotenv.config({ path: 'server/.env' });
dotenv.config();

import { db } from '../src/db';
import { encryptJson } from './crypto-utils';
import { captureXiaohongshuLoginCookies } from './adapters/xiaohongshu';
import { captureDouyinLoginCookies } from './adapters/douyin';
import { captureKuaishouLoginCookies } from './adapters/kuaishou';
import { closeAllContexts } from './browser-manager';
import { logger } from './logger';
import type { AccountContext } from './task-types';

const args = process.argv.slice(2);
const accountIdArg = args[0];

if (!accountIdArg || !/^\d+$/.test(accountIdArg)) {
  console.error('用法: tsx server/worker/login-cli.ts <accountId>');
  console.error('  <accountId>: rpa_accounts 表中的账号 ID');
  process.exit(1);
}

const accountId = Number(accountIdArg);

type AccountRow = {
  id: number;
  platform: 'xiaohongshu' | 'douyin' | 'kuaishou';
  nickname: string;
  device_fingerprint: string | null;
  cookies_json: string | null;
};

const main = async (): Promise<void> => {
  const account = db.prepare(`SELECT * FROM rpa_accounts WHERE id = ?`).get(accountId) as AccountRow | undefined;
  if (!account) {
    console.error(`账号 #${accountId} 不存在`);
    process.exit(1);
  }

  logger.info('login-cli', `即将为账号 ${account.platform}/${account.nickname} 启动扫码登录`);

  if (process.env.RPA_HEADLESS === undefined) {
    process.env.RPA_HEADLESS = 'false';
  }

  const ctx: AccountContext = {
    id: account.id,
    platform: account.platform,
    nickname: account.nickname,
    deviceFingerprint: account.device_fingerprint,
    cookiesJson: account.cookies_json,
  };

  let result: { success: boolean; cookies?: unknown[]; message?: string };

  switch (account.platform) {
    case 'xiaohongshu':
      result = await captureXiaohongshuLoginCookies(ctx);
      break;
    case 'douyin':
      result = await captureDouyinLoginCookies(ctx);
      break;
    case 'kuaishou':
      result = await captureKuaishouLoginCookies(ctx);
      break;
    default:
      console.error(`平台 ${account.platform} 的登录流程尚未实现`);
      process.exit(1);
  }

  if (!result.success || !result.cookies) {
    console.error(`登录失败：${result.message || '未知错误'}`);
    await closeAllContexts();
    process.exit(1);
  }

  try {
    const encrypted = encryptJson(result.cookies);
    db.prepare(`UPDATE rpa_accounts SET cookies_json = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`).run(encrypted, account.id);
    logger.info('login-cli', 'cookies 已加密并写入数据库', {
      accountId: account.id,
      cookieCount: result.cookies.length,
    });
    console.log(`✅ 账号 ${account.nickname} 登录完成，cookies 已加密存入`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`cookies 加密存储失败：${message}`);
    process.exit(1);
  }

  await closeAllContexts();
  process.exit(0);
};

void main();
