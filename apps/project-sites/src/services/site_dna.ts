/**
 * Site DNA Taste Graph (#7) — per-tenant ranker.
 *
 * Every accept / reject / edit action on a generated component is persisted to D1
 * `site_dna_feedback` (migration 0505). When the Workers AI BGE embedding is available,
 * each feedback row is embedded and upserted into the Vectorize index
 * `site-dna-{orgId}` so the build orchestrator can retrieve semantically similar
 * preferences at generation time.
 *
 * Flag: `site_dna_taste_graph` (experimental, enabled=0, rollout=0).
 *
 * @example
 * ```ts
 * await recordDnaFeedback(env, {
 *   orgId: 'org-123', siteId: 'site-456',
 *   componentId: 'hero', componentClass: 'hero',
 *   action: 'accept', context: { slot: 'hero', industry: 'restaurant' },
 * });
 * const prefs = await getDnaPreferences(env, 'site-456', 'hero', 5);
 * ```
 */

import type { Env } from '../types/env.js';

export type DnaAction = 'accept' | 'reject' | 'edit';

export interface DnaFeedbackInput {
  orgId: string;
  siteId: string;
  componentId: string;
  componentClass: string;
  action: DnaAction;
  context?: Record<string, unknown>;
}

export interface DnaPreference {
  component_id: string;
  component_class: string;
  action: DnaAction;
  accept_rate: number;
  count: number;
  last_seen_at: string;
  context_sample: Record<string, unknown>;
}

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/** Vectorize index naming convention per org. */
const dnIndexName = (orgId: string) => `site-dna-${orgId}`;

/**
 * Embed a feedback string via Workers AI BGE-large (768-dim).
 * Returns a Float32Array on success, null if AI binding is unavailable.
 */
