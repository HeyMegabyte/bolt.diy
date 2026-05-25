/**
 * @module services/ai_admin_features
 * @description Backend logic for four AI-native admin features:
 *   1. {@link explainTrace}  — natural-language post-mortem of a single AI trace row
 *      (item #91, AI explain trace).
 *   2. {@link suggestEndpoint} — LLM-derived scaffold for a new AI Endpoint from a
 *      one-line description (item #93, AI suggest endpoint).
 *   3. {@link aiSearch}     — natural-language search across audit/forms/traces/sites/users
 *      (item #94, AI natural-language search).
 *   4. {@link forecastCost} — 30-day cost projection over Workers + AI + R2 + email
 *      pricing plus a single LLM-generated savings tip (item #95, AI cost forecaster).
 *
 * All LLM calls route through the Workers AI binding
 * (`env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', …)`), keeping every feature on the
 * Cloudflare-first stack with zero per-token billing for the org.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { Env } from '../types/env.js';

/** Workers AI model used for every feature in this module. */
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8' as const;

/** Narrow the model literal into the type Workers AI's `run()` accepts. */
type ModelParam = Parameters<Ai['run']>[0];
const MODEL_PARAM = MODEL as ModelParam;

/** Result of a Workers AI chat completion (narrowed for type-safety in tests). */
interface AiRunResult {
  response?: string;
}

/**
 * Trace row read from `ai_form_logs`, the table that backs the Traces page.
 * Only the columns we feed to the LLM are kept here.
 */
export interface AiTraceRow {
  id: string;
  trace_kind: string | null;
  endpoint_slug: string | null;
  model: string | null;
  status: string;
  prompt_template: string | null;
  input_json: string | null;
  output_text: string | null;
  error_message: string | null;
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  created_at: string;
}

/** Public shape returned by {@link explainTrace}. */
export interface ExplainTraceResult {
  markdown: string;
  model: '@cf/meta/llama-3.1-8b-instruct-fp8';
  cached: boolean;
}

/**
 * Explain a single AI trace in plain English. Caches the result in KV for one
 * hour so a busy admin spamming "Explain" doesn't re-bill the LLM.
 *
 * @param env  - Worker bindings (uses `AI` + `CACHE_KV`).
 * @param row  - The trace row pulled from `ai_form_logs`.
 * @returns markdown explanation, model id, and whether it came from KV cache.
 * @throws never — failures surface as `markdown: 'AI explanation unavailable'`.
 *
 * @example
 * ```ts
 * const out = await explainTrace(c.env, traceRow);
 * console.warn(out.markdown);
 * ```
 */
export async function explainTrace(env: Env, row: AiTraceRow): Promise<ExplainTraceResult> {
  const cacheKey = `trace:${row.id}:explain`;
  const cached = await env.CACHE_KV.get(cacheKey);
  if (cached) return { markdown: cached, model: MODEL, cached: true };

  const system =
    'You are an SRE assistant. Given this AI trace, explain in 3 short paragraphs: ' +
    '(1) what was attempted, (2) why it succeeded or failed, (3) what to fix or do next. ' +
    'Be concrete and use the exact field values from the trace.';
  const user = JSON.stringify(
    {
      id: row.id,
      kind: row.trace_kind,
      endpoint_slug: row.endpoint_slug,
      model: row.model,
      status: row.status,
      latency_ms: row.latency_ms,
      tokens_input: row.tokens_input,
      tokens_output: row.tokens_output,
      error_message: row.error_message,
      prompt_template: row.prompt_template,
      input_json: row.input_json,
      output_preview: row.output_text ? row.output_text.slice(0, 600) : null,
      created_at: row.created_at,
    },
    null,
    2,
  );

  let markdown = 'AI explanation unavailable.';
  try {
    const result = (await env.AI.run(MODEL_PARAM, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    } as Parameters<typeof env.AI.run>[1])) as AiRunResult;
    if (result && typeof result.response === 'string' && result.response.trim().length > 0) {
      markdown = result.response.trim();
    }
  } catch (err) {
    markdown = `AI explanation unavailable: ${err instanceof Error ? err.message : 'unknown error'}.`;
  }

  // Best-effort cache (failure should not break the response).
  try {
    await env.CACHE_KV.put(cacheKey, markdown, { expirationTtl: 3600 });
  } catch {
    /* ignore cache write errors */
  }

  return { markdown, model: MODEL, cached: false };
}

