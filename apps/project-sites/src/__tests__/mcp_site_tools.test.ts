/**
 * @module __tests__/mcp_site_tools
 * @description Unit coverage for the MCP per-site CRUD tool handlers (#29).
 *
 * Covers: the canonical `SITE_MCP_TOOLS` registry shape, token mint/verify/revoke
 * (hashing + last_used side-effect + revoked-token rejection), the `dispatchTool`
 * router for every tool name (success, input-validation rejection, unknown-tool,
 * thrown-error envelope), arg defaults (limit clamping), and org/site scoping
 * (every query carries the siteId). The `db.js` helpers are mocked so nothing
 * touches a real D1; `crypto.subtle`/`randomUUID` are stubbed for determinism.
 *
 * Additive only — no existing spec is modified.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import {
  SITE_MCP_TOOLS,
  dispatchTool,
  mintSiteMcpToken,
  verifySiteMcpToken,
  revokeSiteMcpToken,
  type McpToolDef,
  type ToolResult,
} from '../services/mcp_site_tools.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import type { D1Database } from '@cloudflare/workers-types';

const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;

/** Stand-in for the D1 handle — never actually invoked (helpers are mocked). */
const db = {} as unknown as D1Database;

const SITE = 'site-1';

/** Deterministic crypto: predictable UUIDs + a stable SHA-256 digest. */
let uuidCounter = 0;
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      // Hex-only UUID so `.replace(/-/g,'')` yields a pure-hex token body.
      randomUUID: () =>
        `${(++uuidCounter).toString(16).padStart(8, '0')}-abcd-4ef0-8123-abcdef012345`,
      subtle: {
        // Return a fixed 32-byte buffer so hashToken is deterministic.
        digest: async (_alg: string, _data: ArrayBuffer) =>
          new Uint8Array(32).fill(0xab).buffer,
      },
    },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  uuidCounter = 0;
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

const textOf = (r: ToolResult) => r.content[0]?.text ?? '';

// ─── Tool registry shape ──────────────────────────────────────────────
describe('SITE_MCP_TOOLS registry', () => {
  it('exposes the 9 canonical tools', () => {
    const names = SITE_MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'list_pages',
      'read_page',
      'update_page_section',
      'create_page',
      'list_form_submissions',
      'list_blog_posts',
      'create_blog_post',
      'get_analytics_summary',
      'list_media_assets',
    ]);
  });

  it('every tool has a non-empty description + object inputSchema', () => {
    for (const t of SITE_MCP_TOOLS as readonly McpToolDef[]) {
      expect(typeof t.name).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.inputSchema.properties).toBe('object');
    }
  });

  it('required-input tools declare their required[] keys', () => {
    const byName = (n: string) => SITE_MCP_TOOLS.find((t) => t.name === n)!;
    expect(byName('read_page').inputSchema.required).toEqual(['slug']);
    expect(byName('update_page_section').inputSchema.required).toEqual([
      'slug',
      'section_id',
      'content',
    ]);
    expect(byName('create_page').inputSchema.required).toEqual(['slug', 'title', 'content']);
    expect(byName('create_blog_post').inputSchema.required).toEqual(['title', 'content']);
  });

  it('no-arg tools omit required[]', () => {
    const byName = (n: string) => SITE_MCP_TOOLS.find((t) => t.name === n)!;
    expect(byName('list_pages').inputSchema.required).toBeUndefined();
    expect(byName('get_analytics_summary').inputSchema.required).toBeUndefined();
  });
});

