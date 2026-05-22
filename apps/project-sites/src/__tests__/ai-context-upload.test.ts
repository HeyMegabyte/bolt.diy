/**
 * Unit tests for the per-site AI chat context upload endpoint:
 *   POST /api/sites/:siteId/ai/context/upload
 *
 * Covers:
 *   - rejects non-multipart bodies
 *   - rejects files > 10 MB (413)
 *   - rejects unsupported MIME types
 *   - happy path persists to R2 + D1 + invokes Vision extractor
 */

jest.mock('../services/ai_context_extract.js', () => {
  const actual = jest.requireActual('../services/ai_context_extract.js');
  return {
    ...actual,
    extractContext: jest.fn().mockResolvedValue({
      text: 'extracted text from pdf',
      pages_processed: 1,
      truncated: false,
    }),
  };
});

jest.mock('../lib/sentry.js', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
  createSentry: jest.fn(),
}));

jest.mock('../lib/posthog.js', () => ({
  capture: jest.fn(),
  trackAuth: jest.fn(),
  trackSite: jest.fn(),
  trackError: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { aiAdmin } from '../routes/ai_admin.js';

function createApp() {
  const r2Put = jest.fn().mockResolvedValue(undefined);
  const dbInserts: Array<{ sql: string; params: unknown[] }> = [];
  const env = {
    DB: {
      prepare: jest.fn().mockImplementation((sql: string) => ({
        bind: jest.fn().mockImplementation((...params: unknown[]) => ({
          first: jest.fn().mockImplementation(() => {
            if (sql.includes('FROM sites')) {
              return Promise.resolve({ slug: 'test-slug', business_name: 'Test' });
            }
            return Promise.resolve(null);
          }),
          all: jest.fn().mockResolvedValue({ results: [] }),
          run: jest.fn().mockImplementation(() => {
            dbInserts.push({ sql, params });
            return Promise.resolve({});
          }),
        })),
      })),
    } as unknown as D1Database,
    SITES_BUCKET: { put: r2Put, delete: jest.fn().mockResolvedValue(undefined) } as unknown as R2Bucket,
    CACHE_KV: { get: jest.fn().mockResolvedValue(null), put: jest.fn().mockResolvedValue(undefined) } as unknown as KVNamespace,
    OPENAI_API_KEY: 'sk-test',
  } as unknown as Env;

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('orgId', 'org-1');
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', aiAdmin);

  return { app, env, r2Put, dbInserts };
}

describe('POST /api/sites/:siteId/ai/context/upload', () => {
  it('rejects non-multipart bodies with 400', async () => {
    const { app, env } = createApp();
    const res = await app.request(
      '/api/sites/site-1/ai/context/upload',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects unsupported MIME with 400', async () => {
    const { app, env } = createApp();
    const form = new FormData();
    form.append('file', new File(['xx'], 'a.txt', { type: 'text/plain' }));
    const res = await app.request(
      '/api/sites/site-1/ai/context/upload',
      { method: 'POST', body: form },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects files larger than 10 MB with 413', async () => {
    const { app, env } = createApp();
    const big = new Uint8Array(11 * 1024 * 1024);
    const form = new FormData();
    form.append('file', new File([big], 'big.pdf', { type: 'application/pdf' }));
    const res = await app.request(
      '/api/sites/site-1/ai/context/upload',
      { method: 'POST', body: form },
      env,
    );
    expect(res.status).toBe(413);
  });

  it('uploads a PDF, extracts text, persists in R2 and D1', async () => {
    const { app, env, r2Put, dbInserts } = createApp();
    const form = new FormData();
    form.append('file', new File(['%PDF-1.4\nfoo'], 'doc.pdf', { type: 'application/pdf' }));
    const res = await app.request(
      '/api/sites/site-1/ai/context/upload',
      { method: 'POST', body: form },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; extracted_chars: number; filename: string } };
    expect(body.data.filename).toBe('doc.pdf');
    expect(body.data.extracted_chars).toBeGreaterThan(0);
    expect(r2Put).toHaveBeenCalledTimes(1);
    expect(r2Put.mock.calls[0][0]).toContain('sites/test-slug/ai-context/');
    const insert = dbInserts.find((d) => d.sql.includes('INSERT INTO ai_context_files'));
    expect(insert).toBeDefined();
  });
});