// ─── #93 Suggest endpoint ────────────────────────────────────────────────────

/** Zod schema for the LLM's endpoint scaffold response. */
export const endpointSuggestionSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase-kebab'),
  method: z.enum(['GET', 'POST']),
  language: z.enum(['ai-prompt', 'javascript', 'typescript']),
  files: z.record(z.string(), z.string()).refine((f) => Object.keys(f).length > 0, {
    message: 'files must contain at least one entry',
  }),
  description: z.string().min(1).max(280),
});

export type EndpointSuggestion = z.infer<typeof endpointSuggestionSchema>;

/**
 * Ask the LLM to scaffold an AI endpoint from a natural-language description.
 * Returns a Zod-validated suggestion ready to seed the create-endpoint form.
 *
 * @param env         - Worker bindings (uses `AI`).
 * @param description - Free-form business description (e.g. "lead-qualify form replies").
 * @returns Validated {@link EndpointSuggestion}.
 * @throws Error when the LLM output cannot be parsed or fails schema validation.
 *
 * @example
 * ```ts
 * const s = await suggestEndpoint(env, 'lead qualifier for contact forms');
 * // → { slug: 'lead-qualifier', method: 'POST', language: 'ai-prompt', files: {...}, description: '…' }
 * ```
 */
export async function suggestEndpoint(env: Env, description: string): Promise<EndpointSuggestion> {
  const system =
    "Given this natural-language description, propose a Cloudflare Worker AI endpoint. " +
    "Output STRICT JSON: { slug: string (lowercase-kebab, 2-64 chars), method: 'GET'|'POST', " +
    "language: 'ai-prompt'|'javascript'|'typescript', files: {<path>: <content>}, description: string }. " +
    'The slug must be derived from the description and unique-friendly. Output JSON only, no prose.';
  const result = (await env.AI.run(MODEL_PARAM, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: description },
    ],
  } as Parameters<typeof env.AI.run>[1])) as AiRunResult;

  const raw = (result && typeof result.response === 'string' ? result.response : '').trim();
  const json = extractFirstJsonObject(raw);
  if (!json) throw new Error('LLM did not return parseable JSON');
  const parsed = endpointSuggestionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`LLM JSON failed validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}

/** Pull the first balanced `{ … }` block out of an LLM response. */
function extractFirstJsonObject(text: string): unknown {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1]! : text;
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ─── #94 AI search ───────────────────────────────────────────────────────────

/** Entities exposed to the natural-language search. */
export const SEARCH_ENTITIES = ['audit', 'forms', 'traces', 'sites', 'users'] as const;
export type SearchEntity = (typeof SEARCH_ENTITIES)[number];

/** Zod schema for the LLM-translated structured filter. */
export const searchFilterSchema = z.object({
  entity: z.enum(SEARCH_ENTITIES),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).nullable()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type SearchFilter = z.infer<typeof searchFilterSchema>;

/** Compiled SQL plan returned by {@link buildSearchSql}. Used for assertions in tests. */
export interface SearchSqlPlan {
  sql: string;
  params: unknown[];
  entity: SearchEntity;
}

/**
 * Translate a structured filter into a parameterized D1 SELECT. ALL queries are
 * `org_id = ?` gated; columns not on the allow-list are silently dropped. No
 * caller value is interpolated into the SQL string.
 *
 * @param filter - Validated filter from the LLM.
 * @param orgId  - Authenticated org id from the Hono context.
 * @returns SQL string, bound params, and the resolved entity.
 *
 * @example
 * ```ts
 * const plan = buildSearchSql({ entity: 'audit', filters: { action: 'site.created' } }, 'org-1');
 * // → { sql: "SELECT … FROM audit_logs WHERE org_id = ? AND action = ? …", params: [...] }
 * ```
 */
export function buildSearchSql(filter: SearchFilter, orgId: string): SearchSqlPlan {
  const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
  const entity: SearchEntity = filter.entity;
  const filters = filter.filters ?? {};

  // Column allow-lists per entity. Keep narrow — anything not listed is dropped.
  const allow: Record<SearchEntity, { table: string; cols: readonly string[]; select: string }> = {
    audit: {
      table: 'audit_logs',
      cols: ['action', 'target_type', 'target_id', 'actor_id', 'request_id'],
      select:
        'SELECT id, action, target_type, target_id, actor_id, metadata_json, request_id, created_at FROM audit_logs',
    },
    forms: {
      table: 'form_submissions',
      cols: ['form_name', 'email', 'status', 'origin_url', 'site_id'],
      select:
        'SELECT id, site_id, form_name, email, status, origin_url, created_at FROM form_submissions',
    },
    traces: {
      table: 'ai_form_logs',
      cols: ['trace_kind', 'endpoint_slug', 'model', 'status', 'tool_name', 'tool_status', 'site_id'],
      select:
        'SELECT id, site_id, trace_kind, endpoint_slug, model, status, latency_ms, created_at FROM ai_form_logs',
    },
    sites: {
      table: 'sites',
      cols: ['slug', 'business_name', 'status'],
      select: 'SELECT id, slug, business_name, status, created_at FROM sites',
    },
    users: {
      table: 'users',
      cols: ['email', 'display_name'],
      select:
        'SELECT u.id, u.email, u.display_name, u.created_at FROM users u JOIN memberships m ON m.user_id = u.id',
    },
  };

  const plan = allow[entity];
  const where: string[] = [];
  const params: unknown[] = [];

  // org_id scoping — joined for users, otherwise direct.
  if (entity === 'users') {
    where.push('m.org_id = ? AND m.deleted_at IS NULL');
    params.push(orgId);
  } else if (entity === 'sites') {
    where.push('org_id = ? AND deleted_at IS NULL');
    params.push(orgId);
  } else {
    where.push('org_id = ?');
    params.push(orgId);
  }

  for (const [col, val] of Object.entries(filters)) {
    if (!plan.cols.includes(col)) continue;
    if (val === null || val === undefined) continue;
    const prefix = entity === 'users' ? 'u.' : '';
    if (typeof val === 'string' && val.includes('%')) {
      where.push(`${prefix}${col} LIKE ?`);
      params.push(val);
    } else {
      where.push(`${prefix}${col} = ?`);
      params.push(val);
    }
  }

  const orderCol = entity === 'users' ? 'u.created_at' : 'created_at';
  const sql = `${plan.select} WHERE ${where.join(' AND ')} ORDER BY ${orderCol} DESC LIMIT ?`;
  params.push(limit);
  return { sql, params, entity };
}

/** Public shape returned by {@link aiSearch}. */
export interface AiSearchResult {
  entity: SearchEntity;
  rows: Record<string, unknown>[];
  llm_query: string;
  llm_filters: SearchFilter;
}

/**
 * Translate a natural-language query into a typed entity + filter set, then
 * run the parameterised D1 SELECT.
 *
 * @param env   - Worker bindings (uses `AI` + `DB`).
 * @param orgId - Authenticated org id.
 * @param query - Free-form query (e.g. "show me errored form submissions today").
 * @returns The chosen entity, the bound LLM filter, and the matching rows.
 * @throws Error when the LLM output cannot be coerced into a {@link SearchFilter}.
 *
 * @example
 * ```ts
 * const out = await aiSearch(c.env, orgId, 'failed traces last hour');
 * // → { entity: 'traces', rows: [...], llm_filters: { entity: 'traces', filters: {...} } }
 * ```
 */
export async function aiSearch(env: Env, orgId: string, query: string): Promise<AiSearchResult> {
  const system =
    'You translate a natural-language admin query into a structured filter. ' +
    'Entities: audit (audit_logs: action,target_type,target_id,actor_id,request_id), ' +
    'forms (form_submissions: form_name,email,status,origin_url,site_id), ' +
    'traces (ai_form_logs: trace_kind,endpoint_slug,model,status,tool_name,tool_status,site_id), ' +
    'sites (slug,business_name,status), users (email,display_name). ' +
    "Output STRICT JSON ONLY: { entity: 'audit'|'forms'|'traces'|'sites'|'users', " +
    "filters: { <column>: <value> }, limit?: number }. " +
    'Values are exact-match strings or SQL LIKE patterns with %. Output JSON only, no prose.';

  const result = (await env.AI.run(MODEL_PARAM, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: query },
    ],
  } as Parameters<typeof env.AI.run>[1])) as AiRunResult;

  const raw = (result && typeof result.response === 'string' ? result.response : '').trim();
  const json = extractFirstJsonObject(raw);
  const parsed = searchFilterSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`AI search filter invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }

  const plan = buildSearchSql(parsed.data, orgId);
  const rs = await env.DB.prepare(plan.sql)
    .bind(...plan.params)
    .all<Record<string, unknown>>();
  return {
    entity: plan.entity,
    rows: rs.results ?? [],
    llm_query: query,
    llm_filters: parsed.data,
  };
}