async function embedText(env: Env, text: string): Promise<number[] | null> {
  try {
    const res = await (
      env.AI as { run: (model: string, input: { text: string[] }) => Promise<{ data: number[][] }> }
    ).run('@cf/baai/bge-large-en-v1.5', { text: [text] });
    return res?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a component feedback action and (optionally) embed it into Vectorize.
 */
export async function recordDnaFeedback(
  env: Env,
  input: DnaFeedbackInput,
): Promise<{ id: string; vectorized: boolean }> {
  const id = uuid();
  const t = nowIso();
  const contextJson = JSON.stringify(input.context ?? {});

  await env.DB.prepare(
    `INSERT INTO site_dna_feedback
       (id, org_id, site_id, component_id, component_class, action, context_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.orgId,
      input.siteId,
      input.componentId,
      input.componentClass,
      input.action,
      contextJson,
      t,
      t,
    )
    .run()
    .catch(() => {});

  // Attempt Vectorize upsert for semantic preference retrieval.
  let vectorized = false;
  const embedText_ = `${input.componentId} ${input.componentClass} ${input.action} ${contextJson}`;
  const vector = await embedText(env, embedText_);

  if (vector) {
    // Use RAG_INDEX as a proxy since Vectorize binding names are wrangler-configured.
    // In production this should be `site-dna-{orgId}` index.
    const ragIndex = (
      env as {
        RAG_INDEX?: {
          upsert: (
            rows: { id: string; values: number[]; metadata: Record<string, unknown> }[],
          ) => Promise<void>;
        };
      }
    ).RAG_INDEX;
    if (ragIndex) {
      await ragIndex
        .upsert([
          {
            id,
            values: vector,
            metadata: {
              org_id: input.orgId,
              site_id: input.siteId,
              component_id: input.componentId,
              component_class: input.componentClass,
              action: input.action,
              index_name: dnIndexName(input.orgId),
            },
          },
        ])
        .catch(() => {});
      // Persist the vectorize id back to D1.
      await env.DB.prepare('UPDATE site_dna_feedback SET vectorize_id = ? WHERE id = ?')
        .bind(id, id)
        .run()
        .catch(() => {});
      vectorized = true;
    }
  }

  return { id, vectorized };
}

/**
 * Return top-K accepted component patterns for a site, grouped by component_class.
 * Used by the build orchestrator as a soft preference signal.
 *
 * @remarks Multi-tenant isolation — the query is scoped by BOTH `org_id` AND
 * `site_id`, so a caller can only read the taste graph of a site their org
 * owns. The `site_dna_feedback` table carries `org_id` (written by
 * {@link recordDnaFeedback}); without the `org_id` predicate a caller could read
 * another org's accepted-pattern signal by guessing a `siteId`. `topK` is
 * clamped by the caller (route caps at 50) and interpolated as a validated
 * integer, never user text.
 * @param env            - Worker env (D1 binding)
 * @param orgId          - the caller's org (from the authenticated context)
 * @param siteId         - the site whose preferences are requested
 * @param componentClass - optional class filter (e.g. `hero`, `cta`)
 * @param topK           - max rows (caller-clamped)
 * @returns accepted-pattern preferences for `(orgId, siteId)`, newest-weighted; `[]` on any DB error (defensive)
 * @example
 * ```ts
 * const prefs = await getDnaPreferences(env, orgId, siteId, 'hero', 5);
 * ```
 */
export async function getDnaPreferences(
  env: Env,
  orgId: string,
  siteId: string,
  componentClass?: string,
  topK = 10,
): Promise<DnaPreference[]> {
  const classFilter = componentClass ? 'AND component_class = ?' : '';
  const params: string[] = componentClass ? [orgId, siteId, componentClass] : [orgId, siteId];

  const rows = await env.DB.prepare(
    `SELECT
       component_id,
       component_class,
       action,
       COUNT(*) AS count,
       MAX(created_at) AS last_seen_at,
       context_json
     FROM site_dna_feedback
     WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL ${classFilter}
     GROUP BY component_id, component_class, action
     ORDER BY count DESC
     LIMIT ${topK}`,
  )
    .bind(...params)
    .all<{
      component_id: string;
      component_class: string;
      action: string;
      count: number;
      last_seen_at: string;
      context_json: string;
    }>()
    .catch(() => ({
      results: [] as Array<{
        component_id: string;
        component_class: string;
        action: string;
        count: number;
        last_seen_at: string;
        context_json: string;
      }>,
    }));

  // Compute accept rate by pairing with reject counts.
  const countMap = new Map<string, { accept: number; reject: number; edit: number }>();
  for (const r of rows.results ?? []) {
    const key = `${r.component_id}::${r.component_class}`;
    const entry = countMap.get(key) ?? { accept: 0, reject: 0, edit: 0 };
    if (r.action === 'accept') entry.accept = r.count;
    else if (r.action === 'reject') entry.reject = r.count;
    else if (r.action === 'edit') entry.edit = r.count;
    countMap.set(key, entry);
  }

  const acceptedRows = (rows.results ?? []).filter((r) => r.action === 'accept');

  return acceptedRows.map((r) => {
    const key = `${r.component_id}::${r.component_class}`;
    const counts = countMap.get(key) ?? { accept: 0, reject: 0, edit: 0 };
    const total = counts.accept + counts.reject + counts.edit;
    return {
      component_id: r.component_id,
      component_class: r.component_class,
      action: r.action as DnaAction,
      accept_rate: total > 0 ? counts.accept / total : 1,
      count: r.count,
      last_seen_at: r.last_seen_at,
      context_sample: safeJsonParse(r.context_json, {}),
    };
  });
}

function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * List recent DNA feedback for a site (admin view).
 *
 * @remarks Multi-tenant isolation — scoped by BOTH `org_id` AND `site_id` (see
 * {@link getDnaPreferences}). A foreign `siteId` (or a guessed one belonging to
 * another org) matches zero rows.
 * @param env    - Worker env (D1 binding)
 * @param orgId  - the caller's org (from the authenticated context)
 * @param siteId - the site whose feedback history is requested
 * @param limit  - max rows (caller-clamped, route caps at 200)
 * @returns recent feedback rows for `(orgId, siteId)`, newest-first; `[]` on any DB error (defensive)
 * @example
 * ```ts
 * const history = await listDnaFeedback(env, orgId, siteId, 50);
 * ```
 */
export async function listDnaFeedback(env: Env, orgId: string, siteId: string, limit = 50) {
  const rows = await env.DB.prepare(
    'SELECT * FROM site_dna_feedback WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?',
  )
    .bind(orgId, siteId, limit)
    .all<{
      id: string;
      component_id: string;
      component_class: string;
      action: string;
      context_json: string;
      created_at: string;
      vectorize_id: string | null;
    }>()
    .catch(() => ({
      results: [] as Array<{
        id: string;
        component_id: string;
        component_class: string;
        action: string;
        context_json: string;
        created_at: string;
        vectorize_id: string | null;
      }>,
    }));

  return (rows.results ?? []).map((r) => ({
    ...r,
    context: safeJsonParse(r.context_json, {}),
    vectorized: !!r.vectorize_id,
  }));
}
