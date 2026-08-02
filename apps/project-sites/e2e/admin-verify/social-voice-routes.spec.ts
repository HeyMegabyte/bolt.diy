/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — two admin API calls that used to 404
 * ("Unknown API route") are now wired to real data.
 *
 * The audit found the Social composer's best-time chips called
 * `GET /api/social/best-times` and the Voice agent-settings panel called
 * `GET /api/voice/meta-prompt`, both of which 404'd (handlers never registered)
 * → the chips silently hid and the voice panel showed a STALE hardcoded
 * fallback that no longer matched the real rules. Both handlers now exist,
 * backed by data already in the repo (social_agent PLATFORM_LIMITS,
 * voice_agent PROMPT_META).
 *
 * @see {@link ../../src/routes/social.ts} · {@link ../../src/routes/voice.ts}
 * @see {@link ../../libs/features/social_agent/best_times.test.ts}
 */
import { test, expect } from '@playwright/test';
import { realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · previously-404 API calls now serve real data (P0-ADMIN)', () => {
  test('GET /api/social/best-times returns real "Day 12h" chip labels (was 404)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (bearer) => {
      const r = await fetch('/api/social/best-times?platforms=x,linkedin', {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, token);

    expect(res.status, '/api/social/best-times must be 200 (was 404)').toBe(200);
    const times = (res.body as { times?: unknown } | null)?.times;
    expect(Array.isArray(times), 'returns { times: string[] }').toBe(true);
    const arr = times as string[];
    expect(arr.length, 'returns real time labels').toBeGreaterThan(0);
    // Every label must match the composer chip parser (/^(\w{3})\s+(\d{1,2})(am|pm)/).
    for (const label of arr) expect(label).toMatch(/^\w{3}\s+\d{1,2}(am|pm)$/);
  });

  test('GET /api/voice/meta-prompt returns the real immutable meta-prompt (was 404)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (bearer) => {
      const r = await fetch('/api/voice/meta-prompt', {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, token);

    expect(res.status, '/api/voice/meta-prompt must be 200 (was 404)').toBe(200);
    const textVal = (res.body as { data?: { text?: unknown } } | null)?.data?.text;
    expect(typeof textVal, 'returns { data: { text: string } }').toBe('string');
    const text = textVal as string;
    // The real immutable rule set — not the stale client fallback.
    expect(text.length, 'substantial meta-prompt').toBeGreaterThan(500);
    expect(text, 'is the genuine concierge meta-prompt').toContain('AI customer concierge');
  });
});