// ─── #95 Cost forecaster ─────────────────────────────────────────────────────

/** Aggregated 30-day usage rolled up from `site_cost_daily`. */
export interface UsageThirtyDays {
  ai_calls: number;
  ai_credits: number;
  bandwidth_bytes: number;
  storage_bytes: number;
  estimated_cost_micro_usd: number;
  request_count: number;
  ai_tokens: number;
}

/** Cost forecast output (returned by `GET /api/admin/forecast/cost`). */
export interface CostForecast {
  current_month_estimate_usd: number;
  next_month_forecast_usd: number;
  by_category: {
    workers: number;
    ai: number;
    r2: number;
    d1: number;
    email: number;
  };
  biggest_driver: string;
  savings_tip: string;
}

/**
 * Pure deterministic math: take a 30-day usage rollup and produce a current /
 * next-month USD projection per Cloudflare pricing.
 *
 * Pricing constants (2026-05): Workers requests $0.30 / 1M, Workers CPU-ms
 * $0.02 / 1M, R2 storage $0.015 / GB, AI Gateway $0.011 / 1K Llama tokens.
 *
 * @param u - Thirty-day usage rollup.
 * @returns The forecast minus the LLM tip (added by {@link forecastCost}).
 *
 * @example
 * ```ts
 * const f = computeForecast({ ai_calls: 12000, request_count: 4_000_000, ai_tokens: 800_000, … });
 * // → { current_month_estimate_usd, next_month_forecast_usd, by_category, biggest_driver, savings_tip: '' }
 * ```
 */
