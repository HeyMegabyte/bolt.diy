/**
 * AI Env Vars service — encrypt round-trip + masked listing + scope-precedence
 * merge in `resolveEnvVarsForAI`.
 *
 * Mocks `services/db.js` so each test fully controls the row store. The
 * AES-GCM round-trip uses real `crypto.subtle` (Node 22 has WebCrypto
 * globally — same as the Workers runtime).
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbExecute: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
}));

import { dbQuery, dbQueryOne, dbExecute } from '../services/db.js';
import {
  setEnvVar,
  listEnvVars,
  resolveEnvVarsForAI,
  resolveEnvVarsForFunctions,
  injectIntoSystemPrompt,
  type EnvVarScope,
} from '../services/ai_env_vars.js';
import { encrypt } from '../services/ai_crypto.js';
import type { Env } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

/** Build a minimally-typed Env stub carrying only what the service touches. */
function makeEnv(): Env {
  // 32-byte AES key, base64-encoded.
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) keyBytes[i] = i + 1;
  let keyB64 = '';
  for (const byte of keyBytes) keyB64 += String.fromCharCode(byte);
  return {
    DB: {} as D1Database,
    MCP_ENCRYPTION_KEY: btoa(keyB64),
  } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// AES-GCM round-trip via encrypt/decrypt (smoke test)
// ────────────────────────────────────────────────────────────
describe('ai_crypto round-trip (via setEnvVar)', () => {
  it('encrypts a value on set, returns masked on read, decrypts to original', async () => {
    const env = makeEnv();
    const storedRow = {
      id: 'row-1',
      org_id: 'org-A',
      scope: 'org' as const,
      site_id: null,
      mcp_provider: null,
      key: 'API_TOKEN',
      value_encrypted: '',
      description: null,
      is_secret: 1,
      exposed_to_ai: 1,
      created_by: null,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    };

    mockExecute.mockResolvedValueOnce({ error: null, changes: 1 });
    // setEnvVar's re-fetch lookup. We capture the ciphertext from the dbExecute
    // call so the re-fetch row carries a value that actually decrypts.
    mockQueryOne.mockImplementation(async () => {
      const call = mockExecute.mock.calls[0];
      const params = call?.[2] as unknown[];
      const ciphertext = params?.[8] as string;
      return { ...storedRow, value_encrypted: ciphertext };
    });

    const result = await setEnvVar(env, {
      orgId: 'org-A',
      scope: 'org',
      key: 'API_TOKEN',
      value: 'sk-live-abcdef1234567890',
    });

    expect(result.key).toBe('API_TOKEN');
    expect(result.is_secret).toBe(true);
    expect(result.value_masked.startsWith('••••')).toBe(true);
    // Last 4 chars of plaintext should appear at the tail of the mask.
    expect(result.value_masked.endsWith('7890')).toBe(true);
    // Plaintext should never be returned by setEnvVar.
    expect(result.value).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// setEnvVar upsert — the ON CONFLICT target MUST match the per-scope PARTIAL
// unique index. Regression for the live bug where a single unified
// `ON CONFLICT(org_id, scope, COALESCE(site_id,''), …, key)` matched NO index
// → SQLITE_ERROR "does not match any PRIMARY KEY or UNIQUE constraint" → every
// create/upsert 400ed. The D1 mock can't reproduce a real constraint error, so
// we assert the SQL is built to target the correct partial index per scope.
// ────────────────────────────────────────────────────────────
describe('setEnvVar — per-scope ON CONFLICT target matches the partial index', () => {
  const cases: Array<{ scope: EnvVarScope; extra: Record<string, string>; target: string }> = [
    {
      scope: 'org',
      extra: {},
      target: "ON CONFLICT (org_id, key) WHERE scope = 'org' AND deleted_at IS NULL",
    },
    {
      scope: 'site',
      extra: { siteId: 's1' },
      target: "ON CONFLICT (org_id, site_id, key) WHERE scope = 'site' AND deleted_at IS NULL",
    },
    {
      scope: 'mcp',
      extra: { mcpProvider: 'stripe' },
      target: "ON CONFLICT (org_id, mcp_provider, key) WHERE scope = 'mcp' AND deleted_at IS NULL",
    },
    {
      scope: 'endpoint',
      extra: { endpointId: 'e1' },
      target:
        "ON CONFLICT (org_id, endpoint_id, key) WHERE scope = 'endpoint' AND deleted_at IS NULL",
    },
    {
      scope: 'agent',
      extra: { agentId: 'a1' },
      target: "ON CONFLICT (org_id, agent_id, key) WHERE scope = 'agent' AND deleted_at IS NULL",
    },
  ];

  for (const { scope, extra, target } of cases) {
    it(`scope=${scope} targets its own partial index`, async () => {
      const env = makeEnv();
      mockExecute.mockResolvedValueOnce({ error: null, changes: 1 });
      const ciphertext = await encrypt(env, 'v');
      mockQueryOne.mockResolvedValueOnce({
        id: 'r',
        org_id: 'org-A',
        scope,
        site_id: null,
        mcp_provider: null,
        key: 'K',
        value_encrypted: ciphertext,
        description: null,
        is_secret: 1,
        exposed_to_ai: 1,
        created_by: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      } as never);

      await setEnvVar(env, { orgId: 'org-A', scope, key: 'K', value: 'v', ...extra });

      const sql = ((mockExecute.mock.calls[0]?.[1] as string) ?? '').replace(/\s+/g, ' ').trim();
      expect(sql).toContain(target);
      // The old bug shape must be gone (matched no index).
      expect(sql).not.toContain('COALESCE(site_id');
      expect(sql).not.toContain('ON CONFLICT(org_id, scope,');
    });
  }
});

// ────────────────────────────────────────────────────────────
// listEnvVars — masking discipline
// ────────────────────────────────────────────────────────────
describe('listEnvVars', () => {
  it('returns masked values by default, never plaintext', async () => {
    const env = makeEnv();
    const ciphertext = await encrypt(env, 'shhh-this-is-secret');
    mockQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'row-1',
          org_id: 'org-A',
          scope: 'org' as const,
          site_id: null,
          mcp_provider: null,
          key: 'TOKEN',
          value_encrypted: ciphertext,
          description: 'desc',
          is_secret: 1,
          exposed_to_ai: 1,
          created_by: null,
          created_at: 1,
          updated_at: 1,
          deleted_at: null,
        },
      ],
      error: null,
    });

    const out = await listEnvVars(env, 'org-A');
    expect(out).toHaveLength(1);
    expect(out[0].value_masked).toBe('••••cret');
    expect(out[0].value).toBeUndefined();
    expect(out[0].is_secret).toBe(true);
    expect(out[0].exposed_to_ai).toBe(true);
  });

  it('returns plaintext when unmask=true (server-side only)', async () => {
    const env = makeEnv();
    const ciphertext = await encrypt(env, 'open-config-value');
    mockQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'row-1',
          org_id: 'org-A',
          scope: 'org' as const,
          site_id: null,
          mcp_provider: null,
          key: 'PUBLIC_CFG',
          value_encrypted: ciphertext,
          description: null,
          is_secret: 0,
          exposed_to_ai: 1,
          created_by: null,
          created_at: 1,
          updated_at: 1,
          deleted_at: null,
        },
      ],
      error: null,
    });
    const out = await listEnvVars(env, 'org-A', { unmask: true });
    expect(out[0].value).toBe('open-config-value');
    // is_secret=0 ⇒ value_masked = plaintext (it's not actually a secret).
    expect(out[0].value_masked).toBe('open-config-value');
  });
});

