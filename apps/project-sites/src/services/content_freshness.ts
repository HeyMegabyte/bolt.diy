/**
 * @module services/content_freshness
 * @description Content Freshness Cron — feature #16.
 *
 * Daily scan identifies site sections idle >90 days with low average
 * dwell time (≤30s RUM median). For each candidate it fires a Workers AI
 * Llama 3.3 70B FP8 rewrite preserving brand voice from `_brand.json`,
 * persists a `content_rewrite_drafts` row, and posts a task to the owner's
 * `ai_task_inbox` so the admin sees "N freshness rewrites awaiting approval".
 *
 * Worker entry point: `scheduledContentFreshness` — wired to cron
 * `0 6 * * *` in `wrangler.toml`.
 *
 * Approve flow: `POST /api/content/freshness/approve/:draftId` publishes
 * the draft HTML to R2 at the section's canonical path.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from './db.js';
import { postAskUser } from './task_inbox.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

// ─── Constants ───────────────────────────────────────────────────────

const IDLE_DAYS_THRESHOLD = 90;
const DWELL_THRESHOLD_SECONDS = 30;
const MAX_SECTIONS_PER_RUN = 50; // guard against unbounded AI spend
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// ─── Types ────────────────────────────────────────────────────────────

export interface SectionCandidate {
  siteId: string;
  orgId: string;
  sectionKey: string;
  sectionHtmlOrig: string | null;
  dwellSecondsAvg: number;
  lastRewriteAt: string | null;
  idleDays: number;
}

export interface ContentRewriteDraft {
  id: string;
  siteId: string;
  orgId: string;
  sectionKey: string;
  sectionHtmlOrig: string | null;
  sectionHtmlDraft: string;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  taskInboxId: string | null;
  createdAt: string;
}

// ─── Candidate scanning ───────────────────────────────────────────────

/**
 * Returns sections from `sections_index` idle >90d with low dwell.
 *
 * Falls back gracefully when `sections_index` does not exist (table
 * missing in older D1 schemas) — returns empty array so the cron
 * does no harm.
 */
export async function scanStaleSections(env: Env): Promise<SectionCandidate[]> {
  const sql = `
    SELECT
      si.site_id                            AS siteId,
      s.org_id                              AS orgId,
      si.section_key                        AS sectionKey,
      si.section_html                       AS sectionHtmlOrig,
      COALESCE(si.dwell_seconds_avg, 0)     AS dwellSecondsAvg,
      si.last_rewrite_at                    AS lastRewriteAt,
      CAST(
        (julianday('now') - julianday(COALESCE(si.last_rewrite_at, si.created_at)))
        AS INTEGER
      )                                     AS idleDays
    FROM sections_index si
    JOIN sites s ON s.id = si.site_id
    WHERE si.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND s.status = 'published'
      AND CAST(
            (julianday('now') - julianday(COALESCE(si.last_rewrite_at, si.created_at)))
            AS INTEGER
          ) > ?
      AND COALESCE(si.dwell_seconds_avg, 0) <= ?
    ORDER BY idleDays DESC
    LIMIT ?
  `;

  try {
    const { data } = await dbQuery<SectionCandidate>(env.DB, sql, [
      IDLE_DAYS_THRESHOLD,
      DWELL_THRESHOLD_SECONDS,
      MAX_SECTIONS_PER_RUN,
    ]);
    return data;
  } catch {
    // Table doesn't exist yet — no-op silently.
    return [];
  }
}

// ─── Brand voice extraction ───────────────────────────────────────────

/**
 * Loads `_brand.json` from R2 for a site and extracts tone/voice hints.
 * Returns a compact string for injection into the AI system prompt.
 */
async function loadBrandVoice(env: Env, siteId: string): Promise<string> {
  try {
    // Find slug for R2 path
    const site = await dbQueryOne<{ slug: string }>(
      env.DB,
      'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
      [siteId],
    );
    if (!site) return 'Professional, clear, and trustworthy.';

    const r2Key = `sites/${site.slug}/latest/_brand.json`;
    const obj = await env.SITES_BUCKET.get(r2Key);
    if (!obj) return 'Professional, clear, and trustworthy.';

    const brand = (await obj.json()) as Record<string, unknown>;
    const tone = typeof brand.tone === 'string' ? brand.tone : '';
    const voice = typeof brand.voice === 'string' ? brand.voice : '';
    const personality = typeof brand.personality === 'string' ? brand.personality : '';
    return [tone, voice, personality].filter(Boolean).join('. ') || 'Professional, clear, and trustworthy.';
  } catch {
    return 'Professional, clear, and trustworthy.';
  }
}

// ─── AI rewrite ────────────────────────────────────────────────────────

/**
 * Calls Workers AI to rewrite a section, preserving brand voice.
 * Returns the rewritten HTML string.
 */
export async function rewriteSection(
  env: Env,
  candidate: SectionCandidate,
  brandVoice: string,
): Promise<{ html: string; tokensUsed: number }> {
  const original = candidate.sectionHtmlOrig ?? '<section><p>Content here.</p></section>';

  const systemPrompt = `You are a professional web copywriter.
Rewrite the provided HTML section to feel fresh and engaging.
Brand voice: ${brandVoice}
Rules:
- Keep ALL structural HTML tags and CSS classes intact
- Only change visible text content (not attribute names, IDs, or class values)
- Improve clarity and engagement
- Remove stale/dated language
- Keep the same approximate length (±20%)
- Return ONLY the HTML with no explanation or markdown wrapper`;

  const userPrompt = `Rewrite this website section HTML:\n\n${original.slice(0, 8000)}`;

  try {
    const response = await env.AI.run(AI_MODEL as Parameters<typeof env.AI.run>[0], {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2048,
    } as Parameters<typeof env.AI.run>[1]);

    const result = response as { response?: string; usage?: { total_tokens?: number } };
    const html = result.response ?? original;
    const tokensUsed = result.usage?.total_tokens ?? 0;
    return { html, tokensUsed };
  } catch {
    return { html: original, tokensUsed: 0 };
  }
}