export function computeForecast(u: UsageThirtyDays): Omit<CostForecast, 'savings_tip'> {
  // Workers: $0.30 / 1M requests + $0.02 / 1M CPU-ms (assume 5ms p50/request).
  const workersRequests = (u.request_count / 1_000_000) * 0.3;
  const workersCpu = ((u.request_count * 5) / 1_000_000) * 0.02;
  const workers = round2(workersRequests + workersCpu);

  // AI: $0.011 / 1K Llama tokens.
  const ai = round2((u.ai_tokens / 1000) * 0.011);

  // R2: $0.015 / GB stored. storage_bytes is the 30-day rolling sum; treat as a
  // proxy for month-average and convert to GB.
  const r2 = round2((u.storage_bytes / 1024 ** 3) * 0.015);

  // D1: rough proxy via call volume — $0.001 / 1K rows scanned (estimated from
  // 50 reads/request average). Generous floor so $0 never hides the line item.
  const d1 = round2(Math.max(0.01, (u.request_count * 50) / 1_000_000));

  // Email: $0.001/message via Resend free tier — assume 1 email per 1K reqs.
  const email = round2((u.request_count / 1000) * 0.001);

  const by_category = { workers, ai, r2, d1, email };
  const current_month_estimate_usd = round2(workers + ai + r2 + d1 + email);
  // Assume 10% growth month-over-month for the forecast.
  const next_month_forecast_usd = round2(current_month_estimate_usd * 1.1);

  const biggest_driver = pickBiggest(by_category);
  return {
    current_month_estimate_usd,
    next_month_forecast_usd,
    by_category,
    biggest_driver,
  };
}

