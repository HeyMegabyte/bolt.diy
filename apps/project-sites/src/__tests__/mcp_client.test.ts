/**
 * Unit coverage for services/mcp_client — the MCP provider-adapter registry +
 * per-site connection loading + LLM tool dispatch (the agent-integration moat).
 *
 * Focuses on the stable public surface: getAdapter / allProviders, the
 * ToolDescriptor contract every adapter must satisfy, paste-key authorizeUrl
 * markers, and loadConnections/loadAvailableTools/executeTool with D1 + decrypt
 * mocked. (Per-adapter live HTTP execution is out of scope — that needs each
 * vendor's fetch shape; covered indirectly via tool-ownership dispatch.)
 */
jest.mock('../services/ai_crypto.js', () => ({ decrypt: jest.fn() }));

import { decrypt } from '../services/ai_crypto.js';
import {
  getAdapter,
  allProviders,
  loadConnections,
  loadAvailableTools,
  executeTool,
  type Provider,
} from '../services/mcp_client.js';

const mockDecrypt = decrypt as unknown as jest.Mock;

/** Build an env whose DB.prepare().bind().all() yields the given rows. */
function envWithRows(rows: unknown[]) {
  const bind = jest.fn().mockReturnValue({ all: jest.fn().mockResolvedValue({ results: rows }) });
  const prepare = jest.fn().mockReturnValue({ bind });
  return { env: { DB: { prepare }, MCP_ENCRYPTION_KEY: 'k' } as never, prepare, bind };
}

beforeEach(() => jest.clearAllMocks());

describe('registry — allProviders / getAdapter', () => {
  it('lists every provider that ships a worker adapter', () => {
    const ps = allProviders();
    for (const expected of ['mailchimp', 'stripe', 'resend', 'hubspot', 'slack', 'notion', 'github', 'linear', 'discord', 'google_calendar', 'twilio', 'calendly', 'airtable', 'zapier', 'pagerduty']) {
      expect(ps).toContain(expected as Provider);
    }
  });

  it('excludes OAuth-only providers that have no tool surface yet', () => {
    const ps = allProviders();
    for (const oauthOnly of ['cal_com', 'sentry', 'posthog', 'vercel', 'netlify']) {
      expect(ps).not.toContain(oauthOnly as Provider);
    }
  });

  it('getAdapter returns a fully-shaped adapter for a known provider', () => {
    const a = getAdapter('mailchimp');
    expect(a).toBeDefined();
    expect(a!.provider).toBe('mailchimp');
    expect(typeof a!.authorizeUrl).toBe('function');
    expect(typeof a!.exchangeCode).toBe('function');
    expect(typeof a!.tools).toBe('function');
    expect(typeof a!.execute).toBe('function');
  });

  it('getAdapter returns undefined for an OAuth-only provider', () => {
    expect(getAdapter('vercel')).toBeUndefined();
  });
});

describe('ToolDescriptor contract — every adapter', () => {
  it('every adapter exposes valid tool descriptors', () => {
    for (const p of allProviders()) {
      const tools = getAdapter(p)!.tools();
      expect(Array.isArray(tools)).toBe(true);
      for (const t of tools) {
        expect(typeof t.name).toBe('string');
        expect(t.name.length).toBeGreaterThan(0);
        expect(typeof t.description).toBe('string');
        expect(typeof t.parameters).toBe('object');
        expect(t.parameters).not.toBeNull();
      }
    }
  });

  it('tool names are unique within each adapter', () => {
    for (const p of allProviders()) {
      const names = getAdapter(p)!.tools().map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe('authorizeUrl — paste-key providers', () => {
  it('resend returns the __paste_key__ marker carrying state', () => {
    const url = getAdapter('resend')!.authorizeUrl({} as never, { state: 'abc123', returnUrl: 'https://x' });
    expect(url).toContain('__paste_key__');
    expect(url).toContain('state=abc123');
  });
});

describe('loadConnections', () => {
  it('decrypts active rows into ActiveConnection objects', async () => {
    mockDecrypt.mockResolvedValue('plain-token');
    const { env } = envWithRows([
      { provider: 'stripe', access_token_encrypted: 'ct', account_metadata_json: '{"acct":"a1"}' },
    ]);
    const conns = await loadConnections(env, 'site-1');
    expect(conns).toHaveLength(1);
    expect(conns[0]).toEqual({ provider: 'stripe', accessToken: 'plain-token', metadata: { acct: 'a1' } });
  });

  it('silently skips rows whose ciphertext fails to decrypt', async () => {
    mockDecrypt
      .mockResolvedValueOnce('ok-token')
      .mockRejectedValueOnce(new Error('bad key'));
    const { env } = envWithRows([
      { provider: 'stripe', access_token_encrypted: 'good', account_metadata_json: null },
      { provider: 'slack', access_token_encrypted: 'bad', account_metadata_json: null },
    ]);
    const conns = await loadConnections(env, 'site-1');
    expect(conns).toHaveLength(1);
    expect(conns[0].provider).toBe('stripe');
    expect(conns[0].metadata).toEqual({}); // null metadata → {}
  });

  it('passes a provider filter into the bind args', async () => {
    mockDecrypt.mockResolvedValue('t');
    const { env, prepare, bind } = envWithRows([]);
    await loadConnections(env, 'site-9', ['stripe', 'slack']);
    expect(prepare.mock.calls[0][0]).toContain('provider IN (?,?)');
    expect(bind).toHaveBeenCalledWith('site-9', 'stripe', 'slack');
  });

  it('returns empty when there are no active rows', async () => {
    const { env } = envWithRows([]);
    expect(await loadConnections(env, 'site-x')).toEqual([]);
  });
});

describe('loadAvailableTools', () => {
  it('flattens tool descriptors across connected providers', async () => {
    mockDecrypt.mockResolvedValue('t');
    const { env } = envWithRows([
      { provider: 'mailchimp', access_token_encrypted: 'ct', account_metadata_json: null },
    ]);
    const tools = await loadAvailableTools(env, 'site-1');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => typeof t.name === 'string')).toBe(true);
  });

  it('returns no tools when nothing is connected', async () => {
    const { env } = envWithRows([]);
    expect(await loadAvailableTools(env, 'site-1')).toEqual([]);
  });
});

describe('executeTool — dispatch', () => {
  it('returns a no-provider error when nothing is connected', async () => {
    const { env } = envWithRows([]);
    const res = await executeTool(env, 'site-1', { name: 'add_to_mailchimp', arguments: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no connected provider');
  });

  it('returns a no-provider error when the connection does not own the tool', async () => {
    mockDecrypt.mockResolvedValue('t');
    const { env } = envWithRows([
      { provider: 'mailchimp', access_token_encrypted: 'ct', account_metadata_json: null },
    ]);
    const res = await executeTool(env, 'site-1', { name: 'nonexistent.tool', arguments: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no connected provider');
  });
});