// ─── Token management ─────────────────────────────────────────────────
describe('token management', () => {
  it('mintSiteMcpToken returns a ps_mcp_ raw token + id, stores a hash (never the raw)', async () => {
    const out = await mintSiteMcpToken(db, SITE, 'user-1', 'CI');
    expect(out.token).toMatch(/^ps_mcp_[0-9a-f]+$/);
    expect(typeof out.id).toBe('string');
    expect(out.id.length).toBeGreaterThan(0);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('site_mcp_tokens');
    expect(record.site_id).toBe(SITE);
    expect(record.created_by).toBe('user-1');
    expect(record.label).toBe('CI');
    // Hash stored, raw token NOT stored.
    expect(record.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.token_hash).not.toBe(out.token);
  });

  it('mintSiteMcpToken defaults the label to "Default"', async () => {
    await mintSiteMcpToken(db, SITE, 'user-1');
    expect(mockInsert.mock.calls[0][2].label).toBe('Default');
  });

  it('verifySiteMcpToken returns true + bumps last_used when the hash matches', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'tok-1' });
    const ok = await verifySiteMcpToken(db, SITE, 'ps_mcp_whatever');
    expect(ok).toBe(true);
    // Scoped by site_id + token_hash + revoked_at IS NULL.
    const [, sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('site_id = ?');
    expect(sql).toContain('revoked_at IS NULL');
    expect(params[0]).toBe(SITE);
    // last_used update is fire-and-forget but must target the matched row.
    expect(mockUpdate).toHaveBeenCalledWith(
      db,
      'site_mcp_tokens',
      expect.objectContaining({ last_used: expect.any(String) }),
      'id = ?',
      ['tok-1'],
    );
  });

  it('verifySiteMcpToken returns false + does NOT bump last_used when no row matches', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const ok = await verifySiteMcpToken(db, SITE, 'ps_mcp_bad');
    expect(ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('revokeSiteMcpToken sets revoked_at scoped by token id AND site id', async () => {
    await revokeSiteMcpToken(db, 'tok-9', SITE);
    expect(mockUpdate).toHaveBeenCalledWith(
      db,
      'site_mcp_tokens',
      expect.objectContaining({ revoked_at: expect.any(String) }),
      'id = ? AND site_id = ?',
      ['tok-9', SITE],
    );
  });
});

// ─── dispatchTool — routing + success ─────────────────────────────────
describe('dispatchTool — success routing', () => {
  it('list_pages queries site_pages scoped to the site', async () => {
    mockQuery.mockResolvedValueOnce({ data: [{ slug: '/', title: 'Home' }], error: null });
    const r = await dispatchTool(db, SITE, 'list_pages', {});
    expect(r.isError).toBeUndefined();
    const [, sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM site_pages');
    expect(params).toEqual([SITE]);
    expect(JSON.parse(textOf(r))).toEqual([{ slug: '/', title: 'Home' }]);
  });

  it('read_page returns the row when found', async () => {
    mockQueryOne.mockResolvedValueOnce({ slug: '/about', title: 'About', content: 'x' });
    const r = await dispatchTool(db, SITE, 'read_page', { slug: '/about' });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(textOf(r)).slug).toBe('/about');
  });

  it('create_page inserts a new row scoped to the site and reports the id', async () => {
    const r = await dispatchTool(db, SITE, 'create_page', {
      slug: '/new',
      title: 'New',
      content: '<p>hi</p>',
    });
    expect(r.isError).toBeUndefined();
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('site_pages');
    expect(record.site_id).toBe(SITE);
    expect(record.slug).toBe('/new');
    expect(textOf(r)).toContain('Page created: /new');
  });

  it('update_page_section merges the section into existing content JSON', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'pg-1', content: JSON.stringify({ hero: 'old' }) });
    const r = await dispatchTool(db, SITE, 'update_page_section', {
      slug: '/',
      section_id: 'cta',
      content: 'new-cta',
    });
    expect(r.isError).toBeUndefined();
    const [, table, updates, where, params] = mockUpdate.mock.calls[0];
    expect(table).toBe('site_pages');
    expect(JSON.parse(updates.content)).toEqual({ hero: 'old', cta: 'new-cta' });
    expect(where).toBe('id = ?');
    expect(params).toEqual(['pg-1']);
    expect(textOf(r)).toContain('updated on /');
  });

  it('update_page_section tolerates non-JSON existing content (safeParse → {})', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'pg-2', content: 'not-json{' });
    const r = await dispatchTool(db, SITE, 'update_page_section', {
      slug: '/',
      section_id: 's',
      content: 'v',
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(mockUpdate.mock.calls[0][2].content)).toEqual({ s: 'v' });
  });

  it('create_blog_post auto-generates a slug from the title when omitted', async () => {
    const r = await dispatchTool(db, SITE, 'create_blog_post', {
      title: 'Hello World!',
      content: 'body',
    });
    expect(r.isError).toBeUndefined();
    expect(mockInsert.mock.calls[0][2].slug).toBe('/hello-world');
    expect(mockInsert.mock.calls[0][2].site_id).toBe(SITE);
  });

  it('create_blog_post honors an explicit slug', async () => {
    await dispatchTool(db, SITE, 'create_blog_post', {
      title: 'T',
      content: 'b',
      slug: '/custom',
    });
    expect(mockInsert.mock.calls[0][2].slug).toBe('/custom');
  });

  it('get_analytics_summary returns a 30d period envelope', async () => {
    mockQuery.mockResolvedValueOnce({ data: [{ metric: 'views', total: 5 }], error: null });
    const r = await dispatchTool(db, SITE, 'get_analytics_summary', {});
    const out = JSON.parse(textOf(r));
    expect(out.period).toBe('30d');
    expect(out.metrics).toEqual([{ metric: 'views', total: 5 }]);
  });
});

