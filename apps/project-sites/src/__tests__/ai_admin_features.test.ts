/**
 * AI Admin Features service — unit coverage (convergence r49).
 *
 * Covers all five exported functions in `services/ai_admin_features.ts`:
 *   - explainTrace      (#91) — KV cache hit/miss, AI success/empty/throw, cache-write resilience
 *   - suggestEndpoint   (#93) — JSON extraction, schema validation, parse failures
 *   - buildSearchSql           — org scoping per entity, allow-list dropping, LIKE vs eq, limit clamp
 *   - aiSearch          (#94) — LLM-filter parse → parameterised D1 SELECT, invalid-filter throw
 *   - forecastCost      (#95) — usage rollup math via computeForecast, savings-tip success/fallback
 *
 * Workers AI (`env.AI.run`), KV (`env.CACHE_KV`), and D1 (`env.DB.prepare`) are
 * all jest-mocked — no real bindings touched.
 */

import {
  explainTrace,
  suggestEndpoint,
  buildSearchSql,
  aiSearch,
  computeForecast,
  forecastCost,
  endpointSuggestionSchema,
  searchFilterSchema,
  SEARCH_ENTITIES,
  type AiTraceRow,
  type SearchFilter,
  type UsageThirtyDays,
} from '../services/ai_admin_features.js';
import type { Env } from '../types/env.js';

// ─── Env stub builders ───────────────────────────────────────────────────────

interface StubKv {
  get: jest.Mock;
  put: jest.Mock;
}

/** Build an Env carrying jest-mocked AI / CACHE_KV / DB. */
function makeEnv(opts?: {
  aiResponse?: unknown;
  aiThrows?: boolean;
  kvGet?: string | null;
  kvPutThrows?: boolean;
  dbAll?: unknown[];
  dbFirst?: Record<string, unknown> | null;
}): { env: Env; aiRun: jest.Mock; kv: StubKv; prepare: jest.Mock; bind: jest.Mock } {
  const aiRun = jest.fn(async () => {
    if (opts?.aiThrows) throw new Error('AI binding down');
    return opts?.aiResponse ?? { response: '' };
  });

  const kv: StubKv = {
    get: jest.fn(async () => (opts && 'kvGet' in opts ? (opts.kvGet ?? null) : null)),
    put: jest.fn(async () => {
      if (opts?.kvPutThrows) throw new Error('kv write failed');
    }),
  };

  // aiSearch reads rows via .all(); .first() returns dbFirst when supplied.
  const all = jest.fn(async () => ({ results: opts?.dbAll ?? [] }));
  const bind = jest.fn(() => ({ all, first: jest.fn(async () => opts?.dbFirst ?? null) }));
  const prepare = jest.fn(() => ({ bind }));

  const env = {
    AI: { run: aiRun },
    CACHE_KV: kv,
    DB: { prepare },
  } as unknown as Env;

  return { env, aiRun, kv, prepare, bind };
}

