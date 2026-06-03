/**
 * ai_logger — AI trace persistence to the `ai_form_logs` D1 table.
 *
 * `writeAiLog` is the single boundary that records every form/chat/endpoint/search
 * AI interaction: prompt template, input/output, tool call, model, status, token
 * counts, latency, and credits debited — tagged by org_id + site_id + trace_kind.
 * This suite locks the INSERT contract directly by mocking the D1
 * prepare → bind → run chain (never a real DB):
 *   1. returns a fresh UUID id and inserts exactly one row,
 *   2. positional bind order matches the 21-column INSERT statement,
 *   3. optional fields coalesce to null (submission_id, endpoint_slug, model, …),
 *   4. structured fields (input/outputJson/toolArgs/toolResult) are JSON.stringify'd,
 *   5. JSON-coalescing branch: present → stringified, absent → null,
 *   6. org/site/feature (trace_kind + endpoint_slug) tagging is preserved verbatim,
 *   7. every traceKind + status + toolStatus enum value round-trips,
 *   8. token/cost capture (tokensInput/tokensOutput/creditsDebited) binds through,
 *   9. failure resilience: a DB `.run()` rejection propagates (writeAiLog does NOT
 *      swallow — callers wrap it; this asserts the actual, non-swallowing behavior),
 *  10. `estTokens` ceil-divide-by-4 heuristic across edge inputs.
 *
 * ts-jest: GLOBAL `jest` (no @jest/globals import). D1 stmt mocked, no real APIs.
 */
import { writeAiLog, estTokens, type AiLogInput } from '../services/ai_logger.js';
import type { Env } from '../types/env.js';

// ─── D1 prepare→bind→run chain mock ──────────────────────────────

const runMock = jest.fn().mockResolvedValue({ success: true });
const bindMock = jest.fn().mockReturnValue({ run: runMock });
const prepareMock = jest.fn().mockReturnValue({ bind: bindMock });

const makeEnv = (): Env =>
  ({ DB: { prepare: prepareMock } } as unknown as Env);

/** Returns the positional args passed to `.bind(...)` on the last call. */
const lastBindArgs = (): unknown[] => bindMock.mock.calls[bindMock.mock.calls.length - 1]!;

const baseLog = (over: Partial<AiLogInput> = {}): AiLogInput => ({
  orgId: 'org-123',
  siteId: 'site-456',
  traceKind: 'form',
  status: 'ok',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  runMock.mockResolvedValue({ success: true });
  bindMock.mockReturnValue({ run: runMock });
  prepareMock.mockReturnValue({ bind: bindMock });
});

// ─── writeAiLog — insert contract ────────────────────────────────

