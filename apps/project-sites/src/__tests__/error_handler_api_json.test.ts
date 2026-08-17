/**
 * error_handler must return machine-readable JSON for ANY `/api/*` error — even
 * when the client's Accept header prefers text/html (a browser doing
 * `fetch('/api/…')` sends `Accept: text/html,…` but expects JSON). Serving the
 * branded HTML error page to an API caller is a soft-404: it reads as HTML to
 * fetch()/SDKs and breaks JSON parsing. Non-API (marketing/SPA) routes keep the
 * branded HTML error page for browsers.
 *
 * Reference: fire-27 cross-org READ sweep found /api/sites/:id/{logs,hostnames,
 * snapshots,workflow} returning the branded HTML 404 for foreign/nonexistent
 * sites while sibling endpoints returned JSON.
 */
import { Hono } from 'hono';
import { notFound } from '@project-sites/shared';
import { errorHandler } from '../middleware/error_handler.js';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/api/sites/:id/thing', () => {
    throw notFound('Site not found');
  });
  app.get('/some-marketing-page', () => {
    throw notFound('nope');
  });
  return app;
}

describe('errorHandler — /api/* errors are always JSON (soft-404 doctrine)', () => {
  it('returns JSON for an /api/* error even when Accept prefers text/html', async () => {
    const res = await makeApp().request('/api/sites/foreign/thing', {
      headers: { Accept: 'text/html,application/json' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('still returns branded HTML for a NON-api route when Accept prefers text/html', async () => {
    const res = await makeApp().request('/some-marketing-page', {
      headers: { Accept: 'text/html,application/json' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
  });
});