/** Round to 2 decimal places (cents). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Return the category key with the largest USD spend. */
function pickBiggest(cats: CostForecast['by_category']): string {
  let best: keyof CostForecast['by_category'] = 'workers';
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(cats) as Array<[keyof CostForecast['by_category'], number]>) {
    if (v > bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}

/**
 * Pull a 30-day usage rollup from `site_cost_daily` + `ai_form_logs`, run
 * {@link computeForecast}, then ask the LLM for one specific savings tip.
 *
 * @param env   - Worker bindings (uses `AI` + `DB`).
 * @param orgId - Authenticated org id.
 * @returns A fully-populated {@link CostForecast}.
 * @throws never — savings tip degrades to a sensible default on LLM failure.
 *
 * @example
 * ```ts
 * const f = await forecastCost(c.env, orgId);
 * // → { current_month_estimate_usd: 42.18, by_category: {...}, savings_tip: '…' }
 * ```
 */
export async function forecastCost(env: Env, orgId: string): Promise<CostForecast> {
  const sinceDay = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const rs = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(ai_calls), 0) AS ai_calls,
        COALESCE(SUM(ai_credits), 0) AS ai_credits,
        COALESCE(SUM(bandwidth_bytes), 0) AS bandwidth_bytes,
        COALESCE(SUM(storage_bytes), 0) AS storage_bytes,
        COALESCE(SUM(estimated_cost_micro_usd), 0) AS estimated_cost_micro_usd
     FROM site_cost_daily
     WHERE org_id = ? AND day >= ?`,
  )
    .bind(orgId, sinceDay)
    .first<{
      ai_calls: number;
      ai_credits: number;
      bandwidth_bytes: number;
      storage_bytes: number;
      estimated_cost_micro_usd: number;
    }>();

  // Token usage from ai_form_logs.
  const tokensRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(tokens_input), 0) AS ti, COALESCE(SUM(tokens_output), 0) AS to_,
            COUNT(*) AS calls
     FROM ai_form_logs WHERE org_id = ? AND created_at >= ?`,
  )
    .bind(orgId, sinceDay)
    .first<{ ti: number; to_: number; calls: number }>();

  const usage: UsageThirtyDays = {
    ai_calls: rs?.ai_calls ?? 0,
    ai_credits: rs?.ai_credits ?? 0,
    bandwidth_bytes: rs?.bandwidth_bytes ?? 0,
    storage_bytes: rs?.storage_bytes ?? 0,
    estimated_cost_micro_usd: rs?.estimated_cost_micro_usd ?? 0,
    // Treat each AI call as one inbound request from the public site for
    // budgeting purposes; multiply by 1000 to model typical Worker fan-out
    // (page renders, asset fetches, form posts).
    request_count: Math.max(((tokensRow?.calls ?? 0) + (rs?.ai_calls ?? 0)) * 1000, 1000),
    ai_tokens: (tokensRow?.ti ?? 0) + (tokensRow?.to_ ?? 0),
  };

  const base = computeForecast(usage);

  // One-sentence savings tip from the LLM.
  let tip = `Your biggest driver is ${base.biggest_driver}; review usage in /admin/billing.`;
  try {
    const result = (await env.AI.run(MODEL_PARAM, {
      messages: [
        {
          role: 'system',
          content:
            'Given this usage, suggest one specific cost optimization for a Cloudflare-first stack. ' +
            'One sentence. No preamble.',
        },
        {
          role: 'user',
          content: JSON.stringify({ usage, forecast: base }),
        },
      ],
    } as Parameters<typeof env.AI.run>[1])) as AiRunResult;
    if (result && typeof result.response === 'string' && result.response.trim().length > 0) {
      tip = result.response.trim().split('\n')[0]!;
    }
  } catch {
    /* keep the deterministic fallback tip */
  }

  return { ...base, savings_tip: tip };
}
