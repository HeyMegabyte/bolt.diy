/**
 * Unit tests for the Stripe App Marketplace install-analytics service.
 *
 * Covers:
 *   - StripeAppLifecycleEventSchema rejects invalid stripe_account ids
 *   - summarizeInstalls aggregates by status + source
 *   - recordLifecycleEvent upserts and updates status on subsequent events
 *   - listInstalls / getInstallSummary filter by orgId
 */

import {
  StripeAppLifecycleEventSchema,
  StripeAppInstallSchema,
  summarizeInstalls,
  type StripeAppInstall,
} from '../../libs/features/stripe_app_status/feature.schemas.js';
import {
  listInstalls,
  getInstallSummary,
  recordLifecycleEvent,
} from '../services/stripe_app_status.js';
import { stripeAppStatus } from '../routes/stripe_app_status.js';
import { authApp, flagKv } from './helpers/route_harness.js';
import type { Env } from '../types/env.js';

// ─── Mock D1 ─────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  org_id: string | null;
  stripe_account: string;
  install_source: string;
  status: string;
  installed_at: string;
  uninstalled_at: string | null;
  last_event_at: string | null;
  metadata_json: string | null;
  deleted_at: string | null;
}

function makeEnv() {
  const rows: Row[] = [];
  function prepare(sql: string) {
    let binds: unknown[] = [];
    return {
      bind(...args: unknown[]) {
        binds = args;
        return this;
      },
      async first<T>(): Promise<T | null> {
        if (/FROM stripe_app_installations/.test(sql)) {
          const account = binds[0] as string;
          const row = rows.find((r) => r.stripe_account === account && r.deleted_at === null);
          return (row as unknown as T) ?? null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (/FROM stripe_app_installations/.test(sql)) {
          let filtered = rows.filter((r) => r.deleted_at === null);
          // First two binds in org-scoped query: orgId, limit, offset
          if (sql.includes('AND org_id = ?')) {
            const orgId = binds[0] as string;
            filtered = filtered.filter((r) => r.org_id === orgId);
          }
          filtered.sort((a, b) => b.installed_at.localeCompare(a.installed_at));
          return { results: filtered as unknown as T[] };
        }
        return { results: [] };
      },
      async run() {
        if (sql.trim().startsWith('INSERT INTO stripe_app_installations')) {
          const [
            id,
            org_id,
            stripe_account,
            install_source,
            status,
            installed_at,
            uninstalled_at,
            last_event_at,
            metadata_json,
          ] = binds as never[];
          const existing = rows.find(
            (r) => r.stripe_account === stripe_account && r.deleted_at === null,
          );
          if (existing) {
            existing.org_id = org_id ?? existing.org_id;
            existing.install_source = install_source;
            existing.status = status;
            existing.uninstalled_at = uninstalled_at;
            existing.last_event_at = last_event_at;
            existing.metadata_json = metadata_json ?? existing.metadata_json;
          } else {
            rows.push({
              id,
              org_id,
              stripe_account,
              install_source,
              status,
              installed_at,
              uninstalled_at,
              last_event_at,
              metadata_json,
              deleted_at: null,
            });
          }
        }
        return { success: true, meta: {} };
      },
    };
  }
  return { env: { DB: { prepare } as unknown as D1Database } };
}

// ─── Schemas + helpers ───────────────────────────────────────────────────────

describe('stripe_app_status schemas', () => {
  test('StripeAppLifecycleEventSchema rejects non-acct_ ids', () => {
    expect(() =>
      StripeAppLifecycleEventSchema.parse({
        stripe_account: 'cust_123',
        event_type: 'installed',
      }),
    ).toThrow();
  });

  test('StripeAppLifecycleEventSchema accepts valid event with default source', () => {
    const parsed = StripeAppLifecycleEventSchema.parse({
      stripe_account: 'acct_abc123',
      event_type: 'installed',
    });
    expect(parsed.install_source).toBe('marketplace');
  });

  test('summarizeInstalls aggregates correctly', () => {
    const installs: StripeAppInstall[] = [
      StripeAppInstallSchema.parse({
        id: '1',
        org_id: 'org-a',
        stripe_account: 'acct_a',
        install_source: 'marketplace',
        status: 'installed',
        installed_at: '2026-05-26T00:00:00Z',
        uninstalled_at: null,
        last_event_at: '2026-05-26T00:00:00Z',
      }),
      StripeAppInstallSchema.parse({
        id: '2',
        org_id: 'org-b',
        stripe_account: 'acct_b',
        install_source: 'direct',
        status: 'uninstalled',
        installed_at: '2026-05-25T00:00:00Z',
        uninstalled_at: '2026-05-27T00:00:00Z',
        last_event_at: '2026-05-27T00:00:00Z',
      }),
      StripeAppInstallSchema.parse({
        id: '3',
        org_id: 'org-c',
        stripe_account: 'acct_c',
        install_source: 'marketplace',
        status: 'paused',
        installed_at: '2026-05-24T00:00:00Z',
        uninstalled_at: null,
        last_event_at: '2026-05-28T00:00:00Z',
      }),
    ];
    const summary = summarizeInstalls(installs);
    expect(summary.total_installs).toBe(3);
    expect(summary.active_installs).toBe(1);
    expect(summary.uninstalled).toBe(1);
    expect(summary.paused).toBe(1);
    expect(summary.by_source.marketplace).toBe(2);
    expect(summary.by_source.direct).toBe(1);
    expect(summary.by_source.referral).toBe(0);
    expect(summary.last_event_at).toBe('2026-05-28T00:00:00Z');
  });
});

// ─── Service ─────────────────────────────────────────────────────────────────

describe('stripe_app_status service', () => {
  test('recordLifecycleEvent inserts on first event', async () => {
    const { env } = makeEnv();
    const row = await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_new1',
      event_type: 'installed',
      install_source: 'marketplace',
      org_id: 'org-x',
    });
    expect(row.stripe_account).toBe('acct_new1');
    expect(row.status).toBe('installed');
    expect(row.org_id).toBe('org-x');
  });

  test('recordLifecycleEvent updates status on subsequent uninstalled event', async () => {
    const { env } = makeEnv();
    await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_evo',
      event_type: 'installed',
      install_source: 'marketplace',
    });
    const updated = await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_evo',
      event_type: 'uninstalled',
      install_source: 'marketplace',
    });
    expect(updated.status).toBe('uninstalled');
    expect(updated.uninstalled_at).not.toBeNull();
  });

  test('listInstalls filters by orgId', async () => {
    const { env } = makeEnv();
    await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_1',
      event_type: 'installed',
      install_source: 'marketplace',
      org_id: 'org-x',
    });
    await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_2',
      event_type: 'installed',
      install_source: 'direct',
      org_id: 'org-y',
    });
    const xs = await listInstalls(env as never, { orgId: 'org-x' });
    expect(xs).toHaveLength(1);
    expect(xs[0]!.stripe_account).toBe('acct_1');
  });

  test('getInstallSummary returns aggregate for an org', async () => {
    const { env } = makeEnv();
    await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_alpha',
      event_type: 'installed',
      install_source: 'referral',
      org_id: 'org-z',
    });
    await recordLifecycleEvent(env as never, {
      stripe_account: 'acct_beta',
      event_type: 'paused',
      install_source: 'marketplace',
      org_id: 'org-z',
    });
    const summary = await getInstallSummary(env as never, 'org-z');
    expect(summary.total_installs).toBe(2);
    expect(summary.active_installs).toBe(1);
    expect(summary.paused).toBe(1);
    expect(summary.by_source.referral).toBe(1);
  });
});