// ─── Draft persistence ────────────────────────────────────────────────

/**
 * Inserts a `content_rewrite_drafts` row and posts a task-inbox item.
 */
export async function createRewriteDraft(
  env: Env,
  candidate: SectionCandidate,
  draftHtml: string,
  tokensUsed: number,
): Promise<string> {
  const id = crypto.randomUUID();

  await dbInsert(env.DB, 'content_rewrite_drafts', {
    id,
    site_id: candidate.siteId,
    org_id: candidate.orgId,
    section_key: candidate.sectionKey,
    section_html_orig: (candidate.sectionHtmlOrig ?? '').slice(0, 16384),
    section_html_draft: draftHtml.slice(0, 65536),
    dwell_seconds_avg: candidate.dwellSecondsAvg,
    last_rewrite_at: candidate.lastRewriteAt,
    idle_days: candidate.idleDays,
    ai_model: AI_MODEL,
    ai_tokens_used: tokensUsed,
    status: 'pending',
  });

  // Post task to owner inbox
  try {
    const task = await postAskUser(env, {
      orgId: candidate.orgId,
      taskKind: 'content_freshness_review',
      prompt: `Section "${candidate.sectionKey}" hasn't been refreshed in ${candidate.idleDays} days and has low engagement (avg ${Math.round(candidate.dwellSecondsAvg)}s dwell). An AI-rewritten draft is ready for your review.`,
      options: ['approve', 'reject'],
      defaultChoice: 'reject',
      timeoutMs: 7 * 24 * 60 * 60 * 1000, // 7-day window
      createdBy: 'content-freshness-cron',
    });

    await dbUpdate(
      env.DB,
      'content_rewrite_drafts',
      { task_inbox_id: task.id },
      'id = ?',
      [id],
    );
  } catch {
    // Task inbox failure is non-blocking — draft still created.
  }

  return id;
}

// ─── Approval + publish ───────────────────────────────────────────────

/**
 * Publishes an approved draft HTML to R2, replacing the live section.
 */
export async function publishRewriteDraft(
  env: Env,
  draftId: string,
  approvedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const draft = await dbQueryOne<{
    id: string;
    site_id: string;
    section_key: string;
    section_html_draft: string;
    status: string;
  }>(
    env.DB,
    `SELECT id, site_id, section_key, section_html_draft, status
     FROM content_rewrite_drafts
     WHERE id = ? AND deleted_at IS NULL`,
    [draftId],
  );

  if (!draft) return { ok: false, error: 'Draft not found' };
  if (draft.status !== 'pending') return { ok: false, error: `Draft already ${draft.status}` };

  // Get site slug for R2 path
  const site = await dbQueryOne<{ slug: string }>(
    env.DB,
    'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
    [draft.site_id],
  );
  if (!site) return { ok: false, error: 'Site not found' };

  const r2Key = `sites/${site.slug}/sections/${draft.section_key}.html`;

  try {
    await env.SITES_BUCKET.put(r2Key, draft.section_html_draft, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
  } catch (err) {
    return { ok: false, error: `R2 write failed: ${String(err)}` };
  }

  const now = new Date().toISOString();
  await dbUpdate(
    env.DB,
    'content_rewrite_drafts',
    { status: 'published', approved_by: approvedBy, approved_at: now, published_at: now, r2_path: r2Key },
    'id = ?',
    [draftId],
  );

  // Update sections_index last_rewrite_at
  try {
    await dbUpdate(
      env.DB,
      'sections_index',
      { last_rewrite_at: now },
      'site_id = ? AND section_key = ?',
      [draft.site_id, draft.section_key],
    );
  } catch {
    /* sections_index may not have last_rewrite_at in older schemas */
  }

  return { ok: true };
}

// ─── Scheduled handler ────────────────────────────────────────────────

/**
 * Entry point for `scheduled` event (cron `0 6 * * *`).
 *
 * Scans stale sections, generates AI rewrites, persists drafts, posts
 * inbox tasks. Stops at `MAX_SECTIONS_PER_RUN` regardless of backlog.
 */
export async function scheduledContentFreshness(env: Env): Promise<void> {
  // Gate on feature flag — off by default
  const flagOn = await isFlagOn(env, 'content_freshness');
  if (!flagOn) {
    console.warn('[content-freshness] flag off — skipping run');
    return;
  }

  const candidates = await scanStaleSections(env);
  if (candidates.length === 0) {
    console.warn('[content-freshness] no stale sections found');
    return;
  }

  console.warn(`[content-freshness] processing ${candidates.length} candidates`);

  for (const candidate of candidates) {
    try {
      const brandVoice = await loadBrandVoice(env, candidate.siteId);
      const { html, tokensUsed } = await rewriteSection(env, candidate, brandVoice);
      await createRewriteDraft(env, candidate, html, tokensUsed);
    } catch (err) {
      console.warn(`[content-freshness] failed section ${candidate.sectionKey}: ${String(err)}`);
    }
  }
}
