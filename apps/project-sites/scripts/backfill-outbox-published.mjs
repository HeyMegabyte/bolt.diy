#!/usr/bin/env node
/**
 * backfill-outbox-published.mjs — one-shot ops: synthesize a `site.published`
 * outbox event per already-published site so the activation funnel's Delivered
 * stage reconciles with the D1 store (display == store).
 *
 * WHY: the historical `site.published` emits were LOST because `outbox_events`
 * didn't exist in prod (migration 0574 was committed but never applied — AL-050).
 * `writeOutbox`'s INSERT failed silently → 0 events ever reached Tinybird → the
 * super-admin funnel honestly showed Delivered=0 while D1 had 106 published sites.
 * Creating the table only fixes it FORWARD; this replays the history.
 *
 * Reads a JSON array of {id, org_id, slug, updated_at} (published sites, from a
 * `wrangler d1 execute --json` dump — sites has no published_at, so updated_at is
 * the publish-time proxy) and emits `INSERT OR IGNORE` SQL for `outbox_events`.
 * The existing every-5-minutes cron `drainOutbox` then fans each to Tinybird (funnel's
 * source), so we reuse the proven dispatch path instead of hand-writing Tinybird
 * rows.
 *
 * SAFETY: every payload is validated against a REPLICA of the event_bus.ts
 * `ProjectSitesEventSchema` BEFORE emit. `readPendingOutbox` does
 * `Schema.parse(JSON.parse(payload))` on every drained row, so ONE malformed
 * payload throws and WEDGES the whole drain (no rows dispatch, real events stuck).
 * We abort (exit 2) on any invalid payload rather than risk that.
 *
 * PRECONDITION: the AL-050 dispatcher fix (best-effort Hatchet) must be LIVE — else
 * each row retries on the broken Hatchet push and re-ingests Tinybird per attempt.
 *
 * Idempotency key `site.published:backfill:<siteId>` (UNIQUE) → re-run is a no-op
 * and never collides with a real emit's key.
 *
 * Usage:
 *   node scripts/backfill-outbox-published.mjs <sites.json> [--limit=N] [--out=file.sql]
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

// ─── Mirror of src/services/event_bus.ts (keep in sync) ─────────────────────
const EVENT_PRODUCERS = [
  'worker',
  'container',
  'admin',
  'cloudflare-workflows',
  'hatchet',
  'stripe',
  'hookdeck',
  'dub',
  'llm',
  'psnotify',
];
const EVENT_TYPES = [
  'site.created',
  'site.claim.started',
  'site.claim.completed',
  'site.generated',
  'site.published',
  'site.publish.failed',
  'subscription.active',
  'subscription.past_due',
  'subscription.canceled',
  'invoice.paid',
  'invoice.failed',
  'entitlement.updated',
  'lead.discovered',
  'notification.workflow.triggered',
];
const ProjectSitesEventSchema = z
  .object({
    specversion: z.literal('1.0'),
    schemaVersion: z.string().min(1),
    id: z.string().min(1),
    type: z.enum(EVENT_TYPES),
    source: z.string().min(1),
    subject: z.string().optional(),
    time: z.string().min(1),
    datacontenttype: z.literal('application/json'),
    traceId: z.string().min(1),
    requestId: z.string().optional(),
    tenantId: z.string().min(1),
    accountId: z.string().optional(),
    siteId: z.string().optional(),
    userId: z.string().optional(),
    producer: z.enum(EVENT_PRODUCERS),
    data: z.record(z.unknown()),
  })
  .strict();

const args = process.argv.slice(2);
const sitesPath = args.find((a) => !a.startsWith('--'));
const limitArg = args.find((a) => a.startsWith('--limit='));
const outArg = args.find((a) => a.startsWith('--out='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const outFile = outArg ? outArg.split('=')[1] : '/tmp/backfill.sql';
if (!sitesPath) {
  console.error('usage: node backfill-outbox-published.mjs <sites.json> [--limit=N] [--out=file.sql]');
  process.exit(1);
}

const sites = JSON.parse(readFileSync(sitesPath, 'utf8'));
/** SQL single-quote escape (payload JSON has no single quotes; slugs are [a-z0-9-]; defensive). */
const sq = (s) => String(s).replace(/'/g, "''");
/** D1 `2026-09-06 05:30:49` → ISO `2026-09-06T05:30:49Z` (Tinybird DateTime-parseable). */
const toIso = (u) => {
  const s = String(u).trim();
  return /T.*Z$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
};

const rows = [];
let n = 0;
for (const s of sites) {
  if (n >= limit) break;
  if (!s.id || !s.org_id) {
    console.error('SKIP (missing id/org_id):', JSON.stringify(s));
    continue;
  }
  const ev = {
    specversion: '1.0',
    schemaVersion: '1',
    id: randomUUID(),
    type: 'site.published',
    source: 'projectsites/worker',
    time: toIso(s.updated_at),
    datacontenttype: 'application/json',
    traceId: 'backfill-al051',
    tenantId: s.org_id,
    siteId: s.id,
    producer: 'worker',
    data: { slug: s.slug ?? '', source: 'backfill', backfill: true },
  };
  const parsed = ProjectSitesEventSchema.safeParse(ev);
  if (!parsed.success) {
    console.error('ABORT — invalid payload for site', s.id, JSON.stringify(parsed.error.issues));
    process.exit(2);
  }
  const payload = JSON.stringify(ev);
  const idk = `site.published:backfill:${s.id}`;
  rows.push(
    `INSERT OR IGNORE INTO outbox_events (id, idempotency_key, type, tenant_id, site_id, trace_id, producer, payload, status, attempts, created_at) ` +
      `VALUES ('${sq(ev.id)}','${sq(idk)}','site.published','${sq(ev.tenantId)}','${sq(ev.siteId)}','${sq(ev.traceId)}','worker','${sq(payload)}','pending',0,'${sq(ev.time)}');`,
  );
  n++;
}
writeFileSync(outFile, `${rows.join('\n')}\n`);
console.log(`validated + wrote ${rows.length} INSERT statements → ${outFile}`);
