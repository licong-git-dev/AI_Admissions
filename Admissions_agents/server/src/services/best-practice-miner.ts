/**
 * 最佳实践数据飞轮（v3.7.a）
 *
 * 从 content_items / followups / deals 这些"运营事实"里挖掘 top N，
 * 写入 best_practices 表，AI 生成时拉来当 few-shot。
 *
 * 三个 kind：
 * - content_top：内容工厂里 (views * 0.3 + leads * 5 + conversions * 20) 排前 N
 * - script_top：导致最终 enrolled 的 followup 内容
 * - mission_goal_top：成功率高的 mission 模板配置
 *
 * 设计要点：
 * - UNIQUE(kind, source_id)：同一条数据多次打分会 UPSERT
 * - 每周一凌晨 03:00 跑一次（cheap 操作）
 * - 评分 < 阈值或失活的自动 is_active=0
 * - 数据全平台共享（tenant='platform'），新租户开箱即享
 */

import { db } from '../db';

const TOP_N_PER_KIND = 20;

type MinedRow = {
  kind: string;
  sourceId: number | null;
  title: string | null;
  excerpt: string;
  metricViews: number;
  metricLeads: number;
  metricConversions: number;
  score: number;
  metadata: Record<string, unknown>;
};

const upsert = (row: MinedRow): void => {
  db.prepare(`
    INSERT INTO best_practices (
      tenant, kind, source_id, title, excerpt,
      metric_views, metric_leads, metric_conversions, score, metadata_json,
      is_active, last_scored_at
    ) VALUES ('platform', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(kind, source_id) DO UPDATE SET
      title = excluded.title,
      excerpt = excluded.excerpt,
      metric_views = excluded.metric_views,
      metric_leads = excluded.metric_leads,
      metric_conversions = excluded.metric_conversions,
      score = excluded.score,
      metadata_json = excluded.metadata_json,
      is_active = 1,
      last_scored_at = datetime('now')
  `).run(
    row.kind, row.sourceId, row.title, row.excerpt,
    row.metricViews, row.metricLeads, row.metricConversions, row.score,
    JSON.stringify(row.metadata)
  );
};

