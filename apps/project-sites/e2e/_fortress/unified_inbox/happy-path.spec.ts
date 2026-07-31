/**
 * @fortress UNIFIED_INBOX — happy-path evidence  (flag `unified_inbox`)
 *
 * ── Surface reality (grepped 2026-07-31) ────────────────────────────────────
 * `unified_inbox` is a WORKER-ONLY feature. There is NO frontend inbox panel —
 * the admin "inbox" the old spec drove is the Task Tray (`components/task-tray/`,
 * `/api/inbox/tasks`), a DIFFERENT feature. The real Unified Visitor Inbox is the
 * `/api/inbox/conversations*` family in `src/routes/inbox.ts`, gated by
 * `isFlagOn(env, 'unified_inbox', …)` (returns 404 when the flag is OFF).
 *
 * ── Why the old spec failed live (root cause) ───────────────────────────────
 * The old happy-path assumed a UI at `/admin/inbox` and stubbed `/api/inbox/tasks`.
 * There is no such route or surface, so every UI assertion failed. Separately,
 * `GET /api/feature-flags/unified_inbox` shows the flag is presently resolved
 * **ON in prod** (`resolved.enabled=true, rollout_percent=100, source:"global"`
 * — an operator override), so any "flag-off ⇒ 404" claim is FALSE against live
 * prod. This spec asserts the API family's REAL live contract instead.
 *
 * ── Evidence shape chosen (server-side flags can't be stubbed from Playwright) ─
 * (a) resilientGet the read endpoints and assert the live contract:
 *       - list: 200 JSON envelope {conversations,hasMore,total} (flag currently ON),
 *         OR the dark 404 if an operator flips it OFF — both are the CORRECT
 *         contract, never a 500/HTML.
 *       - detail with a bogus id: org-scoped non-leak 404 (never 500).
 * (b) The full ON-state behavior (list filters, reply→channel dispatch, assign,
 *     status transitions, AI draft, Zod 400s) is exercised by the worker Jest
 *     suite `src/__tests__/inbox_routes.test.ts` — cited by name below. Those
 *     stub `isFlagOn` true (impossible from the browser) and assert the mounted
 *     handlers directly, which is where ON-state coverage correctly lives.
 *
 *   Jest coverage (src/__tests__/inbox_routes.test.ts), cited so the ON path is
 *   provably covered somewhere:
 *     · 'returns the conversation list with hasMore + total'
 *     · 'forwards status / channel / assigned_to / limit / cursor filters (limit capped at 100)'
 *     · 'appends the message, dispatches via channel, and returns sent status'
 *     · 'assigns the conversation and echoes assigned_to'  /  'accepts a null assignee (unassign)'
 *     · 'updates the status and echoes it'
 *     · 'returns the AI-generated draft when the conversation exists'
 *     · 'returns 400 when the body is empty (Zod min(1))'  /  '…returns 400 for an out-of-enum status'
 *
 * Screenshots: none (worker-only; there is no page to shoot). Console-error and
 * axe gates are covered in the feature-flags/admin fortress pairs, not here.
 */
import { test, expect } from '../../fixtures.js';
import { resilientGet } from '../../helpers/api-request.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('UNIFIED_INBOX HAPPY — live API family contract', () => {
  test('IB-HP-01 GET /api/inbox/conversations honours its live contract (200 envelope OR 404 dark)', async ({
    request,
  }) => {
    const res = await resilientGet(request, `${BASE}/api/inbox/conversations`, { timeout: 15_000 });
    const status = res.status();

    // Flag ON (current prod) → 200 list; flag OFF → 404 dark. Both correct.
    // A 500 / HTML shell / anything else is a real regression.
    expect([200, 404], `unexpected status ${status} from conversations list`).toContain(status);
    expect(res.headers()['content-type'] ?? '', 'JSON contract, never an HTML shell').toContain(
      'application/json',
    );

    const body = (await res.json().catch(() => null)) as
      | { conversations?: unknown[]; hasMore?: boolean; total?: number; error?: unknown }
      | null;
    expect(body, 'response must be parseable JSON').not.toBeNull();

    if (status === 200) {
      // Flag ON: the envelope shape is the contract (see Jest
      // 'returns the conversation list with hasMore + total').
      expect(Array.isArray(body?.conversations), 'conversations is an array').toBe(true);
      expect(typeof body?.hasMore, 'hasMore is a boolean').toBe('boolean');
      expect(typeof body?.total, 'total is a number').toBe('number');
    } else {
      // Flag OFF: dark contract — {error:'not_found'}, never a leak of internals.
      expect(body).toHaveProperty('error');
    }
  });

  test('IB-HP-02 list accepts status/channel filters without 500', async ({ request }) => {
    // Filter forwarding is unit-covered ('forwards status / channel / … filters');
    // here we prove the LIVE endpoint tolerates the query surface (no crash).
    const res = await resilientGet(
      request,
      `${BASE}/api/inbox/conversations?status=open&channel=email&limit=10`,
      { timeout: 15_000 },
    );
    expect([200, 404]).toContain(res.status());
    expect(res.status(), 'filter query must never 500').not.toBe(500);
  });

  test('IB-HP-03 GET /api/inbox/conversations/:id is an org-scoped non-leak (404, never 500)', async ({
    request,
  }) => {
    // A conversation id that cannot belong to an unauthenticated caller's org →
    // the handler returns 404 (org-scoping non-leak) whether the flag is on or
    // off. Unit mirror: 'returns 404 (org-scoping non-leak) when the row is not
    // found for this org'.
    const res = await resilientGet(
      request,
      `${BASE}/api/inbox/conversations/00000000-0000-0000-0000-000000000000`,
      { timeout: 15_000 },
    );
    expect(res.status(), 'unknown conversation must be 404, not 500').toBe(404);
  });

  test('IB-HP-04 unknown /api/inbox/* subpath is a clean JSON 404 (not the SPA shell)', async ({
    request,
  }) => {
    // Soft-404 doctrine: an unmatched /api/* path returns a real 404 STATUS with
    // JSON, never a 200 index.html.
    const res = await resilientGet(request, `${BASE}/api/inbox/zzz-nonexistent-route`, {
      timeout: 15_000,
    });
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
  });
});
