/**
 * Route coverage for the public AI-endpoint dispatch surface (convergence r40).
 *
 * Exercises `GET|POST /api/ai/:siteSlug/:endpointSlug` end-to-end through the
 * real Hono app, mocking only the boundaries (D1 `loadEndpoint`, credits,
 * Workers AI, MCP tools, WFP dispatch, ai_logger). Covers: slug resolution +
 * 404 not-found, method/CORS gating (405), credit fail-closed (402), worker
 * dispatch + the not-deployed 503, prompt-kind success, tool-call dispatch,
 * tool-error → 502, and AI-exception → 502.
 */

jest.mock('../services/ai_logger.js', () => ({
  writeAiLog: jest.fn().mockResolvedValue('log-id-1'),
  estTokens: (s: string) => Math.ceil(s.length / 4),
}));

jest.mock('../services/credits.js', () => ({
  getBalance: jest.fn().mockResolvedValue(100),
  debitCredits: jest.fn().mockResolvedValue(99),
  maybeFireAlerts: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/mcp_client.js', () => ({
  loadAvailableTools: jest.fn().mockResolvedValue([]),
  executeTool: jest.fn().mockResolvedValue({ ok: true, data: { result: 42 } }),
}));

jest.mock('../services/wfp_dispatch.js', () => ({
  dispatchToUserWorker: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { aiEndpointsPublic } from '../routes/ai_endpoints_public.js';
import { writeAiLog } from '../services/ai_logger.js';
import { getBalance, debitCredits, maybeFireAlerts } from '../services/credits.js';
import { loadAvailableTools, executeTool } from '../services/mcp_client.js';
import { dispatchToUserWorker } from '../services/wfp_dispatch.js';

const mockWriteAiLog = writeAiLog as unknown as jest.Mock;
const mockGetBalance = getBalance as unknown as jest.Mock;
const mockDebitCredits = debitCredits as unknown as jest.Mock;
const mockMaybeFireAlerts = maybeFireAlerts as unknown as jest.Mock;
const mockLoadTools = loadAvailableTools as unknown as jest.Mock;
const mockExecuteTool = executeTool as unknown as jest.Mock;
const mockDispatch = dispatchToUserWorker as unknown as jest.Mock;

// ─── Endpoint row fixture ─────────────────────────────────────────────────────

interface EndpointRow {
  id: string;
  org_id: string;
  site_id: string;
  endpoint_slug: string;
  kind: 'prompt' | 'worker';
  method: string;
  prompt_template: string | null;
  worker_language: string | null;
  wfp_script_name: string | null;
  enabled: number;
}

function makeEndpoint(overrides: Partial<EndpointRow> = {}): EndpointRow {
  return {
    id: 'ep-1',
    org_id: 'org-1',
    site_id: 'site-1',
    endpoint_slug: 'summarize',
    kind: 'prompt',
    method: 'BOTH',
    prompt_template: 'Summarize the payload.',
    worker_language: null,
    wfp_script_name: null,
    enabled: 1,
    ...overrides,
  };
}

// ─── Boundary mocks ───────────────────────────────────────────────────────────

/** D1 mock where `.first()` resolves to the given endpoint row (or null). */
function makeDb(endpoint: EndpointRow | null) {
  const first = jest.fn(async () => endpoint);
  const bind = jest.fn(() => ({ first }));
  const prepare = jest.fn(() => ({ bind }));
  return { prepare, _bind: bind, _first: first } as unknown as D1Database & {
    prepare: jest.Mock;
    _bind: jest.Mock;
    _first: jest.Mock;
  };
}

/** Workers-AI mock returning a `response` string (or throwing). */
function makeAi(response: string | null, opts: { throws?: boolean } = {}) {
  return {
    run: jest.fn(async () => {
      if (opts.throws) throw new Error('AI gateway 503');
      return { response: response ?? '' };
    }),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: makeDb(makeEndpoint()),
    AI: makeAi('{"response":"hi"}'),
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ──────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route('/', aiEndpointsPublic);
  return app;
}

/** ExecutionContext so the handler's `executionCtx.waitUntil(...)` works. */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function call(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  env: Env,
  opts: { method?: string; path?: string; body?: unknown } = {},
) {
  const method = opts.method ?? 'GET';
  const path = opts.path ?? '/api/ai/my-site/summarize';
  const init: RequestInit = { method };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  return app.request(path, init, env, makeCtx());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAiLog.mockResolvedValue('log-id-1');
  mockGetBalance.mockResolvedValue(100);
  mockDebitCredits.mockResolvedValue(99);
  mockMaybeFireAlerts.mockResolvedValue(undefined);
  mockLoadTools.mockResolvedValue([]);
  mockExecuteTool.mockResolvedValue({ ok: true, data: { result: 42 } });
});

describe('GET|POST /api/ai/:siteSlug/:endpointSlug', () => {
  // ── Slug resolution + not-found ───────────────────────────────────────────
  it('resolves the endpoint via the site + endpoint slugs', async () => {
    const db = makeDb(makeEndpoint());
    const env = makeEnv({ DB: db });
    const res = await call(makeApp(), env);
    expect(res.status).toBe(200);
    // Slug params bound into the D1 lookup.
    expect((db as unknown as { _bind: jest.Mock })._bind).toHaveBeenCalledWith('my-site', 'summarize');
  });

  it('returns 404 when the site/endpoint slug does not resolve', async () => {
    const env = makeEnv({ DB: makeDb(null) });
    const res = await call(makeApp(), env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('endpoint not found');
    // No credit debit / AI call when the endpoint is missing.
    expect(mockGetBalance).not.toHaveBeenCalled();
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
  });

  // ── Method gating ─────────────────────────────────────────────────────────
  it('returns 405 when the endpoint method disallows the verb', async () => {
    const env = makeEnv({ DB: makeDb(makeEndpoint({ method: 'POST' })) });
    const res = await call(makeApp(), env, { method: 'GET' });
    expect(res.status).toBe(405);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toContain('method GET not allowed');
    expect(mockGetBalance).not.toHaveBeenCalled();
  });

  it('allows the matching verb on a method-restricted endpoint', async () => {
    const env = makeEnv({ DB: makeDb(makeEndpoint({ method: 'GET' })) });
    const res = await call(makeApp(), env, { method: 'GET' });
    expect(res.status).toBe(200);
  });

  // ── Credit gate (fail-closed) ─────────────────────────────────────────────
  it('returns 402 when the owning org has no credits', async () => {
    mockGetBalance.mockResolvedValue(0);
    const env = makeEnv();
    const res = await call(makeApp(), env);
    expect(res.status).toBe(402);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('AI credits exhausted');
    // Fail closed before any AI call or debit.
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
    expect(mockDebitCredits).not.toHaveBeenCalled();
  });

  it('also fails closed on a negative balance', async () => {
    mockGetBalance.mockResolvedValue(-5);
    const res = await call(makeApp(), makeEnv());
    expect(res.status).toBe(402);
  });

  // ── kind='prompt' success ─────────────────────────────────────────────────
  it('runs a prompt endpoint, logs, debits 1 credit, returns the parsed output', async () => {
    const env = makeEnv({ AI: makeAi('{"response":"a summary"}') });
    const res = await call(makeApp(), env, { method: 'POST', body: { text: 'hello' } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      output: { response?: string };
      credits_remaining: number;
      trace_id: string;
    };
    expect(json.ok).toBe(true);
    expect(json.output.response).toBe('a summary');
    expect(json.credits_remaining).toBe(99);
    expect(json.trace_id).toBe('log-id-1');

    expect((env.AI as unknown as { run: jest.Mock }).run).toHaveBeenCalledTimes(1);
    expect(mockWriteAiLog).toHaveBeenCalledTimes(1);
    expect(mockDebitCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-1', siteId: 'site-1', amount: 1, reason: 'endpoint' }),
    );
    expect(mockMaybeFireAlerts).toHaveBeenCalledWith(expect.anything(), 'org-1', 99);
  });

  it('strips ```json fences before parsing the model output', async () => {
    const env = makeEnv({ AI: makeAi('```json\n{"response":"fenced"}\n```') });
    const res = await call(makeApp(), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { output: { response?: string } };
    expect(json.output.response).toBe('fenced');
  });

  it('passes query params through to the AI payload on a GET call', async () => {
    const ai = makeAi('{"response":"ok"}');
    const env = makeEnv({ AI: ai });
    const res = await call(makeApp(), env, { path: '/api/ai/my-site/summarize?q=hello&n=2' });
    expect(res.status).toBe(200);
    const userMsg = ai.run.mock.calls[0][1].messages[1].content as string;
    expect(userMsg).toContain('"q":"hello"');
    expect(userMsg).toContain('"n":"2"');
  });

  it('returns the raw text as output when the model emits non-JSON prose', async () => {
    const env = makeEnv({ AI: makeAi('just some prose, no JSON here') });
    const res = await call(makeApp(), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; output: unknown };
    expect(json.ok).toBe(true);
    expect(json.output).toBe('just some prose, no JSON here');
  });

  // ── Tool-call dispatch ────────────────────────────────────────────────────
  it('executes a tool when the model returns a tool call', async () => {
    mockLoadTools.mockResolvedValue([{ name: 'fetch_weather', description: 'x' }]);
    const env = makeEnv({ AI: makeAi('{"tool":"fetch_weather","args":{"city":"NYC"}}') });
    const res = await call(makeApp(), env, { method: 'POST', body: { city: 'NYC' } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; tool_result: { ok: boolean; data?: unknown } };
    expect(json.ok).toBe(true);
    expect(json.tool_result.ok).toBe(true);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      expect.anything(),
      'site-1',
      expect.objectContaining({ name: 'fetch_weather', arguments: { city: 'NYC' } }),
    );
  });

  it('returns 502 when the dispatched tool fails', async () => {
    mockExecuteTool.mockResolvedValue({ ok: false, error: 'tool blew up' });
    const env = makeEnv({ AI: makeAi('{"tool":"broken_tool","args":{}}') });
    const res = await call(makeApp(), env);
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe('tool blew up');
    // Credit still debited even on tool error (work was performed).
    expect(mockDebitCredits).toHaveBeenCalledTimes(1);
  });

  // ── AI exception ──────────────────────────────────────────────────────────
  it('returns 502 with the error message when the AI call throws', async () => {
    const env = makeEnv({ AI: makeAi(null, { throws: true }) });
    const res = await call(makeApp(), env);
    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe('AI gateway 503');
    // Still logs + debits even on failure.
    expect(mockWriteAiLog).toHaveBeenCalledTimes(1);
    expect(mockDebitCredits).toHaveBeenCalledTimes(1);
  });

  // ── kind='worker' dispatch ────────────────────────────────────────────────
  it('dispatches a worker-kind endpoint to the user Worker and returns its response', async () => {
    mockDispatch.mockResolvedValue(new Response('worker output', { status: 200 }));
    const env = makeEnv({
      DB: makeDb(makeEndpoint({ kind: 'worker', worker_language: 'js', wfp_script_name: 'user-script-1' })),
    });
    const res = await call(makeApp(), env, { method: 'POST', body: { x: 1 } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('worker output');
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][1]).toBe('user-script-1');
    expect(mockWriteAiLog).toHaveBeenCalledTimes(1);
    expect(mockDebitCredits).toHaveBeenCalledTimes(1);
    // Prompt-kind helpers must NOT run for worker dispatch.
    expect((env.AI as unknown as { run: jest.Mock }).run).not.toHaveBeenCalled();
    expect(mockLoadTools).not.toHaveBeenCalled();
  });

  it('returns 503 when a worker-kind endpoint has no deployed script', async () => {
    const env = makeEnv({
      DB: makeDb(makeEndpoint({ kind: 'worker', worker_language: 'js', wfp_script_name: null })),
    });
    const res = await call(makeApp(), env, { method: 'POST', body: {} });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('WFP script not deployed');
    // No dispatch, no debit when the script is missing.
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockDebitCredits).not.toHaveBeenCalled();
  });

  it('logs an error status when the dispatched worker returns a non-2xx response', async () => {
    mockDispatch.mockResolvedValue(new Response('boom', { status: 500 }));
    const env = makeEnv({
      DB: makeDb(makeEndpoint({ kind: 'worker', worker_language: 'py', wfp_script_name: 'user-script-2' })),
    });
    const res = await call(makeApp(), env, { method: 'POST', body: {} });
    expect(res.status).toBe(500);
    expect(mockWriteAiLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAiLog.mock.calls[0][1]).toMatchObject({ status: 'error', traceKind: 'endpoint' });
  });
});
