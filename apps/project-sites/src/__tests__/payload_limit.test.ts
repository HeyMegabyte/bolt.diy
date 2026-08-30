/**
 * payloadLimitMiddleware — body-size enforcement.
 *
 * Default API cap is 256 KB, but the self-hosted-app container hosts
 * (sign./schedule./jobs./events.projectsites.dev) proxy wholesale to CF Workers
 * Containers that accept multi-MB uploads (Documenso avatar + signed PDFs), so
 * they get the 100 MB ceiling. Regression: a 1.3 MB avatar `setProfileImage` on
 * sign.* was 413'd by this middleware before reaching Documenso (2026-06-27).
 */
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error_handler.js';
import { payloadLimitMiddleware } from '../middleware/payload_limit.js';
import type { Env, Variables } from '../types/env.js';

function app() {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.onError(errorHandler);
  a.use('*', payloadLimitMiddleware);
  a.post('/api/trpc/profile.setProfileImage', (c) => c.json({ data: 'ok' }));
  a.post('/api/x', (c) => c.json({ data: 'ok' }));
  return a;
}

const TWO_MB = String(2 * 1024 * 1024);
const ONE_KB = String(1024);

function post(url: string, contentLength: string) {
  return app().request(
    url,
    { method: 'POST', headers: { 'content-length': contentLength, accept: 'application/json' } },
    {} as Env,
  );
}

describe('payloadLimitMiddleware', () => {
  it('allows a multi-MB avatar upload on the Documenso container host (sign.*)', async () => {
    const res = await post(
      'https://sign.projectsites.dev/api/trpc/profile.setProfileImage',
      TWO_MB,
    );
    expect(res.status).toBe(200);
  });

  it('exempts the other container hosts (schedule) too', async () => {
    // jobs./events. dropped with Inngest removal 2026-08-20 — they no longer
    // proxy to a container, so they use the standard API cap like any host.
    for (const host of ['schedule.projectsites.dev']) {
      const res = await post(`https://${host}/api/x`, TWO_MB);
      expect(res.status).toBe(200);
    }
  });

  it('still rejects a multi-MB body on a regular API host (413)', async () => {
    const res = await post('https://projectsites.dev/api/x', TWO_MB);
    expect(res.status).toBe(413);
  });

  it('allows a small body on a regular API host', async () => {
    const res = await post('https://projectsites.dev/api/x', ONE_KB);
    expect(res.status).toBe(200);
  });
});

describe('payloadLimitMiddleware — Functions dispatch exemption (Stage 4.2)', () => {
  const TWENTY_SIX_MB = String(26 * 1024 * 1024);
  const TWO_HUNDRED_MB = String(200 * 1024 * 1024);

  it('exempts a non-reserved /api/* on a SITE host (2 MB → 200; the 256 KB default would 413)', async () => {
    const res = await post('https://ada-co.projectsites.dev/api/x', TWO_MB);
    expect(res.status).toBe(200);
  });

  it('allows a 26 MB body on a site functions path (the dispatch guardrail — not this middleware — enforces the real 25 MB cap)', async () => {
    const res = await post('https://ada-co.projectsites.dev/api/x', TWENTY_SIX_MB);
    expect(res.status).toBe(200);
  });

  it('still 413s a >100 MB body on a site functions path (hard backstop)', async () => {
    const res = await post('https://ada-co.projectsites.dev/api/x', TWO_HUNDRED_MB);
    expect(res.status).toBe(413);
  });

  it('does NOT exempt a RESERVED /api/* on a site host (contact-form stays 256 KB → 413 at 2 MB)', async () => {
    const res = await post('https://ada-co.projectsites.dev/api/contact-form', TWO_MB);
    expect(res.status).toBe(413);
  });

  it('does NOT exempt the platform host /api/* (stays 256 KB → 413 at 2 MB)', async () => {
    const res = await post('https://projectsites.dev/api/x', TWO_MB);
    expect(res.status).toBe(413);
  });

  it('does NOT exempt a non-/api path on a site host (static → 256 KB → 413 at 2 MB)', async () => {
    const res = await post('https://ada-co.projectsites.dev/about', TWO_MB);
    expect(res.status).toBe(413);
  });
});
