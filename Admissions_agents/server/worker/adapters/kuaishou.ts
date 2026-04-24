import { logger } from '../logger';
import { getAccountContext } from '../browser-manager';
import { decryptJson } from '../crypto-utils';
import type {
  AccountContext,
  FetchDmPayload,
  FetchDmResult,
  FetchedDm,
  PublishPayload,
  PublishResult,
} from '../task-types';

const PUBLISH_URL = 'https://cp.kuaishou.com/article/publish/video';
const INBOX_URL = 'https://cp.kuaishou.com/profile/setting/user/info';
const LOGIN_CHECK_URL = 'https://cp.kuaishou.com';

const humanDelay = async (minMs = 500, maxMs = 2000): Promise<void> => {
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise((resolve) => setTimeout(resolve, delay));
};

const parseCookies = (cookiesJson: string | null): unknown[] | null => {
  if (!cookiesJson) return null;
  try {
    return decryptJson<unknown[]>(cookiesJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('kuaishou', '解密 cookies 失败', { error: message });
    return null;
  }
};

export async function publishToKuaishou(
  account: AccountContext,
  payload: PublishPayload
): Promise<PublishResult> {
  logger.info('kuaishou', '开始发布任务', {
    accountId: account.id,
    nickname: account.nickname,
    title: payload.title.slice(0, 50),
  });

  const cookies = parseCookies(account.cookiesJson);
  if (!cookies) {
    return { success: false, message: '账号未登录' };
  }

  const ctx = await getAccountContext({
    accountId: account.id,
    cookies,
    deviceFingerprint: account.deviceFingerprint,
    storageOriginUrl: LOGIN_CHECK_URL,
  });

  if (!ctx) {
    return { success: false, message: 'Playwright 未安装，发布器运行在 stub 模式' };
  }

  const { page } = ctx;

  try {
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 4000);

    const loggedIn = await page.locator('text=/发布作品|上传视频|创作者服务/').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!loggedIn) {
      return { success: false, message: '登录态已失效，请重新登录账号' };
    }

    await page.locator('text=/图文|文章/').first().click({ timeout: 5000 }).catch(() => null);
    await humanDelay();

    const titleSelector = 'input[placeholder*="标题"], input[class*="title"]';
    await page.locator(titleSelector).first().fill(payload.title);
    await humanDelay();

    const contentSelector = 'div[contenteditable="true"], textarea';
    await page.locator(contentSelector).first().fill(payload.content);
    await humanDelay();

    if (process.env.RPA_AUTO_SUBMIT === 'true') {
      await humanDelay(3000, 6000);
      await page.locator('button:has-text("发布")').first().click({ timeout: 5000 });
      await humanDelay(3000, 5000);
      return { success: true, message: '快手作品已提交' };
    }

    return {
      success: false,
      message: 'RPA_AUTO_SUBMIT 未启用，快手内容已填入但未点击发布',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('kuaishou', '发布异常', { accountId: account.id, error: message });
    return { success: false, message: `发布异常：${message}` };
  }
}

export async function fetchDmFromKuaishou(
  account: AccountContext,
  _payload: FetchDmPayload
): Promise<{ result: FetchDmResult; messages: FetchedDm[] }> {
  const cookies = parseCookies(account.cookiesJson);
  if (!cookies) {
    return {
      result: { success: false, fetched: 0, leadCreated: 0, message: '账号未登录' },
      messages: [],
    };
  }

  const ctx = await getAccountContext({
    accountId: account.id,
    cookies,
    deviceFingerprint: account.deviceFingerprint,
    storageOriginUrl: LOGIN_CHECK_URL,
  });

  if (!ctx) {
    return {
      result: { success: false, fetched: 0, leadCreated: 0, message: 'Playwright 未安装' },
      messages: [],
    };
  }

  const { page } = ctx;
  const messages: FetchedDm[] = [];

  try {
    await page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 4000);

    await page.locator('text=/消息中心|私信/').first().click({ timeout: 5000 }).catch(() => null);
    await humanDelay(2000);

    const rawItems = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[class*="msg"], [class*="message-item"], .chat-item');
      return Array.from(nodes)
        .slice(0, 50)
        .map((node, idx) => {
          const el = node as HTMLElement;
          return {
            id: el.getAttribute('data-id') || el.getAttribute('data-msg-id') || `ks-${Date.now()}-${idx}`,
            sender: (el.querySelector('.nickname, .user-name, .name, .sender') as HTMLElement | null)?.innerText?.trim() || '未知用户',
            content: (el.querySelector('.content, .last-msg, .text, .msg-text') as HTMLElement | null)?.innerText?.trim() || '',
          };
        });
    });

    for (const item of rawItems) {
      if (!item.content) continue;
      messages.push({
        platformMsgId: item.id,
        senderNickname: item.sender,
        content: item.content,
        msgType: 'dm',
        fetchedAt: new Date().toISOString(),
      });
    }

    return {
      result: { success: true, fetched: messages.length, leadCreated: 0 },
      messages,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('kuaishou', '抓取异常', { accountId: account.id, error: message });
    return {
      result: { success: false, fetched: 0, leadCreated: 0, message: `抓取异常：${message}` },
      messages,
    };
  }
}

export async function captureKuaishouLoginCookies(
  account: AccountContext
): Promise<{ success: boolean; cookies?: unknown[]; message?: string }> {
  const ctx = await getAccountContext({
    accountId: account.id,
    cookies: null,
    deviceFingerprint: account.deviceFingerprint,
    storageOriginUrl: LOGIN_CHECK_URL,
  });

  if (!ctx) {
    return { success: false, message: 'Playwright 未安装' };
  }

  const { page, context } = ctx;

  try {
    await page.goto(LOGIN_CHECK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    logger.info('kuaishou', '请扫码登录快手创作者中心，最多等待 3 分钟', { accountId: account.id });

    const loggedIn = await page
      .locator('text=/创作中心|首页|发布作品|数据中心/')
      .first()
      .isVisible({ timeout: 180_000 })
      .catch(() => false);

    if (!loggedIn) {
      return { success: false, message: '扫码超时或登录失败' };
    }

    const cookies = await context.cookies();
    return { success: true, cookies };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `登录异常：${message}` };
  }
}