// ── Route layer: lifecycle org-attribution precedence ────────────────────────

describe('stripe_app_status lifecycle route (org precedence)', () => {
  const LIFECYCLE = '/api/stripe-app/lifecycle';

  function lifecycleBody(org_id?: string) {
    return JSON.stringify({
      stripe_account: 'acct_route1',
      install_source: 'marketplace',
      event_type: 'installed',
      ...(org_id ? { org_id } : {}),
    });
  }

  /** In-memory D1 fake + a flag-aware KV the route guard reads. */
  function routeEnv(flagOn: boolean): Env {
    const { env } = makeEnv();
    return {
      DB: (env as { DB: D1Database }).DB,
      CACHE_KV: flagKv(flagOn),
    } as unknown as Env;
  }

  it('403 when an authenticated caller attributes the event to another org', async () => {
    const app = authApp(stripeAppStatus, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      LIFECYCLE,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: lifecycleBody('org-b'),
      },
      routeEnv(true),
    );
    expect(res.status).toBe(403);
  });

  it('202 and persists the trusted CONTEXT org (ignores absent body org)', async () => {
    const app = authApp(stripeAppStatus, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      LIFECYCLE,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: lifecycleBody() },
      routeEnv(true),
    );
    expect(res.status).toBe(202);
    const json = (await res.json()) as { data: { org_id: string | null } };
    expect(json.data.org_id).toBe('org-a');
  });

  it('202 for the unauthenticated marketplace callback using the payload org', async () => {
    const app = authApp(stripeAppStatus); // no auth context (Stripe callback)
    const res = await app.request(
      LIFECYCLE,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: lifecycleBody('org-merchant'),
      },
      routeEnv(true),
    );
    expect(res.status).toBe(202);
    const json = (await res.json()) as { data: { org_id: string | null } };
    expect(json.data.org_id).toBe('org-merchant');
  });

  it('404 when the flag is off', async () => {
    const app = authApp(stripeAppStatus, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      LIFECYCLE,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: lifecycleBody('org-a'),
      },
      routeEnv(false),
    );
    expect(res.status).toBe(404);
  });
});
