/**
 * FE↔BE field-cap parity for PATCH /api/sites/:id (business-profile fields).
 *
 * Regression for a silent-truncation / lying-success defect (surf QA 2026-08-27):
 * the frontend `settings.component.ts` business-phone input uses `maxlength="32"`
 * + a `> 32` validator, but the worker handler capped `business_phone` at
 * `.slice(0, 20)`. A 21–32 char phone therefore passed FE validation, showed a
 * "Saved" toast, then lost its tail server-side (e.g. "+1 (973) 555-0142 x9999"
 * → "+1 (973) 555-0142 x9"). Fix: worker cap raised 20 → 32 to match the FE.
 *
 * This pins the parity so the caps can't silently drift apart again.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';

/** Owned-site row requireOwnedSite() selects (id, slug, org_id). */
const OWNED_SITE = { id: 'site-1', slug: 's1', org_id: 'org-1' };

/** Build a DB mock that records every bound statement's SQL + params. */
function makeRecordingDb(): { db: D1Database; bound: Array<{ sql: string; args: unknown[] }> } {
  const bound: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: jest.fn((sql: string) => ({
      bind: jest.fn((...args: unknown[]) => {
        bound.push({ sql, args });
        // dbQueryOne reads dbQuery().data[0], and dbQuery uses `.all()` → the
        // owned-site lookup must come back via `all`, not just `first`.
        return {
          first: jest.fn().mockResolvedValue(OWNED_SITE),
          all: jest.fn().mockResolvedValue({ results: [OWNED_SITE], success: true, meta: { changes: 1 } }),
          run: jest.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        };
      }),
    })),
  } as unknown as D1Database;
  return { db, bound };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', 'org-1');
    c.set('userId', 'user-1');
    c.set('requestId', 'req-1');
    await next();
  });
  app.route('/', api);
  return app;
}

function patchPhone(app: ReturnType<typeof makeApp>, db: D1Database, phone: string) {
  return app.request(
    '/api/sites/site-1',
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_phone: phone }) },
    { ENVIRONMENT: 'test', DB: db } as unknown as Env,
  );
}

/** The value bound to the `business_phone = ?` column in the UPDATE. */
function boundPhone(bound: Array<{ sql: string; args: unknown[] }>): string | undefined {
  const upd = bound.find((b) => /UPDATE\s+sites/i.test(b.sql) && /business_phone\s*=/i.test(b.sql));
  return upd?.args.find((a): a is string => typeof a === 'string' && a.includes('973'));
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('PATCH /api/sites/:id — business_phone cap matches the FE (32), no silent truncation', () => {
  it('persists a 23-char phone IN FULL (was truncated to 20 pre-fix)', async () => {
    const { db, bound } = makeRecordingDb();
    const phone = '+1 (973) 555-0142 x9999'; // 23 chars — > old cap 20, <= FE/new cap 32
    expect(phone.length).toBe(23);
    const res = await patchPhone(makeApp(), db, phone);
    expect(res.status).toBe(200);
    const stored = boundPhone(bound);
    expect(stored).toBeTruthy(); // UPDATE must bind the phone
    expect(stored).toBe(phone); // NOT phone.slice(0, 20)
    expect((stored ?? '').length).toBeGreaterThan(20);
  });

  it('caps at 32 (a 40-char phone stores exactly 32, never the old 20)', async () => {
    const { db, bound } = makeRecordingDb();
    const phone = '+1 (973) 555-0142 x9999999999999999999'; // 38 chars
    expect(phone.length).toBeGreaterThan(32);
    const res = await patchPhone(makeApp(), db, phone);
    expect(res.status).toBe(200);
    const stored = boundPhone(bound) ?? '';
    expect(stored.length).toBe(32);
    expect(stored).toBe(phone.slice(0, 32));
  });
});
