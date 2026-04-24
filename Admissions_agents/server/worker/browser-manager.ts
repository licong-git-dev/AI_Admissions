import { logger } from './logger';
// playwright 为 optionalDependency，未安装时整个模块降级到 stub
// @ts-ignore - playwright 可能未安装（optionalDependency）
import type { Browser, BrowserContext, Page } from 'playwright';

// @ts-ignore - playwright 可能未安装（optionalDependency）
type PlaywrightModule = typeof import('playwright');

let playwrightCache: PlaywrightModule | null | false = null;

export const loadPlaywright = async (): Promise<PlaywrightModule | null> => {
  if (playwrightCache === false) {
    return null;
  }
  if (playwrightCache) {
    return playwrightCache;
  }

  try {
    // @ts-ignore - playwright 可能未安装
    const mod = (await import('playwright')) as PlaywrightModule;
    playwrightCache = mod;
    logger.info('browser', 'Playwright 已加载');
    return mod;
  } catch (error) {
    playwrightCache = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('browser', 'Playwright 未安装，Worker 将进入 stub 模式', { message });
    return null;
  }
};

type ContextEntry = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
};

const contextPool = new Map<number, ContextEntry>();

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
];

const pickViewport = (fingerprint: string | null): { width: number; height: number } => {
  if (!fingerprint) {
    return VIEWPORTS[0]!;
  }
  const hash = Array.from(fingerprint).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return VIEWPORTS[hash % VIEWPORTS.length]!;
};

export type AccountBrowserContext = {
  accountId: number;
  context: BrowserContext;
  page: Page;
};

export const getAccountContext = async (params: {
  accountId: number;
  cookies: unknown[] | null;
  deviceFingerprint: string | null;
  storageOriginUrl: string;
}): Promise<AccountBrowserContext | null> => {
  const playwright = await loadPlaywright();
  if (!playwright) {
    return null;
  }

  const existing = contextPool.get(params.accountId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return { accountId: params.accountId, context: existing.context, page: existing.page };
  }

  const viewport = pickViewport(params.deviceFingerprint);
  const browser = await playwright.chromium.launch({
    headless: process.env.RPA_HEADLESS !== 'false',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: DEFAULT_UA,
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  if (params.cookies && Array.isArray(params.cookies) && params.cookies.length > 0) {
    try {
      await context.addCookies(params.cookies as Parameters<BrowserContext['addCookies']>[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('browser', '恢复 cookies 失败', { accountId: params.accountId, error: message });
    }
  }

  const page = await context.newPage();

  contextPool.set(params.accountId, {
    browser,
    context,
    page,
    lastUsedAt: Date.now(),
  });

  logger.info('browser', '创建浏览器上下文', {
    accountId: params.accountId,
    viewport,
    hasCookies: Boolean(params.cookies),
  });

  return { accountId: params.accountId, context, page };
};

export const releaseAccountContext = async (accountId: number): Promise<void> => {
  const entry = contextPool.get(accountId);
  if (!entry) {
    return;
  }

  try {
    await entry.page.close();
    await entry.context.close();
    await entry.browser.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('browser', '关闭浏览器失败', { accountId, error: message });
  } finally {
    contextPool.delete(accountId);
  }
};

export const cleanupIdleContexts = async (idleMs: number = 10 * 60 * 1000): Promise<void> => {
  const now = Date.now();
  for (const [accountId, entry] of contextPool.entries()) {
    if (now - entry.lastUsedAt > idleMs) {
      await releaseAccountContext(accountId);
      logger.info('browser', '回收空闲浏览器', { accountId });
    }
  }
};

export const closeAllContexts = async (): Promise<void> => {
  const ids = Array.from(contextPool.keys());
  await Promise.all(ids.map((id) => releaseAccountContext(id)));
};
