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

  it('exempts the other container hosts (schedule/jobs/events) too', async () => {
    for (const host of [
      'schedule.projectsites.dev',
      'jobs.projectsites.dev',
      'events.projectsites.dev',
    ]) {
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
