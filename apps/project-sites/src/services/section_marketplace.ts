/**
 * Vertical Section Marketplace (#8) — curated bento sections per industry.
 *
 * Serves the D1 `section_marketplace` table populated by migration 0506.
 * 5 industries × 6 slots = 30 seed entries. Admins and future creators can add more.
 *
 * Flag: `section_marketplace` (experimental, enabled=0, rollout=0).
 *
 * @example
 * ```ts
 * const sections = await listSectionsByIndustry(env, 'nonprofit');
 * // Returns hero/services/testimonials/donor-wall/faq/cta variants
 * ```
 */

import type { Env } from '../types/env.js';

export type SectionIndustry = 'nonprofit' | 'restaurant' | 'lawyer' | 'salon' | 'medical';
export type SectionSlot = 'hero' | 'services' | 'testimonials' | 'donor-wall' | 'faq' | 'cta';

export interface SectionVariant {
  id: string;
  industry: SectionIndustry;
  name: string;
  slot: SectionSlot;
  html_template: string;
  css_template: string;
  data_schema: object;
  quality_score: number;
  author: string;
  fork_count: number;
  created_at: string;
  updated_at: string;
}

export interface SectionVariantSummary {
  id: string;
  industry: SectionIndustry;
  name: string;
  slot: SectionSlot;
  quality_score: number;
  author: string;
  fork_count: number;
  data_schema_fields: string[];
}

function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** List all section variants, optionally filtered by industry and/or slot. */
export async function listSectionsByIndustry(
  env: Env,
  industry?: string,
  slot?: string,
  limit = 50,
): Promise<SectionVariantSummary[]> {
  let sql = 'SELECT id, industry, name, slot, quality_score, author, fork_count, data_schema FROM section_marketplace WHERE deleted_at IS NULL';
  const params: string[] = [];

  if (industry) {
    sql += ' AND industry = ?';
    params.push(industry);
  }
  if (slot) {
    sql += ' AND slot = ?';
    params.push(slot);
  }

  sql += ' ORDER BY quality_score DESC LIMIT ?';
  params.push(String(limit));

  const rows = await env.DB.prepare(sql)
    .bind(...params)
    .all<{ id: string; industry: string; name: string; slot: string; quality_score: number; author: string; fork_count: number; data_schema: string }>()
    .catch(() => ({ results: [] as Array<{ id: string; industry: string; name: string; slot: string; quality_score: number; author: string; fork_count: number; data_schema: string }> }));

  return (rows.results ?? []).map((r) => ({
    id: r.id,
    industry: r.industry as SectionIndustry,
    name: r.name,
    slot: r.slot as SectionSlot,
    quality_score: r.quality_score,
    author: r.author,
    fork_count: r.fork_count,
    data_schema_fields: extractSchemaFields(r.data_schema),
  }));
}

/** Get full section detail including template HTML/CSS. */
export async function getSectionVariant(env: Env, id: string): Promise<SectionVariant | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM section_marketplace WHERE id = ? AND deleted_at IS NULL',
  ).bind(id)
    .first<{ id: string; industry: string; name: string; slot: string; html_template: string; css_template: string; data_schema: string; quality_score: number; author: string; fork_count: number; created_at: string; updated_at: string }>()
    .catch(() => null);
  if (!row) return null;
  return {
    ...row,
    industry: row.industry as SectionIndustry,
    slot: row.slot as SectionSlot,
    data_schema: safeJsonParse(row.data_schema, {}),
  };
}

/** Increment fork_count on a section. */
export async function forkSection(env: Env, id: string): Promise<{ id: string; fork_count: number }> {
  await env.DB.prepare(
    'UPDATE section_marketplace SET fork_count = fork_count + 1, updated_at = ? WHERE id = ?',
  ).bind(new Date().toISOString(), id).run().catch(() => {});
  const row = await env.DB.prepare('SELECT id, fork_count FROM section_marketplace WHERE id = ?')
    .bind(id)
    .first<{ id: string; fork_count: number }>()
    .catch(() => null);
  return { id, fork_count: row?.fork_count ?? 0 };
}

/** Return industry catalog — available industries + section counts. */
export async function getMarketplaceCatalog(env: Env): Promise<{ industry: string; section_count: number; slots: string[] }[]> {
  const rows = await env.DB.prepare(
    `SELECT industry, COUNT(*) AS section_count, GROUP_CONCAT(DISTINCT slot) AS slots
     FROM section_marketplace WHERE deleted_at IS NULL
     GROUP BY industry ORDER BY section_count DESC`,
  ).all<{ industry: string; section_count: number; slots: string }>()
    .catch(() => ({ results: [] as Array<{ industry: string; section_count: number; slots: string }> }));

  return (rows.results ?? []).map((r) => ({
    industry: r.industry,
    section_count: r.section_count,
    slots: (r.slots ?? '').split(',').filter(Boolean),
  }));
}

/** Helper — extract required property keys from a JSON-Schema string. */
function extractSchemaFields(schemaStr: string): string[] {
  const schema = safeJsonParse<{ properties?: Record<string, unknown>; required?: string[] }>(schemaStr, {});
  return schema.required ?? Object.keys(schema.properties ?? {});
}