// ─── dispatchTool — arg defaults + clamping ───────────────────────────
describe('dispatchTool — limit defaults and clamping', () => {
  it('list_form_submissions defaults limit to 50', async () => {
    await dispatchTool(db, SITE, 'list_form_submissions', {});
    expect(mockQuery.mock.calls[0][2]).toEqual([SITE, 50]);
  });

  it('list_form_submissions clamps an oversized limit to 200', async () => {
    await dispatchTool(db, SITE, 'list_form_submissions', { limit: 9999 });
    expect(mockQuery.mock.calls[0][2]).toEqual([SITE, 200]);
  });

  it('list_blog_posts defaults to 20 and clamps to 100', async () => {
    await dispatchTool(db, SITE, 'list_blog_posts', {});
    expect(mockQuery.mock.calls[0][2]).toEqual([SITE, 20]);
    mockQuery.mockClear();
    await dispatchTool(db, SITE, 'list_blog_posts', { limit: 500 });
    expect(mockQuery.mock.calls[0][2]).toEqual([SITE, 100]);
  });

  it('list_media_assets defaults to 30 and clamps to 100', async () => {
    await dispatchTool(db, SITE, 'list_media_assets', {});
    expect(mockQuery.mock.calls[0][2]).toEqual([SITE, 30]);
    mockQuery.mockClear();
    await dispatchTool(db, SITE, 'list_media_assets', { limit: 999 });
    expect(mockQuery.mock.calls[0][2]).toEqual([SITE, 100]);
  });
});

// ─── dispatchTool — input validation (error envelopes) ────────────────
describe('dispatchTool — input validation', () => {
  it('read_page → isError when slug is missing', async () => {
    const r = await dispatchTool(db, SITE, 'read_page', {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('slug is required');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('read_page → isError (page not found)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const r = await dispatchTool(db, SITE, 'read_page', { slug: '/missing' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Page not found: /missing');
  });

  it('update_page_section → isError when fields are missing', async () => {
    const r = await dispatchTool(db, SITE, 'update_page_section', { slug: '/' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('section_id');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('update_page_section → isError (page not found) before writing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const r = await dispatchTool(db, SITE, 'update_page_section', {
      slug: '/x',
      section_id: 's',
      content: 'c',
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Page not found: /x');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('create_page → isError when required fields are missing', async () => {
    const r = await dispatchTool(db, SITE, 'create_page', { slug: '/x' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('required');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ─── dispatchTool — unknown tool + thrown-error envelope ──────────────
describe('dispatchTool — unknown tool and error envelope', () => {
  it('returns isError for an unknown tool name', async () => {
    const r = await dispatchTool(db, SITE, 'nope_not_a_tool', {});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Unknown tool: nope_not_a_tool');
  });

  // NOTE (source behavior, reported): every `case` in dispatchTool does
  // `return handleX(...)` WITHOUT awaiting, and every handler is `async`. A throw
  // inside any handler therefore becomes a REJECTED PROMISE that the function
  // returns, which propagates PAST dispatchTool's try/catch (the catch only ever
  // catches a synchronous throw in the switch itself — effectively unreachable).
  // These tests pin that real behavior rather than an isError envelope that the
  // dead catch never produces for handler failures.
  it('propagates an async handler DB rejection (un-awaited return bypasses the catch)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('D1 exploded'));
    await expect(dispatchTool(db, SITE, 'list_pages', {})).rejects.toThrow('D1 exploded');
  });

  it('propagates a handler-internal throw the same way (e.g. non-string title)', async () => {
    // create_blog_post computes the default slug via `title.toLowerCase()` before
    // the required-fields guard — a non-string title throws inside the async handler.
    await expect(
      dispatchTool(db, SITE, 'create_blog_post', {
        title: 123 as unknown as string,
        content: 'b',
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