// ────────────────────────────────────────────────────────────
// resolveEnvVarsForAI — scope precedence merge
// ────────────────────────────────────────────────────────────
describe('resolveEnvVarsForAI', () => {
  it('merges org → site → mcp with correct override precedence', async () => {
    const env = makeEnv();
    const enc = (s: string) => encrypt(env, s);

    const rows = [
      // org-scope baseline
      {
        id: 'r1',
        org_id: 'org-A',
        scope: 'org' as const,
        site_id: null,
        mcp_provider: null,
        key: 'API_BASE',
        value_encrypted: await enc('https://org-default.example'),
        description: null,
        is_secret: 1,
        exposed_to_ai: 1,
        created_by: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      },
      {
        id: 'r2',
        org_id: 'org-A',
        scope: 'org' as const,
        site_id: null,
        mcp_provider: null,
        key: 'ORG_ONLY',
        value_encrypted: await enc('only-at-org'),
        description: null,
        is_secret: 1,
        exposed_to_ai: 1,
        created_by: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      },
      // site overrides API_BASE
      {
        id: 'r3',
        org_id: 'org-A',
        scope: 'site' as const,
        site_id: 'site-1',
        mcp_provider: null,
        key: 'API_BASE',
        value_encrypted: await enc('https://site.example'),
        description: null,
        is_secret: 1,
        exposed_to_ai: 1,
        created_by: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      },
      // mcp overrides API_BASE again (highest precedence)
      {
        id: 'r4',
        org_id: 'org-A',
        scope: 'mcp' as const,
        site_id: null,
        mcp_provider: 'mailchimp',
        key: 'API_BASE',
        value_encrypted: await enc('https://mailchimp.example'),
        description: null,
        is_secret: 1,
        exposed_to_ai: 1,
        created_by: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      },
      // mcp-only key — should appear in result
      {
        id: 'r5',
        org_id: 'org-A',
        scope: 'mcp' as const,
        site_id: null,
        mcp_provider: 'mailchimp',
        key: 'MAILCHIMP_LIST_ID',
        value_encrypted: await enc('abc123'),
        description: null,
        is_secret: 1,
        exposed_to_ai: 1,
        created_by: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      },
      // exposed_to_ai=0 — should NOT appear (we'll filter it from the candidate set).
      // For test simplicity, we just don't include it — the SQL excludes it.
    ];

    mockQuery.mockResolvedValueOnce({ data: rows, error: null });

    const merged = await resolveEnvVarsForAI(env, {
      orgId: 'org-A',
      siteId: 'site-1',
      mcpProvider: 'mailchimp',
    });

    // mcp wins over site wins over org.
    expect(merged.API_BASE).toBe('https://mailchimp.example');
    expect(merged.ORG_ONLY).toBe('only-at-org');
    expect(merged.MAILCHIMP_LIST_ID).toBe('abc123');

    // Verify the SQL filter included exposed_to_ai = 1.
    const sql = mockQuery.mock.calls[0][1];
    expect(sql).toContain('exposed_to_ai = 1');
  });

  it('returns empty object when no rows match', async () => {
    const env = makeEnv();
    mockQuery.mockResolvedValueOnce({ data: [], error: null });
    const merged = await resolveEnvVarsForAI(env, { orgId: 'org-A' });
    expect(merged).toEqual({});
  });
});

