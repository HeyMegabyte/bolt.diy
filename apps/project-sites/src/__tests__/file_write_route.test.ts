/**
 * Input-boundary coverage for `PUT /api/sites/:id/files/:path{.+}`
 * (`routes/api.ts`) — the in-app editor / bolt.diy "publish from editor" save.
 *
 * The body was read with a bare `as`-cast (`(await c.req.json()) as {...}`), a
 * documented zod-everywhere drift point (project CLAUDE.md known-issue #10), so:
 *   - a malformed JSON body threw → unhandled 500 instead of a clean 400
 *   - `content_type` was an unconstrained string handed straight to the served
 *     R2 object's Content-Type header — a CRLF/control-char value is a
 *     header-injection vector
 *
 * Fix: a Zod boundary (`content: string`, optional `content_type` constrained to
 * a well-formed MIME token). The extension-derivation default and a valid MIME
 * override are preserved unchanged — only malformed bodies / malformed MIME
 * strings are now rejected with a 400.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
// PUT /api/sites/:id/files/:path{.+} moved to its own module (route-decomposition
// installment 10) — mount it alongside `api` so this hand-app still serves the route.
import { siteFiles } from '../../libs/features/site_files/handlers.js';

const mockDb = {
  prepare: jest.fn((sql: string) => {
    const isSites = /FROM sites/i.test(sql);
    return {
      bind: jest.fn(() => ({
        first: jest.fn().mockResolvedValue(isSites ? { slug: 'nsk' } : null),
        all: jest.fn().mockResolvedValue({ results: isSites ? [{ slug: 'nsk' }] : [] }),
        run: jest.fn().mockResolvedValue({}),
      })),
    };
  }),
} as unknown as D1Database;

let putMock: jest.Mock;
function makeEnv(): Env {
  putMock = jest.fn().mockResolvedValue({});
  return {
    ENVIRONMENT: 'test',
    DB: mockDb,
    SITES_BUCKET: {
      head: jest.fn().mockResolvedValue(null),
      put: putMock,
    },
    CACHE_KV: { delete: jest.fn().mockResolvedValue(undefined) },
  } as unknown as Env;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
app.route('/', siteFiles);
app.route('/', api);

function put(env: Env, path: string, body: unknown, rawBody?: string) {
  return app.request(
    `/api/sites/site-1/files/${path}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody !== undefined ? rawBody : JSON.stringify(body),
    },
    env,
  );
}

afterEach(() => jest.clearAllMocks());

describe('PUT /api/sites/:id/files/:path — input boundary', () => {
  it('returns 400 (not 500) on a malformed JSON body', async () => {
    const res = await put(makeEnv(), 'data.json', undefined, 'not-json');
    expect(res.status).toBe(400);
  });

  it('returns 400 when content is missing / not a string', async () => {
    const res = await put(makeEnv(), 'data.json', { content_type: 'text/html' });
    expect(res.status).toBe(400);
  });

  it('rejects a CRLF/header-injection content_type', async () => {
    const res = await put(makeEnv(), 'data.json', {
      content: '{}',
      content_type: 'text/html\r\nX-Evil: 1',
    });
    expect(res.status).toBe(400);
  });

  it('saves a file and derives content-type from the extension when omitted', async () => {
    const env = makeEnv();
    const res = await put(env, 'data.json', { content: '{"a":1}' });
    expect(res.status).toBe(200);
    expect(putMock.mock.calls[0][2].httpMetadata.contentType).toBe('application/json');
  });

  it('honors a well-formed MIME content_type override', async () => {
    const env = makeEnv();
    const res = await put(env, 'notes.txt', { content: 'x', content_type: 'text/markdown' });
    expect(res.status).toBe(200);
    expect(putMock.mock.calls[0][2].httpMetadata.contentType).toBe('text/markdown');
  });

  it('allows an empty-string content (saving an empty file)', async () => {
    const res = await put(makeEnv(), 'empty.txt', { content: '' });
    expect(res.status).toBe(200);
  });
});
