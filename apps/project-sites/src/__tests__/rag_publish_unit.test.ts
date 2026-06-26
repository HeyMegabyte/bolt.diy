/**
 * rag_publish — unit tests for every exported function.
 *
 * Exported surface:
 *   - stripHtmlToText  — pure; no deps; strips tags, decodes entities, collapses
 *                        whitespace, caps at 4 000 chars.
 *   - resolvePublishOrgId — async; resolves org from session → DB → 'bolt' fallback.
 *   - indexSiteFiles   — side-effectful; fires indexChunk inside waitUntil; silently
 *                        skips when AI/RAG_INDEX bindings are absent.
 *
 * Strategy:
 *   - stripHtmlToText  → pure property tests, zero mocks.
 *   - resolvePublishOrgId → D1 `.prepare().bind().first()` chain mocked; no real DB.
 *   - indexSiteFiles   → indexChunk mocked; executionCtx.waitUntil captured + awaited.
 *
 * @swc/jest hoisting rule: use the global `jest`, NOT `import { jest }`.
 */

// ── Module mock: indexChunk must be hoisted above the import ──────────────────
jest.mock('../services/rag.js', () => ({
  indexChunk: jest.fn().mockResolvedValue(undefined),
}));

import { stripHtmlToText, resolvePublishOrgId, indexSiteFiles } from '../services/rag_publish.js';
import { indexChunk } from '../services/rag.js';
import type { Env } from '../types/env.js';

const mockIndexChunk = indexChunk as jest.MockedFunction<typeof indexChunk>;

// ─── stripHtmlToText ─────────────────────────────────────────────────────────

describe('stripHtmlToText', () => {
  it('removes HTML tags, leaving inner text', () => {
    expect(stripHtmlToText('<h1>Hello</h1>')).toBe('Hello');
    expect(stripHtmlToText('<p>foo</p><p>bar</p>')).toBe('foo bar');
  });

  it('collapses multiple whitespace tokens to a single space', () => {
    expect(stripHtmlToText('a   b\t\tc\n\nd')).toBe('a b c d');
  });

  it('strips tags that contain attributes', () => {
    const html = '<img src="cat.png" alt="cat" /><a href="https://x.com">link</a>';
    expect(stripHtmlToText(html)).toBe('link');
  });

  it('decodes &amp; to &', () => {
    expect(stripHtmlToText('foo &amp; bar')).toBe('foo & bar');
  });

  it('decodes &lt; and &gt;', () => {
    expect(stripHtmlToText('a &lt; b &gt; c')).toBe('a < b > c');
  });

  it('decodes &quot;', () => {
    expect(stripHtmlToText('say &quot;hello&quot;')).toBe('say "hello"');
  });

  it('decodes &#39; to apostrophe', () => {
    expect(stripHtmlToText('it&#39;s')).toBe("it's");
  });

  it('decodes &nbsp; to a regular space', () => {
    expect(stripHtmlToText('a&nbsp;b')).toBe('a b');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripHtmlToText('  <p>hi</p>  ')).toBe('hi');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtmlToText('')).toBe('');
  });

  it('returns empty string for whitespace-only content after stripping', () => {
    expect(stripHtmlToText('<div>   </div>')).toBe('');
  });

  it('caps output at exactly 4 000 characters', () => {
    const long = 'a'.repeat(5000);
    const result = stripHtmlToText(long);
    expect(result.length).toBe(4000);
    expect(result).toBe('a'.repeat(4000));
  });

  it('text of exactly 4 000 chars is returned unchanged', () => {
    const exact = 'x'.repeat(4000);
    expect(stripHtmlToText(exact)).toBe(exact);
  });

  it('handles full HTML page with script/style content', () => {
    const html = `<!DOCTYPE html>
<html>
<head><style>body{color:red}</style></head>
<body>
  <script>alert(1)</script>
  <h1>Title</h1>
  <p>Paragraph text.</p>
</body>
</html>`;
    const result = stripHtmlToText(html);
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph text.');
    // No angle-bracket tag remnants
    expect(result).not.toMatch(/<html|<body|<\/p>/);
  });

  it('entity decoding applies to text nodes, not tag attributes', () => {
    // The whole tag is stripped first, then entities in the remaining text are decoded
    expect(stripHtmlToText('<a title="Tom &amp; Jerry">click</a>')).toBe('click');
  });

  it('handles deeply nested tags', () => {
    expect(stripHtmlToText('<div><section><article><p>deep</p></article></section></div>')).toBe(
      'deep',
    );
  });
});

