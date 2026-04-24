import { logger } from './logger';
import { db } from '../src/db';

type CrawlerSourceRow = {
  id: number;
  name: string;
  domain: string;
  type: string;
  frequency_hours: number;
  is_enabled: number;
  last_crawled_at: string | null;
};

type ExtractedItem = {
  title: string;
  url: string;
  summary?: string;
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; AdmissionsAgentBot/1.0; +https://example.com/bot) — 合规采集器，遵守 robots.txt';

const SOURCE_URLS: Record<string, string[]> = {
  'moe.gov.cn': [
    'https://www.moe.gov.cn/s78/A03/moe_560/',
    'https://www.moe.gov.cn/srcsite/A03/moe_2082/',
  ],
  'ynzs.cn': ['https://www.ynzs.cn/tzggInfo/'],
  'eeagd.edu.cn': ['https://eea.gd.gov.cn/ywdt/tzgg/'],
  'gdrtvu.edu.cn': ['https://www.ougd.cn/'],
  'scnu.edu.cn': ['https://jxjy.scnu.edu.cn/'],
};

const fetchWithTimeout = async (url: string, timeoutMs = 15_000): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const resolveUrl = (base: string, href: string): string => {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
};

const extractLinks = (html: string, baseUrl: string): ExtractedItem[] => {
  const items: ExtractedItem[] = [];
  const anchorPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1]!.trim();
    const rawText = match[2]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    if (!rawText || rawText.length < 6 || rawText.length > 200) continue;
    if (/^javascript:|^#|^mailto:/i.test(href)) continue;

    const url = resolveUrl(baseUrl, href);
    if (seen.has(url)) continue;
    seen.add(url);

    if (!/\b(?:通知|公告|招生|专升本|学历|政策|办法|简章|通告)\b/.test(rawText)) continue;

    items.push({ title: rawText, url });

    if (items.length >= 30) break;
  }

  return items;
};

const containsViolationWord = (text: string): boolean => {
  return /学生姓名|学生电话|考生信息|考生手机|联系方式.*\d{11}|身份证号/.test(text);
};

const getActiveSources = (): CrawlerSourceRow[] => {
  return db.prepare(`
    SELECT id, name, domain, type, frequency_hours, is_enabled, last_crawled_at
    FROM crawler_sources
    WHERE is_enabled = 1
    ORDER BY id ASC
  `).all() as CrawlerSourceRow[];
};

const isDueForCrawl = (source: CrawlerSourceRow): boolean => {
  if (!source.last_crawled_at) return true;
  const lastMs = new Date(source.last_crawled_at).getTime();
  const dueMs = lastMs + source.frequency_hours * 60 * 60 * 1000;
  return Date.now() >= dueMs;
};

const upsertItems = (sourceId: number, items: ExtractedItem[]): number => {
  let inserted = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO crawler_items (source_id, title, url, summary, crawled_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  for (const item of items) {
    if (containsViolationWord(item.title) || (item.summary && containsViolationWord(item.summary))) {
      logger.warn('crawler', '跳过疑似含个人信息的条目', { sourceId, title: item.title.slice(0, 40) });
      continue;
    }
    const result = insert.run(sourceId, item.title, item.url, item.summary ?? null);
    if (result.changes > 0) inserted += 1;
  }

  return inserted;
};

const touchSource = (sourceId: number): void => {
  db.prepare(`UPDATE crawler_sources SET last_crawled_at = datetime('now') WHERE id = ?`).run(sourceId);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const runCrawlOnce = async (): Promise<{ sourcesCrawled: number; itemsInserted: number }> => {
  const sources = getActiveSources();
  let sourcesCrawled = 0;
  let itemsInserted = 0;

  for (const source of sources) {
    if (!isDueForCrawl(source)) continue;

    const urls = SOURCE_URLS[source.domain];
    if (!urls || urls.length === 0) {
      logger.warn('crawler', '采集源未配置 URL 白名单，跳过', { sourceId: source.id, domain: source.domain });
      touchSource(source.id);
      continue;
    }

    const aggregated: ExtractedItem[] = [];
    for (const url of urls) {
      try {
        logger.info('crawler', '开始采集', { sourceId: source.id, url });
        const html = await fetchWithTimeout(url);
        const items = extractLinks(html, url);
        aggregated.push(...items);
        await sleep(10_000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('crawler', '单 URL 采集失败', { sourceId: source.id, url, error: message });
      }
    }

    const inserted = upsertItems(source.id, aggregated);
    touchSource(source.id);
    sourcesCrawled += 1;
    itemsInserted += inserted;

    logger.info('crawler', '完成一个采集源', {
      sourceId: source.id,
      domain: source.domain,
      fetched: aggregated.length,
      inserted,
    });
  }

  return { sourcesCrawled, itemsInserted };
};
