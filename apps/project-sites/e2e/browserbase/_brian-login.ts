/**
 * Shared brian@megabyte.space real-login preamble for the Browserbase real-Chrome
 * sweeps. Logs in FROM the real browser (curl gets Cloudflare's Bot-Fight
 * "Just a moment…" JS-challenge [[bot-fight-mode-blocks-inbound-webhooks]]; a real
 * browser solves it automatically), then seeds the SPA session so every
 * subsequent `/api` call carries brian's real bearer → his REAL data.
 *
 * Used by {@link ./admin-section-sweep-brian.spec.ts} (top-level sections) and
 * {@link ./admin-site-detail-sweep-brian.spec.ts} (per-site sub-routes) so the
 * login logic lives in ONE place.
 */
import type { Page } from '@playwright/test';

export const BRIAN_EMAIL = 'brian@megabyte.space';

/**
 * Real-login as brian and seed `ps_session`. Returns the bearer token (empty
 * string on failure — the caller should assert `token.length > 0`).
 *
 * @param page - a live Browserbase real-Chrome page
 * @param prodUrl - origin, e.g. `https://projectsites.dev`
 * @param password - the E2E_TEST_PASSWORD secret (never logged)
 */
export async function loginAsBrian(page: Page, prodUrl: string, password: string): Promise<string> {
  // 1) Establish the origin in a real browser so the Bot-Fight JS-challenge is
  //    solved before we issue the auth fetch.
  await page.goto(`${prodUrl}/`, { waitUntil: 'domcontentloaded' });

  // 2) Real login FROM the page. Password passed as an evaluate arg — never logged.
  const res = await page.evaluate(
    async ({ email, pw }: { email: string; pw: string }) => {
      const r = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password: pw }),
      });
      if (!r.ok) return { ok: false, status: r.status, token: '' };
      const j = (await r.json()) as { data?: { token?: string } };
      return { ok: true, status: r.status, token: j.data?.token ?? '' };
    },
    { email: BRIAN_EMAIL, pw: password },
  );
  if (!res.ok || !res.token) return '';

  // 3) Seed brian's real session the way the SPA expects it.
  await page.evaluate(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: res.token, id: BRIAN_EMAIL },
  );
  return res.token;
}

/**
 * List brian's sites via an in-browser authed fetch (bypasses the curl BFM block).
 * Returns `{id, slug, status}[]`, newest-ish first — shape-defensive across
 * `{data:[…]}` / `{sites:[…]}` / bare-array envelopes.
 *
 * @param page - a logged-in Browserbase page (call {@link loginAsBrian} first)
 */
export async function listBrianSites(
  page: Page,
): Promise<Array<{ id: string; slug: string; status: string }>> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('ps_session');
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    const r = await fetch('/api/sites', {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as unknown;
    const arr = Array.isArray(j)
      ? j
      : Array.isArray((j as { data?: unknown }).data)
        ? (j as { data: unknown[] }).data
        : Array.isArray((j as { sites?: unknown }).sites)
          ? (j as { sites: unknown[] }).sites
          : [];
    return (arr as Array<Record<string, unknown>>).map((s) => ({
      id: String(s.id ?? ''),
      slug: String(s.slug ?? ''),
      status: String(s.status ?? ''),
    }));
  });
}
