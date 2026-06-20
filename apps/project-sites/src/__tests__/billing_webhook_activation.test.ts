/**
 * billing_webhook_activation.test.ts
 *
 * Asserts the REAL D1 write logic inside handleCheckoutCompleted and
 * handleSubscriptionDeleted — the status/plan flip that the existing
 * webhook_route tests intentionally skip (they mock those fns).
 */

import { handleCheckoutCompleted, handleSubscriptionDeleted } from '../services/billing.js';

// ── D1 mock helpers ──────────────────────────────────────────────────────────

function makeDb(runFn?: jest.Mock): D1Database {
  const run = runFn ?? jest.fn().mockResolvedValue({ success: true, results: [] });
  return {
    prepare: jest.fn().mockReturnValue({
      bind: jest.fn().mockReturnValue({ run, all: jest.fn().mockResolvedValue({ results: [] }) }),
      run,
      all: jest.fn().mockResolvedValue({ results: [] }),
      first: jest.fn().mockResolvedValue(null),
    }),
    batch: jest.fn().mockResolvedValue([]),
    exec: jest.fn().mockResolvedValue({ count: 0, duration: 0 }),
    dump: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as D1Database;
}

// Minimal Env needed by handleCheckoutCompleted (no SALE_WEBHOOK_URL → skips sale call)
function makeEnv(): Env {
  return {
    STRIPE_SECRET_KEY: 'sk_test_xxx',
  } as unknown as Env;
}

// ── handleCheckoutCompleted ──────────────────────────────────────────────────

describe('handleCheckoutCompleted', () => {
  it('calls dbUpdate with plan=paid, status=active for the org subscription', async () => {
    const runMock = jest.fn().mockResolvedValue({ success: true, results: [] });
    const db = makeDb(runMock);
    const env = makeEnv();

    await handleCheckoutCompleted(db, env, {
      customer: 'cus_test',
      subscription: 'sub_test',
      metadata: { org_id: 'org-abc' },
    });

    // dbUpdate issues a prepared statement — confirm at least one bind() call
    // received the activation values.
    const prepareCalls = (db.prepare as jest.Mock).mock.calls as string[][];
    const updateCall = prepareCalls.find(([sql]) =>
      /UPDATE.*subscriptions/i.test(sql as unknown as string),
    );
    expect(updateCall).toBeDefined();

    // The bind args flowing to the UPDATE must include 'active' and 'paid'.
    const allBindCalls: unknown[][] = [];
    for (const prepareCall of (db.prepare as jest.Mock).mock.results) {
      const stmt = prepareCall.value as { bind: jest.Mock };
      if (stmt?.bind?.mock?.calls) {
        allBindCalls.push(...stmt.bind.mock.calls);
      }
    }

    const flatArgs = allBindCalls.flat();
    expect(flatArgs).toContain('active');
    expect(flatArgs).toContain('paid');
  });

  it('throws when org_id is missing from metadata', async () => {
    const db = makeDb();
    const env = makeEnv();

    await expect(
      handleCheckoutCompleted(db, env, {
        customer: 'cus_test',
        subscription: 'sub_test',
        metadata: {},
      }),
    ).rejects.toThrow(/org_id/i);
  });

  it('also updates the sites table with plan=paid when site_id is provided', async () => {
    const db = makeDb();
    const env = makeEnv();

    await handleCheckoutCompleted(db, env, {
      customer: 'cus_test',
      subscription: 'sub_test',
      metadata: { org_id: 'org-abc', site_id: 'site-xyz' },
    });

    const prepareCalls = (db.prepare as jest.Mock).mock.calls as Array<[string]>;
    const siteUpdate = prepareCalls.find(([sql]) => /UPDATE.*sites/i.test(sql));
    expect(siteUpdate).toBeDefined();
  });
});

// ── handleSubscriptionDeleted ────────────────────────────────────────────────

describe('handleSubscriptionDeleted', () => {
  it('calls dbUpdate with plan=free, status=canceled for the org subscription', async () => {
    const db = makeDb();

    await handleSubscriptionDeleted(db, {
      id: 'sub_test',
      metadata: { org_id: 'org-abc' },
    });

    const prepareCalls = (db.prepare as jest.Mock).mock.calls as Array<[string]>;
    const updateCall = prepareCalls.find(([sql]) => /UPDATE.*subscriptions/i.test(sql));
    expect(updateCall).toBeDefined();

    const allBindCalls: unknown[][] = [];
    for (const prepareCall of (db.prepare as jest.Mock).mock.results) {
      const stmt = prepareCall.value as { bind: jest.Mock };
      if (stmt?.bind?.mock?.calls) {
        allBindCalls.push(...stmt.bind.mock.calls);
      }
    }

    const flatArgs = allBindCalls.flat();
    expect(flatArgs).toContain('canceled');
    expect(flatArgs).toContain('free');
  });

  it('also downgrades all org sites to free plan', async () => {
    const db = makeDb();

    await handleSubscriptionDeleted(db, {
      id: 'sub_test',
      metadata: { org_id: 'org-abc' },
    });

    const prepareCalls = (db.prepare as jest.Mock).mock.calls as Array<[string]>;
    const siteFreeUpdate = prepareCalls.find(([sql]) => /UPDATE.*sites/i.test(sql));
    expect(siteFreeUpdate).toBeDefined();
  });

  it('returns early without error when org_id is absent', async () => {
    const db = makeDb();

    await expect(
      handleSubscriptionDeleted(db, { id: 'sub_test', metadata: {} }),
    ).resolves.toBeUndefined();

    // No DB writes should have happened
    expect(db.prepare as jest.Mock).not.toHaveBeenCalled();
  });
});