// ────────────────────────────────────────────────────────────
// injectIntoSystemPrompt
// ────────────────────────────────────────────────────────────
describe('injectIntoSystemPrompt', () => {
  it('returns the prompt unchanged when no env vars are resolved', () => {
    const out = injectIntoSystemPrompt('You are helpful.', {});
    expect(out).toBe('You are helpful.');
  });

  it('appends a "## Custom environment" block with KEY=VALUE lines', () => {
    const out = injectIntoSystemPrompt('You are helpful.', {
      API_BASE: 'https://api.example',
      FEATURE_FLAG: 'on',
    });
    expect(out).toContain('## Custom environment');
    expect(out).toContain('API_BASE=https://api.example');
    expect(out).toContain('FEATURE_FLAG=on');
  });

  it('sorts keys alphabetically for deterministic output', () => {
    const out = injectIntoSystemPrompt('p', { Z: '1', A: '2', M: '3' });
    const idxA = out.indexOf('A=');
    const idxM = out.indexOf('M=');
    const idxZ = out.indexOf('Z=');
    expect(idxA).toBeLessThan(idxM);
    expect(idxM).toBeLessThan(idxZ);
  });
});

// ────────────────────────────────────────────────────────────
// resolveEnvVarsForFunctions — Stage 4.1 env.SECRETS (org→site, no AI filter)
// ────────────────────────────────────────────────────────────
describe('resolveEnvVarsForFunctions (Stage 4.1 — env.SECRETS)', () => {
  /** Build a full-ish EnvVarRow with defaults; `data` is typed `unknown[]` in the mock. */
  function fnRow(over: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'row-1',
      org_id: 'org-A',
      scope: 'org',
      site_id: null,
      mcp_provider: null,
      endpoint_id: null,
      agent_id: null,
      key: 'K',
      value_encrypted: '',
      description: null,
      is_secret: 1,
      exposed_to_ai: 1,
      created_by: null,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
      ...over,
    };
  }

  it('merges org → site (site overrides org) with NO exposed_to_ai filter', async () => {
    const env = makeEnv();
    const rows = [
      fnRow({ key: 'API_KEY', value_encrypted: await encrypt(env, 'org-key'), exposed_to_ai: 0 }),
      fnRow({ key: 'ORG_ONLY', value_encrypted: await encrypt(env, 'org-val') }),
      fnRow({
        scope: 'site',
        site_id: 'site-1',
        key: 'API_KEY',
        value_encrypted: await encrypt(env, 'site-key'),
        exposed_to_ai: 0,
      }),
    ];
    mockQuery.mockResolvedValueOnce({ data: rows, error: null });
    const out = await resolveEnvVarsForFunctions(env, 'org-A', 'site-1');
    // site overrides org; the exposed_to_ai=0 rows are STILL included (owner code).
    expect(out).toEqual({ API_KEY: 'site-key', ORG_ONLY: 'org-val' });
    // the SQL must NOT filter on exposed_to_ai (unlike resolveEnvVarsForAI).
    expect(mockQuery.mock.calls.at(-1)![1]).not.toContain('exposed_to_ai');
  });

  it('queries only org-scope + THIS site (no cross-site rows leak)', async () => {
    const env = makeEnv();
    mockQuery.mockResolvedValueOnce({ data: [], error: null });
    await resolveEnvVarsForFunctions(env, 'org-A', 'site-1');
    const [, sql, params] = mockQuery.mock.calls.at(-1)!;
    expect(sql).toContain("scope = 'org'");
    expect(sql).toContain("scope = 'site' AND site_id = ?");
    expect(sql).toContain('deleted_at IS NULL');
    expect(params).toEqual(['org-A', 'site-1']);
  });

  it('skips a row that fails to decrypt (fail-soft) + keeps the rest', async () => {
    const env = makeEnv();
    const rows = [
      fnRow({ key: 'GOOD', value_encrypted: await encrypt(env, 'good') }),
      fnRow({ key: 'BAD', value_encrypted: 'not-valid-ciphertext' }),
    ];
    mockQuery.mockResolvedValueOnce({ data: rows, error: null });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await resolveEnvVarsForFunctions(env, 'org-A', 'site-1');
    warnSpy.mockRestore();
    expect(out).toEqual({ GOOD: 'good' });
  });
});