describe('writeAiLog', () => {
  it('inserts exactly one row and returns a UUID id', async () => {
    const env = makeEnv();
    const id = await writeAiLog(env, baseLog());

    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(1);
    // RFC4122 v4 shape
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('targets the ai_form_logs table with a 21-placeholder INSERT', async () => {
    await writeAiLog(makeEnv(), baseLog());
    const sql = prepareMock.mock.calls[0]![0] as string;
    expect(sql).toContain('INSERT INTO ai_form_logs');
    expect((sql.match(/\?/g) ?? []).length).toBe(21);
  });

  it('binds positional args in the documented INSERT column order', async () => {
    const env = makeEnv();
    const log = baseLog({
      submissionId: 'sub-1',
      endpointSlug: 'lead-capture',
      promptTemplate: 'tpl-v2',
      input: { q: 'hello' },
      outputText: 'world',
      outputJson: { ok: true },
      toolName: 'search',
      toolArgs: { term: 'pizza' },
      toolResult: [{ hit: 1 }],
      toolStatus: 'ok',
      model: 'llama-3.3-70b',
      status: 'ok',
      errorMessage: 'none',
      latencyMs: 1234,
      tokensInput: 42,
      tokensOutput: 99,
      creditsDebited: 7,
    });
    const id = await writeAiLog(env, log);
    const args = lastBindArgs();

    expect(args[0]).toBe(id); // generated id is bound first
    expect(args[1]).toBe('org-123'); // org_id
    expect(args[2]).toBe('site-456'); // site_id
    expect(args[3]).toBe('sub-1'); // submission_id
    expect(args[4]).toBe('form'); // trace_kind
    expect(args[5]).toBe('lead-capture'); // endpoint_slug
    expect(args[6]).toBe('tpl-v2'); // prompt_template
    expect(args[7]).toBe(JSON.stringify({ q: 'hello' })); // input_json
    expect(args[8]).toBe('world'); // output_text
    expect(args[9]).toBe(JSON.stringify({ ok: true })); // output_json
    expect(args[10]).toBe('search'); // tool_name
    expect(args[11]).toBe(JSON.stringify({ term: 'pizza' })); // tool_args_json
    expect(args[12]).toBe(JSON.stringify([{ hit: 1 }])); // tool_result_json
    expect(args[13]).toBe('ok'); // tool_status
    expect(args[14]).toBe('llama-3.3-70b'); // model
    expect(args[15]).toBe('ok'); // status
    expect(args[16]).toBe('none'); // error_message
    expect(args[17]).toBe(1234); // latency_ms
    expect(args[18]).toBe(42); // tokens_input
    expect(args[19]).toBe(99); // tokens_output
    expect(args[20]).toBe(7); // credits_debited
  });

  it('coalesces every optional scalar to null when omitted', async () => {
    await writeAiLog(makeEnv(), baseLog()); // only required fields
    const args = lastBindArgs();

    expect(args[3]).toBeNull(); // submission_id
    expect(args[5]).toBeNull(); // endpoint_slug
    expect(args[6]).toBeNull(); // prompt_template
    expect(args[8]).toBeNull(); // output_text
    expect(args[10]).toBeNull(); // tool_name
    expect(args[13]).toBeNull(); // tool_status
    expect(args[14]).toBeNull(); // model
    expect(args[16]).toBeNull(); // error_message
    expect(args[17]).toBeNull(); // latency_ms
    expect(args[18]).toBeNull(); // tokens_input
    expect(args[19]).toBeNull(); // tokens_output
    expect(args[20]).toBeNull(); // credits_debited
  });

  it('stringifies input as JSON null when input is omitted (input ?? null)', async () => {
    await writeAiLog(makeEnv(), baseLog());
    // input branch is `JSON.stringify(log.input ?? null)` → the literal string "null"
    expect(lastBindArgs()[7]).toBe('null');
  });

  it('preserves an explicit submissionId === null (?? leaves null)', async () => {
    await writeAiLog(makeEnv(), baseLog({ submissionId: null }));
    expect(lastBindArgs()[3]).toBeNull();
  });

  // ── JSON-coalescing branch (present → stringify, absent → null) ──

  it('stringifies outputJson / toolArgs / toolResult only when present', async () => {
    await writeAiLog(
      makeEnv(),
      baseLog({ outputJson: { a: 1 }, toolArgs: { b: 2 }, toolResult: { c: 3 } }),
    );
    const args = lastBindArgs();
    expect(args[9]).toBe(JSON.stringify({ a: 1 }));
    expect(args[11]).toBe(JSON.stringify({ b: 2 }));
    expect(args[12]).toBe(JSON.stringify({ c: 3 }));
  });

  it('binds null for outputJson / toolArgs / toolResult when absent', async () => {
    await writeAiLog(makeEnv(), baseLog());
    const args = lastBindArgs();
    expect(args[9]).toBeNull(); // output_json
    expect(args[11]).toBeNull(); // tool_args_json
    expect(args[12]).toBeNull(); // tool_result_json
  });

  it('treats falsy-but-present JSON values (0, false) as absent → null', async () => {
    // The source uses `log.outputJson ? ... : null`, so 0 / false / '' bind null.
    await writeAiLog(
      makeEnv(),
      baseLog({ outputJson: 0, toolArgs: false, toolResult: '' }),
    );
    const args = lastBindArgs();
    expect(args[9]).toBeNull();
    expect(args[11]).toBeNull();
    expect(args[12]).toBeNull();
  });

  // ── org/site/feature tagging ──

  it('preserves org/site/trace_kind/endpoint tagging verbatim', async () => {
    await writeAiLog(
      makeEnv(),
      baseLog({ orgId: 'org-XYZ', siteId: 'site-ABC', traceKind: 'endpoint', endpointSlug: 'quote' }),
    );
    const args = lastBindArgs();
    expect(args[1]).toBe('org-XYZ');
    expect(args[2]).toBe('site-ABC');
    expect(args[4]).toBe('endpoint');
    expect(args[5]).toBe('quote');
  });

  // ── enum coverage ──

  it.each<AiLogInput['traceKind']>(['form', 'chat', 'endpoint', 'search'])(
    'binds traceKind=%s through to trace_kind',
    async (traceKind) => {
      await writeAiLog(makeEnv(), baseLog({ traceKind }));
      expect(lastBindArgs()[4]).toBe(traceKind);
    },
  );

  it.each<AiLogInput['status']>(['ok', 'error', 'rate_limited'])(
    'binds status=%s through to status column',
    async (status) => {
      await writeAiLog(makeEnv(), baseLog({ status }));
      expect(lastBindArgs()[15]).toBe(status);
    },
  );

  it.each<NonNullable<AiLogInput['toolStatus']>>(['ok', 'error', 'skipped'])(
    'binds toolStatus=%s through to tool_status column',
    async (toolStatus) => {
      await writeAiLog(makeEnv(), baseLog({ toolStatus }));
      expect(lastBindArgs()[13]).toBe(toolStatus);
    },
  );

  // ── token / cost capture ──

  it('captures token counts and credits debited as numbers', async () => {
    await writeAiLog(
      makeEnv(),
      baseLog({ tokensInput: 0, tokensOutput: 2048, creditsDebited: 0 }),
    );
    const args = lastBindArgs();
    // 0 is a valid numeric value, NOT coalesced to null (uses `?? null`).
    expect(args[18]).toBe(0);
    expect(args[19]).toBe(2048);
    expect(args[20]).toBe(0);
  });

  it('records an error status with its message and latency', async () => {
    await writeAiLog(
      makeEnv(),
      baseLog({ status: 'error', errorMessage: 'upstream 500', latencyMs: 87 }),
    );
    const args = lastBindArgs();
    expect(args[15]).toBe('error');
    expect(args[16]).toBe('upstream 500');
    expect(args[17]).toBe(87);
  });

  // ── failure behavior (actual: propagates, does NOT swallow) ──

  it('propagates a D1 run() rejection to the caller', async () => {
    runMock.mockRejectedValueOnce(new Error('D1 write failed'));
    await expect(writeAiLog(makeEnv(), baseLog())).rejects.toThrow('D1 write failed');
  });

  it('still issues exactly one prepare/bind/run on the failing path', async () => {
    runMock.mockRejectedValueOnce(new Error('boom'));
    await expect(writeAiLog(makeEnv(), baseLog())).rejects.toThrow('boom');
    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('returns distinct ids across successive writes (fresh UUID per call)', async () => {
    const env = makeEnv();
    const a = await writeAiLog(env, baseLog());
    const b = await writeAiLog(env, baseLog());
    expect(a).not.toBe(b);
  });
});

// ─── estTokens — ceil(length / 4) heuristic ──────────────────────

describe('estTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estTokens('')).toBe(0);
  });

  it.each([
    ['a', 1],
    ['abcd', 1],
    ['abcde', 2],
    ['abcdefgh', 2],
    ['abcdefghi', 3],
  ])('ceil-divides length by 4: %j → %i', (input, expected) => {
    expect(estTokens(input as string)).toBe(expected);
  });

  it('counts unicode by JS string length (UTF-16 code units)', () => {
    // 'café ☕' is 6 UTF-16 code units → ceil(6/4)=2, same as '123456'.
    expect(estTokens('café ☕')).toBe(estTokens('123456'));
  });
});