const deactivateOutOfTop = (kind: string, keepIds: number[]): number => {
  if (keepIds.length === 0) {
    const result = db.prepare(`UPDATE best_practices SET is_active = 0 WHERE kind = ? AND is_active = 1`).run(kind);
    return result.changes;
  }
  const placeholders = keepIds.map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE best_practices SET is_active = 0
     WHERE kind = ? AND is_active = 1 AND source_id NOT IN (${placeholders})`
  ).run(kind, ...keepIds);
  return result.changes;
};

const mineTopContent = (): number => {
  type ContentRow = {
    id: number;
    title: string;
    body: string;
    platform: string;
    views: number;
    likes: number;
    leads: number;
  };
  // 仅消费已发布、有真实数据的内容
  const rows = db.prepare(`
    SELECT id, title, body, platform, views, likes, leads
    FROM content_items
    WHERE status = 'published' AND views > 0
  `).all() as ContentRow[];

  // 转化估算：按 leads 数算近似（缺 deals 关联表的话）
  type DealAttribution = { content_id: number; conversions: number };
  const conversionsMap = new Map<number, number>();
  // 简化：以 leads 字段近似 conversions
  // （未来可接 lead.source_account_id / 内容投放归因）

  const scored = rows.map((c) => {
    const views = c.views;
    const leads = c.leads;
    const conversions = conversionsMap.get(c.id) ?? Math.max(0, Math.floor(leads * 0.2));
    const score = views * 0.3 + leads * 5 + conversions * 20;
    return { c, score, conversions };
  }).sort((a, b) => b.score - a.score);

  const top = scored.slice(0, TOP_N_PER_KIND);
  for (const item of top) {
    upsert({
      kind: 'content_top',
      sourceId: item.c.id,
      title: item.c.title,
      excerpt: (item.c.body || '').slice(0, 400),
      metricViews: item.c.views,
      metricLeads: item.c.leads,
      metricConversions: item.conversions,
      score: Math.round(item.score),
      metadata: { platform: item.c.platform },
    });
  }
  deactivateOutOfTop('content_top', top.map((x) => x.c.id));
  return top.length;
};

const mineTopScripts = (): number => {
  // 从 followups 里找：那些 lead 最终 enrolled 的 followup 内容
  // 取每条 enrolled lead 的最后 1 条 followup 当作"成单话术"
  type ScriptRow = {
    id: number;
    lead_id: number;
    content: string;
    channel: string;
    nickname: string;
  };
  const rows = db.prepare(`
    SELECT f.id, f.lead_id, f.content, f.channel, l.nickname
    FROM followups f
    JOIN leads l ON l.id = f.lead_id
    JOIN (
      SELECT lead_id, MAX(id) as max_id
      FROM followups
      GROUP BY lead_id
    ) latest ON latest.max_id = f.id
    WHERE l.status = 'enrolled'
      AND length(f.content) >= 20
      AND length(f.content) <= 400
  `).all() as ScriptRow[];

  // 评分：内容长度归一化 + 句号数量（结构化）+ 是否包含数字（具体）
  const scored = rows.map((r) => {
    const lengthScore = Math.min(50, Math.floor(r.content.length / 5));
    const punctuationScore = (r.content.match(/[，。！？]/g) ?? []).length * 3;
    const hasNumber = /\d/.test(r.content) ? 10 : 0;
    const score = lengthScore + punctuationScore + hasNumber;
    return { r, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored.slice(0, TOP_N_PER_KIND);
  for (const item of top) {
    upsert({
      kind: 'script_top',
      sourceId: item.r.id,
      title: `${item.r.nickname} · 成单话术`,
      excerpt: item.r.content.slice(0, 400),
      metricViews: 0,
      metricLeads: 0,
      metricConversions: 1,
      score: Math.round(item.score),
      metadata: { channel: item.r.channel, leadId: item.r.lead_id },
    });
  }
  deactivateOutOfTop('script_top', top.map((x) => x.r.id));
  return top.length;
};

export const runBestPracticeMining = (): { content: number; script: number } => {
  const content = mineTopContent();
  const script = mineTopScripts();
  return { content, script };
};

// 读取接口：拿当前活跃的 top N，给 AI prompt 注入
export type BestPractice = {
  kind: string;
  title: string | null;
  excerpt: string;
  metricViews: number;
  metricLeads: number;
  metricConversions: number;
  score: number;
};

export const getActiveBestPractices = (kind: string, limit = 5): BestPractice[] => {
  type Row = {
    kind: string;
    title: string | null;
    excerpt: string;
    metric_views: number;
    metric_leads: number;
    metric_conversions: number;
    score: number;
  };
  const rows = db.prepare(`
    SELECT kind, title, excerpt, metric_views, metric_leads, metric_conversions, score
    FROM best_practices
    WHERE kind = ? AND is_active = 1
    ORDER BY score DESC
    LIMIT ?
  `).all(kind, limit) as Row[];
  return rows.map((r) => ({
    kind: r.kind,
    title: r.title,
    excerpt: r.excerpt,
    metricViews: r.metric_views,
    metricLeads: r.metric_leads,
    metricConversions: r.metric_conversions,
    score: r.score,
  }));
};

// 给 prompt 注入用：把 top N 拼成 Markdown few-shot
export const buildFewShotBlock = (kind: string, limit = 3): string => {
  const items = getActiveBestPractices(kind, limit);
  if (items.length === 0) return '';
  const heading = kind === 'content_top'
    ? '【平台沉淀的 top 爆款内容（仅供风格参考，不要照抄）】'
    : '【平台沉淀的 top 成单话术（仅供风格参考，不要照抄）】';
  const lines = [heading];
  items.forEach((it, idx) => {
    lines.push(`${idx + 1}. ${it.title ?? '（无标题）'}`);
    lines.push(`   ${it.excerpt.slice(0, 240)}`);
    lines.push(`   数据：浏览 ${it.metricViews} / 线索 ${it.metricLeads} / 转化 ${it.metricConversions}`);
  });
  return lines.join('\n');
};
