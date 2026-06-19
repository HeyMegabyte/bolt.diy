/**
 * GET /api/changelog — guards the drift fix that collapsed this endpoint onto
 * the single canonical source (`loadChangelogEntries` in routes/public.ts).
 *
 * Before the fix it served its own hardcoded copy that had gone 3 releases stale
 * (stuck at 1.5.0). These tests assert it now reflects the current changelog AND
 * still emits the legacy `{version,type,description}` shape its consumers expect.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';

interface LegacyEntry {
  version: string;
  date: string;
  type: string;
  title: string;
  description: string;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', api);
  return app;
}

// No SITES_BUCKET → loadChangelogEntries() returns the curated FALLBACK_ENTRIES.
const env = {} as Env;

describe('GET /api/changelog (collapsed onto canonical source)', () => {
  it('serves the CURRENT changelog, not a stale hardcoded copy', async () => {
    const res = await makeApp().request('/api/changelog', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: LegacyEntry[] };
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);

    // Newest first — must be the current release, never the old 1.5.0 ceiling.
    expect(json.data[0].version).toBe('1.8.0');
    expect(json.data[0].title).toContain('Trust Center');
  });

  it('preserves the legacy response shape for existing consumers', async () => {
    const res = await makeApp().request('/api/changelog', {}, env);
    const json = (await res.json()) as { data: LegacyEntry[] };
    const top = json.data[0];

    // Legacy shape: no leading "v" on version; has type + description fields.
    expect(top.version).not.toMatch(/^v/);
    expect(typeof top.type).toBe('string');
    expect(top.type.length).toBeGreaterThan(0);
    expect(typeof top.description).toBe('string');
    expect(top.description.length).toBeGreaterThan(0);
    expect(typeof top.date).toBe('string');
  });
});