function makeTraceRow(over: Partial<AiTraceRow> = {}): AiTraceRow {
  return {
    id: 'trace-1',
    trace_kind: 'endpoint',
    endpoint_slug: 'lead-qualifier',
    model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    status: 'error',
    prompt_template: 'qualify',
    input_json: '{"email":"a@b.com"}',
    output_text: 'x'.repeat(900),
    error_message: 'timeout',
    latency_ms: 1234,
    tokens_input: 50,
    tokens_output: 0,
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─── #91 explainTrace ──────────────────────────────────────────────────────

describe('explainTrace', () => {
  it('returns cached markdown without calling the LLM on KV hit', async () => {
    const { env, aiRun, kv } = makeEnv({ kvGet: 'cached explanation' });
    const out = await explainTrace(env, makeTraceRow());
    expect(out).toEqual({
      markdown: 'cached explanation',
      model: '@cf/meta/llama-3.1-8b-instruct-fp8',
      cached: true,
    });
    expect(kv.get).toHaveBeenCalledWith('trace:trace-1:explain');
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('calls the LLM on cache miss, trims response, and writes to KV', async () => {
    const { env, aiRun, kv } = makeEnv({ kvGet: null, aiResponse: { response: '  ## Post-mortem  ' } });
    const out = await explainTrace(env, makeTraceRow());
    expect(out.markdown).toBe('## Post-mortem');
    expect(out.cached).toBe(false);
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith('trace:trace-1:explain', '## Post-mortem', { expirationTtl: 3600 });
  });

  it('truncates output_text to 600 chars in the LLM payload', async () => {
    const { env, aiRun } = makeEnv({ kvGet: null, aiResponse: { response: 'ok' } });
    await explainTrace(env, makeTraceRow({ output_text: 'y'.repeat(1000) }));
    const userMsg = (aiRun.mock.calls[0]![1] as { messages: { content: string }[] }).messages[1]!.content;
    expect(userMsg).toContain('"output_preview"');
    expect(userMsg).not.toContain('y'.repeat(601));
    expect(userMsg).toContain('y'.repeat(600));
  });

  it('passes null output_preview when output_text is null', async () => {
    const { env, aiRun } = makeEnv({ kvGet: null, aiResponse: { response: 'ok' } });
    await explainTrace(env, makeTraceRow({ output_text: null }));
    const userMsg = (aiRun.mock.calls[0]![1] as { messages: { content: string }[] }).messages[1]!.content;
    expect(userMsg).toContain('"output_preview": null');
  });

  it('falls back to unavailable markdown when LLM returns empty response', async () => {
    const { env } = makeEnv({ kvGet: null, aiResponse: { response: '   ' } });
    const out = await explainTrace(env, makeTraceRow());
    expect(out.markdown).toBe('AI explanation unavailable.');
    expect(out.cached).toBe(false);
  });

  it('falls back to unavailable markdown when AI run throws (with message)', async () => {
    const { env, kv } = makeEnv({ kvGet: null, aiThrows: true });
    const out = await explainTrace(env, makeTraceRow());
    expect(out.markdown).toBe('AI explanation unavailable: AI binding down.');
    // still attempts to cache the fallback
    expect(kv.put).toHaveBeenCalled();
  });

  it('does not throw when the KV write fails', async () => {
    const { env } = makeEnv({ kvGet: null, aiResponse: { response: 'explanation' }, kvPutThrows: true });
    const out = await explainTrace(env, makeTraceRow());
    expect(out.markdown).toBe('explanation');
    expect(out.cached).toBe(false);
  });
});

// ─── #93 suggestEndpoint ─────────────────────────────────────────────────────

describe('suggestEndpoint', () => {
  const valid = {
    slug: 'lead-qualifier',
    method: 'POST',
    language: 'ai-prompt',
    files: { 'prompt.md': '# qualify the lead' },
    description: 'Qualifies inbound contact-form leads.',
  };

  it('parses a valid bare-JSON LLM response into a typed suggestion', async () => {
    const { env } = makeEnv({ aiResponse: { response: JSON.stringify(valid) } });
    const out = await suggestEndpoint(env, 'lead qualifier for contact forms');
    expect(out).toEqual(valid);
  });

  it('extracts JSON from a ```json fenced code block with surrounding prose', async () => {
    const fenced = 'Sure!\n```json\n' + JSON.stringify(valid) + '\n```\nDone.';
    const { env } = makeEnv({ aiResponse: { response: fenced } });
    const out = await suggestEndpoint(env, 'desc');
    expect(out.slug).toBe('lead-qualifier');
  });

  it('throws when the LLM returns no JSON object', async () => {
    const { env } = makeEnv({ aiResponse: { response: 'no json here' } });
    await expect(suggestEndpoint(env, 'desc')).rejects.toThrow('LLM did not return parseable JSON');
  });

  it('throws when the LLM JSON fails schema validation (bad slug)', async () => {
    const bad = { ...valid, slug: 'Bad Slug!' };
    const { env } = makeEnv({ aiResponse: { response: JSON.stringify(bad) } });
    await expect(suggestEndpoint(env, 'desc')).rejects.toThrow(/failed validation/);
  });

  it('throws when files object is empty (refine guard)', async () => {
    const bad = { ...valid, files: {} };
    const { env } = makeEnv({ aiResponse: { response: JSON.stringify(bad) } });
    await expect(suggestEndpoint(env, 'desc')).rejects.toThrow(/failed validation/);
  });

  it('throws when the LLM returns malformed JSON inside a fence', async () => {
    const { env } = makeEnv({ aiResponse: { response: '```json\n{ not valid json }\n```' } });
    await expect(suggestEndpoint(env, 'desc')).rejects.toThrow('LLM did not return parseable JSON');
  });

  it('handles a non-string response field gracefully (no JSON → throw)', async () => {
    const { env } = makeEnv({ aiResponse: { response: 42 } });
    await expect(suggestEndpoint(env, 'desc')).rejects.toThrow('LLM did not return parseable JSON');
  });

  it('endpointSuggestionSchema rejects an unknown method', () => {
    const r = endpointSuggestionSchema.safeParse({ ...valid, method: 'DELETE' });
    expect(r.success).toBe(false);
  });
});

// ─── buildSearchSql ──────────────────────────────────────────────────────────

describe('buildSearchSql', () => {
  it('scopes audit by org_id and applies an allow-listed equality filter', () => {
    const plan = buildSearchSql({ entity: 'audit', filters: { action: 'site.created' } }, 'org-1');
    expect(plan.entity).toBe('audit');
    expect(plan.sql).toContain('FROM audit_logs');
    expect(plan.sql).toContain('org_id = ?');
    expect(plan.sql).toContain('action = ?');
    expect(plan.sql).toContain('ORDER BY created_at DESC LIMIT ?');
    expect(plan.params).toEqual(['org-1', 'site.created', 20]);
  });

  it('uses LIKE when a string filter value contains %', () => {
    const plan = buildSearchSql({ entity: 'forms', filters: { email: '%@gmail.com' } }, 'org-2');
    expect(plan.sql).toContain('email LIKE ?');
    expect(plan.params).toContain('%@gmail.com');
  });

  it('drops filter columns not on the allow-list', () => {
    const plan = buildSearchSql(
      { entity: 'sites', filters: { slug: 'vitos', secret_col: 'x' } },
      'org-3',
    );
    expect(plan.sql).toContain('slug = ?');
    expect(plan.sql).not.toContain('secret_col');
    expect(plan.params).toEqual(['org-3', 'vitos', 20]);
  });

  it('ignores null filter values', () => {
    const plan = buildSearchSql(
      { entity: 'traces', filters: { status: null, model: 'llama' } },
      'org-4',
    );
    expect(plan.sql).toContain('model = ?');
    expect(plan.sql).not.toContain('status = ?');
    expect(plan.params).toEqual(['org-4', 'llama', 20]);
  });

  it('joins memberships and prefixes columns with u. for the users entity', () => {
    const plan = buildSearchSql(
      { entity: 'users', filters: { email: 'a@b.com' } },
      'org-5',
    );
    expect(plan.sql).toContain('JOIN memberships m ON m.user_id = u.id');
    expect(plan.sql).toContain('m.org_id = ? AND m.deleted_at IS NULL');
    expect(plan.sql).toContain('u.email = ?');
    expect(plan.sql).toContain('ORDER BY u.created_at DESC');
    expect(plan.params).toEqual(['org-5', 'a@b.com', 20]);
  });

  it('adds deleted_at IS NULL for the sites entity', () => {
    const plan = buildSearchSql({ entity: 'sites' }, 'org-6');
    expect(plan.sql).toContain('org_id = ? AND deleted_at IS NULL');
    expect(plan.params).toEqual(['org-6', 20]);
  });

  it('clamps an over-limit value to 100 and an under-limit to 1', () => {
    const high = buildSearchSql({ entity: 'audit', limit: 9999 }, 'o');
    expect(high.params[high.params.length - 1]).toBe(100);
    // limit:0 is below the schema min in practice; the Math.max floor protects buildSearchSql directly
    const low = buildSearchSql({ entity: 'audit', limit: 0 } as SearchFilter, 'o');
    expect(low.params[low.params.length - 1]).toBe(1);
  });

  it('defaults limit to 20 when omitted', () => {
    const plan = buildSearchSql({ entity: 'audit' }, 'o');
    expect(plan.params[plan.params.length - 1]).toBe(20);
  });
});

// ─── #94 aiSearch ────────────────────────────────────────────────────────────

describe('aiSearch', () => {
  it('translates an LLM filter into a parameterised SELECT and returns rows', async () => {
    const filter = { entity: 'audit', filters: { action: 'site.created' } };
    const rows = [{ id: 'a1', action: 'site.created' }];
    const { env, prepare, bind } = makeEnv({ aiResponse: { response: JSON.stringify(filter) }, dbAll: rows });
    const out = await aiSearch(env, 'org-X', 'show site creations');
    expect(out.entity).toBe('audit');
    expect(out.rows).toEqual(rows);
    expect(out.llm_query).toBe('show site creations');
    expect(out.llm_filters).toEqual(filter);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('FROM audit_logs'));
    expect(bind).toHaveBeenCalledWith('org-X', 'site.created', 20);
  });

  it('returns an empty array when D1 yields no results field', async () => {
    const filter = { entity: 'sites' };
    const { env } = makeEnv({ aiResponse: { response: JSON.stringify(filter) }, dbAll: [] });
    const out = await aiSearch(env, 'org-Y', 'all sites');
    expect(out.rows).toEqual([]);
  });

  it('extracts the filter from a fenced JSON response', async () => {
    const filter = { entity: 'forms', filters: { status: 'error' } };
    const { env, bind } = makeEnv({
      aiResponse: { response: '```json\n' + JSON.stringify(filter) + '\n```' },
      dbAll: [],
    });
    const out = await aiSearch(env, 'org-Z', 'errored forms');
    expect(out.entity).toBe('forms');
    expect(bind).toHaveBeenCalledWith('org-Z', 'error', 20);
  });

  it('throws when the LLM filter fails schema validation (bad entity)', async () => {
    const { env } = makeEnv({ aiResponse: { response: JSON.stringify({ entity: 'pizza' }) } });
    await expect(aiSearch(env, 'org', 'q')).rejects.toThrow(/AI search filter invalid/);
  });

  it('throws when the LLM returns no JSON at all', async () => {
    const { env } = makeEnv({ aiResponse: { response: 'sorry, no idea' } });
    await expect(aiSearch(env, 'org', 'q')).rejects.toThrow(/AI search filter invalid/);
  });
});

// ─── #95 computeForecast (pure math) ─────────────────────────────────────────

describe('computeForecast', () => {
  const baseUsage: UsageThirtyDays = {
    ai_calls: 0,
    ai_credits: 0,
    bandwidth_bytes: 0,
    storage_bytes: 0,
    estimated_cost_micro_usd: 0,
    request_count: 0,
    ai_tokens: 0,
  };

  it('produces a zeroed forecast with a $0.01 d1 floor for empty usage', () => {
    const f = computeForecast(baseUsage);
    expect(f.by_category.workers).toBe(0);
    expect(f.by_category.ai).toBe(0);
    expect(f.by_category.r2).toBe(0);
    expect(f.by_category.email).toBe(0);
    expect(f.by_category.d1).toBe(0.01); // generous floor
    expect(f.current_month_estimate_usd).toBe(0.01);
    expect(f.next_month_forecast_usd).toBe(0.01); // round2(0.01 * 1.1)
  });

  it('computes workers cost from requests + CPU and rounds to cents', () => {
    const f = computeForecast({ ...baseUsage, request_count: 1_000_000 });
    // requests: 0.30, cpu: (1M*5/1M)*0.02 = 0.10 → 0.40
    expect(f.by_category.workers).toBe(0.4);
  });

  it('computes ai cost at $0.011 per 1K tokens', () => {
    const f = computeForecast({ ...baseUsage, ai_tokens: 1_000_000 });
    expect(f.by_category.ai).toBe(11); // (1M/1000)*0.011
  });

  it('computes r2 cost per GB stored', () => {
    const f = computeForecast({ ...baseUsage, storage_bytes: 1024 ** 3 * 100 });
    expect(f.by_category.r2).toBe(1.5); // 100GB * 0.015
  });

  it('applies 10% month-over-month growth to the forecast', () => {
    const f = computeForecast({ ...baseUsage, ai_tokens: 1_000_000 });
    // ai 11 + d1 floor 0.01 = 11.01 current → round2(11.01 * 1.1) = 12.11
    expect(f.current_month_estimate_usd).toBe(11.01);
    expect(f.next_month_forecast_usd).toBe(12.11);
  });

  it('picks the largest category as biggest_driver', () => {
    const f = computeForecast({ ...baseUsage, ai_tokens: 5_000_000, request_count: 100 });
    expect(f.biggest_driver).toBe('ai');
  });

  it('omits savings_tip (added downstream by forecastCost)', () => {
    const f = computeForecast(baseUsage) as Record<string, unknown>;
    expect(f.savings_tip).toBeUndefined();
  });
});

// ─── #95 forecastCost (DB rollup + LLM tip) ──────────────────────────────────

describe('forecastCost', () => {
  /** Two .first() calls: site_cost_daily rollup, then ai_form_logs token row. */
  function envWithRollups(opts: {
    costRow: Record<string, unknown> | null;
    tokenRow: Record<string, unknown> | null;
    aiResponse?: unknown;
    aiThrows?: boolean;
  }): Env {
    const firstQueue: Array<Record<string, unknown> | null> = [opts.costRow, opts.tokenRow];
    const bind = jest.fn(() => ({
      first: jest.fn(async () => firstQueue.shift() ?? null),
      all: jest.fn(async () => ({ results: [] })),
    }));
    const prepare = jest.fn(() => ({ bind }));
    const aiRun = jest.fn(async () => {
      if (opts.aiThrows) throw new Error('llm down');
      return opts.aiResponse ?? { response: '' };
    });
    return { DB: { prepare }, AI: { run: aiRun } } as unknown as Env;
  }

  it('aggregates rollups, computes forecast, and uses the LLM savings tip', async () => {
    const env = envWithRollups({
      costRow: {
        ai_calls: 100,
        ai_credits: 5,
        bandwidth_bytes: 0,
        storage_bytes: 1024 ** 3 * 10,
        estimated_cost_micro_usd: 0,
      },
      tokenRow: { ti: 500_000, to_: 500_000, calls: 200 },
      aiResponse: { response: 'Switch to R2 IA storage to cut idle costs.\nextra line' },
    });
    const f = await forecastCost(env, 'org-1');
    expect(f.savings_tip).toBe('Switch to R2 IA storage to cut idle costs.'); // first line only
    expect(f.by_category.ai).toBe(11); // 1M tokens
    expect(f.by_category.r2).toBe(0.15); // 10GB
    expect(typeof f.current_month_estimate_usd).toBe('number');
    expect(f.next_month_forecast_usd).toBeGreaterThanOrEqual(f.current_month_estimate_usd);
  });

  it('falls back to a deterministic tip when the LLM throws', async () => {
    const env = envWithRollups({
      costRow: { ai_calls: 0, ai_credits: 0, bandwidth_bytes: 0, storage_bytes: 0, estimated_cost_micro_usd: 0 },
      tokenRow: { ti: 0, to_: 0, calls: 0 },
      aiThrows: true,
    });
    const f = await forecastCost(env, 'org-2');
    expect(f.savings_tip).toContain('biggest driver is');
    expect(f.savings_tip).toContain('/admin/billing');
  });

  it('handles null DB rows with zeroed usage and a non-empty default tip', async () => {
    const env = envWithRollups({ costRow: null, tokenRow: null, aiResponse: { response: '' } });
    const f = await forecastCost(env, 'org-3');
    // request_count floors at 1000 → workers + d1 lines are non-zero
    expect(f.current_month_estimate_usd).toBeGreaterThan(0);
    expect(f.savings_tip.length).toBeGreaterThan(0);
  });

  it('models request_count from (calls + ai_calls) * 1000 with a 1000 floor', async () => {
    const env = envWithRollups({
      costRow: { ai_calls: 2, ai_credits: 0, bandwidth_bytes: 0, storage_bytes: 0, estimated_cost_micro_usd: 0 },
      tokenRow: { ti: 0, to_: 0, calls: 3 },
      aiResponse: { response: 'tip' },
    });
    const f = await forecastCost(env, 'org-4');
    // (3 + 2) * 1000 = 5000 requests → d1 = max(0.01, 5000*50/1M) = 0.25
    expect(f.by_category.d1).toBe(0.25);
    expect(f.current_month_estimate_usd).toBeGreaterThan(0);
    expect(f.savings_tip).toBe('tip');
  });
});

// ─── schema / constant smoke ─────────────────────────────────────────────────

describe('exported schemas & constants', () => {
  it('SEARCH_ENTITIES lists the five searchable entities', () => {
    expect(SEARCH_ENTITIES).toEqual(['audit', 'forms', 'traces', 'sites', 'users']);
  });

  it('searchFilterSchema accepts a minimal entity-only filter', () => {
    expect(searchFilterSchema.safeParse({ entity: 'audit' }).success).toBe(true);
  });

  it('searchFilterSchema rejects a limit above 100', () => {
    expect(searchFilterSchema.safeParse({ entity: 'audit', limit: 500 }).success).toBe(false);
  });
});