// ─── resolvePublishOrgId ─────────────────────────────────────────────────────

/** Build a minimal Env whose D1 stub returns the given row. */
function makeEnvWithD1(row: { org_id: string } | null): Env {
  const firstMock = jest.fn().mockResolvedValue(row);
  const bindMock = jest.fn().mockReturnValue({ first: firstMock });
  const prepareMock = jest.fn().mockReturnValue({ bind: bindMock });
  return { DB: { prepare: prepareMock } } as unknown as Env;
}

describe('resolvePublishOrgId', () => {
  it('returns sessionOrgId immediately when it is a non-bolt truthy value', async () => {
    const env = makeEnvWithD1(null);
    const result = await resolvePublishOrgId(env, 'my-slug', 'org_abc');
    expect(result).toBe('org_abc');
    // DB should NOT be queried at all
    const prepareMock = (env.DB as { prepare: jest.MockedFunction<() => unknown> }).prepare;
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('falls through to DB when sessionOrgId is undefined', async () => {
    const env = makeEnvWithD1({ org_id: 'org_from_db' });
    const result = await resolvePublishOrgId(env, 'some-slug', undefined);
    expect(result).toBe('org_from_db');
  });

  it('falls through to DB when sessionOrgId is the "bolt" placeholder', async () => {
    const env = makeEnvWithD1({ org_id: 'org_real' });
    const result = await resolvePublishOrgId(env, 'some-slug', 'bolt');
    expect(result).toBe('org_real');
  });

  it('returns "bolt" when DB has no matching row (null result)', async () => {
    const env = makeEnvWithD1(null);
    const result = await resolvePublishOrgId(env, 'unknown-slug', undefined);
    expect(result).toBe('bolt');
  });

  it('returns "bolt" when DB query rejects (catch branch)', async () => {
    const firstMock = jest.fn().mockRejectedValue(new Error('D1 connectivity error'));
    const bindMock = jest.fn().mockReturnValue({ first: firstMock });
    const prepareMock = jest.fn().mockReturnValue({ bind: bindMock });
    const env = { DB: { prepare: prepareMock } } as unknown as Env;
    const result = await resolvePublishOrgId(env, 'any-slug');
    expect(result).toBe('bolt');
  });

  it('queries with correct SQL and binds the slug', async () => {
    const bindMock = jest.fn().mockReturnValue({
      first: jest.fn().mockResolvedValue({ org_id: 'org_x' }),
    });
    const prepareMock = jest.fn().mockReturnValue({ bind: bindMock });
    const env = { DB: { prepare: prepareMock } } as unknown as Env;

    await resolvePublishOrgId(env, 'target-slug');

    const sql = prepareMock.mock.calls[0]![0] as string;
    expect(sql).toMatch(/SELECT org_id FROM sites/i);
    expect(sql).toContain('deleted_at IS NULL');
    expect(bindMock).toHaveBeenCalledWith('target-slug');
  });
});

// ─── indexSiteFiles ──────────────────────────────────────────────────────────

type WaitUntilFn = (p: Promise<unknown>) => void;

function makeCtx(): {
  waitUntil: jest.MockedFunction<WaitUntilFn>;
  getPromise: () => Promise<unknown>;
} {
  let captured: Promise<unknown> = Promise.resolve();
  const waitUntil = jest.fn((p: Promise<unknown>) => {
    captured = p;
  }) as jest.MockedFunction<WaitUntilFn>;
  return {
    waitUntil,
    getPromise: () => captured,
  };
}

function makeEnvWithBindings(opts: { hasAI: boolean; hasRAG: boolean }): Env {
  return {
    AI: opts.hasAI ? {} : undefined,
    RAG_INDEX: opts.hasRAG ? {} : undefined,
  } as unknown as Env;
}

describe('indexSiteFiles', () => {
  beforeEach(() => {
    mockIndexChunk.mockClear();
    mockIndexChunk.mockResolvedValue(undefined);
  });

  it('no-ops (no waitUntil) when AI binding is absent', () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: false, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 's1',
      orgId: 'o1',
      files: [{ path: 'index.html', content: '<p>hello world here</p>' }],
    });
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(mockIndexChunk).not.toHaveBeenCalled();
  });

  it('no-ops (no waitUntil) when RAG_INDEX binding is absent', () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: false });
    indexSiteFiles(env, ctx, {
      siteId: 's2',
      orgId: 'o2',
      files: [{ path: 'index.html', content: '<p>hello world here</p>' }],
    });
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('calls waitUntil once when both bindings are present', () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 's3',
      orgId: 'o3',
      files: [{ path: 'index.html', content: '<p>content long enough here</p>' }],
    });
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('indexes HTML with stripped text and correct metadata', async () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-99',
      orgId: 'org-99',
      files: [{ path: 'about.html', content: '<h1>About Us</h1><p>We are great people.</p>' }],
    });
    await ctx.getPromise();

    expect(mockIndexChunk).toHaveBeenCalledTimes(1);
    const [, chunk] = mockIndexChunk.mock.calls[0]!;
    expect(chunk.id).toBe('site-99::about.html');
    expect(chunk.kind).toBe('site_page');
    expect(chunk.sourceId).toBe('site-99');
    expect(chunk.text).toBe('About Us We are great people.');
    expect(chunk.metadata).toMatchObject({ orgId: 'org-99', path: 'about.html' });
  });

  it('indexes markdown files as plain text', async () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-md',
      orgId: 'org-md',
      files: [{ path: 'README.md', content: '# Title\n\nSome text here that is long enough.' }],
    });
    await ctx.getPromise();

    expect(mockIndexChunk).toHaveBeenCalledTimes(1);
    const [, chunk] = mockIndexChunk.mock.calls[0]!;
    expect(chunk.text).toContain('Title');
    expect(chunk.text).toContain('Some text here');
  });

  it('skips CSS, JS, image, and binary files', async () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-skip',
      orgId: 'org-skip',
      files: [
        { path: 'style.css', content: 'body { color: red; }' },
        { path: 'app.js', content: 'console.log("hi")' },
        { path: 'logo.png', content: '\x89PNG binary data' },
        { path: 'font.woff2', content: 'binary font data' },
        {
          path: 'index.html',
          content: '<p>Real page content here that is long enough to index.</p>',
        },
      ],
    });
    await ctx.getPromise();

    // Only index.html is indexable
    expect(mockIndexChunk).toHaveBeenCalledTimes(1);
    expect(mockIndexChunk.mock.calls[0]![1].id).toBe('site-skip::index.html');
  });

  it('skips files whose stripped text is below the minimum length threshold', async () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-short',
      orgId: 'org-short',
      files: [
        { path: 'tiny.html', content: '<p>hi</p>' }, // stripped = "hi" → too short
        { path: 'normal.html', content: '<p>This page has enough content to be indexed.</p>' },
      ],
    });
    await ctx.getPromise();

    expect(mockIndexChunk).toHaveBeenCalledTimes(1);
    expect(mockIndexChunk.mock.calls[0]![1].id).toBe('site-short::normal.html');
  });

  it('processes multiple indexable files', async () => {
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-multi',
      orgId: 'org-multi',
      files: [
        { path: 'index.html', content: '<p>Home page content for our company site.</p>' },
        { path: 'about.html', content: '<p>About page content describing our mission.</p>' },
        { path: 'contact.html', content: '<p>Contact page with form and location details.</p>' },
      ],
    });
    await ctx.getPromise();

    expect(mockIndexChunk).toHaveBeenCalledTimes(3);
    const ids = mockIndexChunk.mock.calls.map((c) => c[1].id);
    expect(ids).toContain('site-multi::index.html');
    expect(ids).toContain('site-multi::about.html');
    expect(ids).toContain('site-multi::contact.html');
  });

  it('resolves (does not reject) when a single indexChunk call throws', async () => {
    mockIndexChunk.mockRejectedValueOnce(new Error('Vectorize unavailable'));
    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-err',
      orgId: 'org-err',
      files: [
        { path: 'index.html', content: '<p>Content long enough to qualify for indexing</p>' },
      ],
    });
    await expect(ctx.getPromise()).resolves.not.toThrow();
  });

  it('continues processing remaining files after a per-file indexChunk failure', async () => {
    mockIndexChunk
      .mockRejectedValueOnce(new Error('chunk 1 failed'))
      .mockResolvedValueOnce(undefined);

    const ctx = makeCtx();
    const env = makeEnvWithBindings({ hasAI: true, hasRAG: true });
    indexSiteFiles(env, ctx, {
      siteId: 'site-recover',
      orgId: 'org-recover',
      files: [
        { path: 'page1.html', content: '<p>First page content is definitely long enough.</p>' },
        { path: 'page2.html', content: '<p>Second page content is definitely long enough.</p>' },
      ],
    });
    await ctx.getPromise();

    // Both files were attempted despite the first rejection
    expect(mockIndexChunk).toHaveBeenCalledTimes(2);
  });
});
