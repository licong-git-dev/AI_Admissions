import { db } from '../src/db';
import { logger } from './logger';
import { getAccountContext } from './browser-manager';
import { decryptJson } from './crypto-utils';

type RpaAccountRow = {
  id: number;
  platform: 'xiaohongshu' | 'douyin' | 'kuaishou';
  nickname: string;
  status: string;
  cookies_json: string | null;
  device_fingerprint: string | null;
  risk_note: string | null;
};

const LOGIN_CHECK_URLS: Record<RpaAccountRow['platform'], string> = {
  xiaohongshu: 'https://creator.xiaohongshu.com',
  douyin: 'https://creator.douyin.com',
  kuaishou: 'https://cp.kuaishou.com',
};

const LOGGED_IN_INDICATORS: Record<RpaAccountRow['platform'], RegExp> = {
  xiaohongshu: /创作中心|发布笔记|首页|数据/,
  douyin: /创作中心|发布作品|首页|数据中心/,
  kuaishou: /创作中心|发布作品|数据|首页/,
};

const parseCookies = (cookiesJson: string | null): unknown[] | null => {
  if (!cookiesJson) return null;
  try {
    return decryptJson<unknown[]>(cookiesJson);
  } catch {
    return null;
  }
};

const checkAccount = async (account: RpaAccountRow): Promise<{
  healthy: boolean;
  reason: string;
  nextStatus?: string;
}> => {
  const cookies = parseCookies(account.cookies_json);
  if (!cookies) {
    return { healthy: false, reason: '无有效 cookies，需要重新登录', nextStatus: 'cooldown' };
  }

  const ctx = await getAccountContext({
    accountId: account.id,
    cookies,
    deviceFingerprint: account.device_fingerprint,
    storageOriginUrl: LOGIN_CHECK_URLS[account.platform],
  });

  if (!ctx) {
    return { healthy: false, reason: 'Playwright 未安装，跳过健康检查' };
  }

  const { page } = ctx;

  try {
    await page.goto(LOGIN_CHECK_URLS[account.platform], { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const indicator = LOGGED_IN_INDICATORS[account.platform];
    const loggedIn = await page.locator(`text=${indicator}`).first().isVisible({ timeout: 8000 }).catch(() => false);

    if (!loggedIn) {
      return { healthy: false, reason: '登录态已失效（检测不到登录后元素）', nextStatus: 'cooldown' };
    }

    return { healthy: true, reason: 'cookies 有效' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { healthy: false, reason: `健康检查异常：${message}` };
  }
};

export const runHealthCheckOnce = async (): Promise<{ checked: number; unhealthy: number }> => {
  const candidates = db.prepare(`
    SELECT id, platform, nickname, status, cookies_json, device_fingerprint, risk_note
    FROM rpa_accounts
    WHERE status = 'active' AND cookies_json IS NOT NULL
  `).all() as RpaAccountRow[];

  let checked = 0;
  let unhealthy = 0;

  for (const account of candidates) {
    checked += 1;
    const result = await checkAccount(account);

    if (!result.healthy) {
      unhealthy += 1;
      db.prepare(`
        UPDATE rpa_accounts
        SET status = COALESCE(?, status),
            risk_note = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(result.nextStatus ?? null, `健康检查未通过：${result.reason}`, account.id);
      logger.warn('health-check', '账号不健康', {
        accountId: account.id,
        platform: account.platform,
        reason: result.reason,
      });
    } else {
      db.prepare(`
        UPDATE rpa_accounts
        SET risk_note = NULL, updated_at = datetime('now')
        WHERE id = ? AND (risk_note IS NULL OR risk_note LIKE '健康检查%')
      `).run(account.id);
      logger.info('health-check', '账号正常', { accountId: account.id });
    }
  }

  return { checked, unhealthy };
};
