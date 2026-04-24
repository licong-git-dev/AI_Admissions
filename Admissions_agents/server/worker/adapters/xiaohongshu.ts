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

export type { AccountContext, PublishPayload, PublishResult } from '../task-types';

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official';
const INBOX_URL = 'https://creator.xiaohongshu.com/creator/notice/messageList';
const LOGIN_CHECK_URL = 'https://creator.xiaohongshu.com';

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
    logger.warn('xiaohongshu', '解密 cookies 失败', { error: message });
    return null;
  }
};

export async function publishToXiaohongshu(
  account: AccountContext,
  payload: PublishPayload
): Promise<PublishResult> {
  logger.info('xiaohongshu', '开始发布任务', {
    accountId: account.id,
    nickname: account.nickname,
    title: payload.title.slice(0, 50),
  });

  const cookies = parseCookies(account.cookiesJson);
  if (!cookies) {
    return {
      success: false,
      message: '账号未登录，请先在「AI 获客 → 发布矩阵」完成登录并上传 cookies',
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
      success: false,
      message: 'Playwright 未安装，发布器运行在 stub 模式。部署环境需执行 `npm install && npx playwright install chromium`',
    };
  }

  const { page } = ctx;

  try {
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 4000);

    const loggedIn = await page.locator('text=发布笔记').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!loggedIn) {
      return {
        success: false,
        message: '登录态已失效，请重新登录账号',
      };
    }

    await page.locator('text=上传图文').first().click({ timeout: 5000 }).catch(() => null);
    await humanDelay();

    const titleSelector = 'input[placeholder*="标题"], input[placeholder*="title"]';
    await page.locator(titleSelector).first().fill(payload.title);
    await humanDelay();

    const contentSelector = 'div[contenteditable="true"], textarea[placeholder*="正文"]';
    await page.locator(contentSelector).first().fill(payload.content);
    await humanDelay();

    if (payload.tags && payload.tags.length > 0) {
      for (const tag of payload.tags) {
        await page.keyboard.type(`#${tag} `);
        await humanDelay(200, 600);
      }
    }

    logger.info('xiaohongshu', '内容填充完成，等待人工确认或自动发布', {
      accountId: account.id,
      autoSubmit: process.env.RPA_AUTO_SUBMIT === 'true',
    });

    if (process.env.RPA_AUTO_SUBMIT === 'true') {
      await humanDelay(3000, 6000);
      await page.locator('button:has-text("发布")').first().click({ timeout: 5000 });
      await humanDelay(3000, 5000);

      const successIndicator = await page
        .locator('text=/发布成功|已发布|发布中/')
        .first()
        .isVisible({ timeout: 10000 })
        .catch(() => false);

      if (!successIndicator) {
        return {
          success: false,
          message: '发布按钮已点击，但未检测到成功提示。请人工确认。',
        };
      }
    } else {
      return {
        success: false,
        message: 'RPA_AUTO_SUBMIT 未启用，内容已填入但未点击发布。请在浏览器中人工确认后发布。',
      };
    }

    return {
      success: true,
      message: '小红书笔记发布成功',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('xiaohongshu', '发布异常', { accountId: account.id, error: message });
    return { success: false, message: `发布异常：${message}` };
  }
}

export async function fetchDmFromXiaohongshu(
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
      result: { success: false, fetched: 0, leadCreated: 0, message: 'Playwright 未安装，当前为 stub 模式' },
      messages: [],
    };
  }

  const { page } = ctx;
  const messages: FetchedDm[] = [];

  try {
    await page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 4000);

    const rawItems = await page.evaluate(() => {
      const nodes = document.querySelectorAll('[data-msg-id], .msg-item, .notice-item');
      return Array.from(nodes)
        .slice(0, 50)
        .map((node) => {
          const el = node as HTMLElement;
          return {
            id: el.getAttribute('data-msg-id') || el.getAttribute('data-id') || `${Date.now()}-${Math.random()}`,
            sender: (el.querySelector('.sender, .nickname, .user-name') as HTMLElement | null)?.innerText?.trim() || '未知用户',
            content: (el.querySelector('.content, .msg-content, .text') as HTMLElement | null)?.innerText?.trim() || '',
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

    logger.info('xiaohongshu', `抓取到 ${messages.length} 条私信`, { accountId: account.id });

    return {
      result: { success: true, fetched: messages.length, leadCreated: 0 },
      messages,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('xiaohongshu', '抓取异常', { accountId: account.id, error: message });
    return {
      result: { success: false, fetched: 0, leadCreated: 0, message: `抓取异常：${message}` },
      messages,
    };
  }
}

export async function captureXiaohongshuLoginCookies(
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

    logger.info('xiaohongshu', '请在打开的浏览器中扫码登录，最多等待 3 分钟', {
      accountId: account.id,
    });

    const loggedIn = await page
      .locator('text=/首页|创作中心|发布笔记/')
      .first()
      .isVisible({ timeout: 180_000 })
      .catch(() => false);

    if (!loggedIn) {
      return { success: false, message: '扫码超时或登录失败' };
    }

    const cookies = await context.cookies();
    logger.info('xiaohongshu', '登录成功，cookies 已采集', {
      accountId: account.id,
      cookieCount: cookies.length,
    });

    return { success: true, cookies };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `登录异常：${message}` };
  }
}
