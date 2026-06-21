#!/usr/bin/env node
/**
 * tinybird-smoke — post-deploy E2E proof for the live analytics pipeline.
 * Ingests ONE synthetic event into projectsites_events (Events API, append token)
 * under a HARMLESS sentinel tenant (`_smoke`, never a real org), then polls the
 * pipes until it round-trips — proving the deployed datasource (jsonpath schema)
 * + the JSONExtract(payload) slicing actually carry a real row. The sentinel
 * tenant means real per-tenant queries never see it.
 *
 * Verifies the half that `tb deploy` couldn't (empty pipes): schema parse +
 * payload extraction with live data. The worker's emit→outbox→drain→ingest half
 * is unit-tested separately. Run post-deploy or as a scheduled health probe.
 *
 * Usage:  node scripts/tinybird-smoke.mjs
 * Env:    TINYBIRD_API_HOST + a token (TINYBIRD_TOKEN → TINYBIRD_PASSWORD → MCP).
 *
 * Pure builders (resolveConfig, buildSmokeEvent, eventsDailyHasRow) are exported
 * + unit-tested in scripts/__tests__/tinybird-smoke.test.mjs.
 */

const SENTINEL_TENANT = '_smoke';

/** `{ host, token }` from env, or null when unconfigured (mirrors the worker chain). */
export function resolveConfig(env) {
  const host = (env.TINYBIRD_API_HOST || '').trim().replace(/\/+$/, '');
  const token = (env.TINYBIRD_TOKEN || env.TINYBIRD_PASSWORD || env.TINYBIRD_MCP_TOKEN || '').trim();
  if (!host || !token) return null;
  return { host, token };
}

/**
 * Build the synthetic NDJSON event — same shape dispatchOutboxEvent sends, under
 * the sentinel tenant + a `site.published` event carrying a payload.source so the
 * publishes-by-source JSONExtract path is exercised too.
 */
export function buildSmokeEvent(nowIso, id) {
  return {
    site_id: `smoke-${id}`,
    tenant_id: SENTINEL_TENANT,
    event: 'site.published',
    timestamp: nowIso,
    event_id: `smoke-${id}`,
    trace_id: `smoke-${id}`,
    producer: 'worker',
    payload: JSON.stringify({ slug: 'smoke', version: 'v0', source: 'smoke-test' }),
  };
}

/** True when the events_by_tenant_daily rows contain our sentinel event. */
export function eventsDailyHasRow(rows, expectedEventId) {
  // The pipe aggregates (no event_id column), so match on tenant + event presence.
  void expectedEventId;
  return rows.some((r) => r.tenant_id === SENTINEL_TENANT && r.event === 'site.published');
}

/** The delete_condition that removes ONLY sentinel rows (never touches real tenants). */
export function smokeDeleteCondition() {
  return `tenant_id = '${SENTINEL_TENANT}'`;
}

/**
 * Delete the sentinel rows so the probe leaves the prod datasource clean (it is
 * a repeatable health check, not a data writer). Needs a token with delete scope
 * (admin); returns false (warns) rather than throwing when the token can't delete.
 */
async function cleanupSmoke(cfg, doFetch) {
  const res = await doFetch(`${cfg.host}/v0/datasources/projectsites_events/delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `delete_condition=${encodeURIComponent(smokeDeleteCondition())}`,
  });
  return res.status >= 200 && res.status < 300;
}

async function ingest(cfg, event, doFetch) {
  const res = await doFetch(`${cfg.host}/v0/events?name=projectsites_events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/x-ndjson' },
    body: JSON.stringify(event),
  });
  if (!(res.status >= 200 && res.status < 300)) {
    throw new Error(`ingest failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}

async function queryPipe(cfg, pipe, params, doFetch) {
  const qs = new URLSearchParams({ tenant_id: SENTINEL_TENANT, ...params }).toString();
  const res = await doFetch(`${cfg.host}/v0/pipes/${pipe}.json?${qs}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (res.status !== 200) return [];
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body.data) ? body.data : [];
}

// ── CLI entry (skipped under test import) ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('tinybird-smoke.mjs')) {
  const cfg = resolveConfig(process.env);
  if (!cfg) {
    console.error('tinybird-smoke: TINYBIRD_API_HOST + a token are required.');
    process.exit(2);
  }
  const id = `${Date.now()}`;
  const nowIso = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const event = buildSmokeEvent(nowIso, id);

  console.warn(`Ingesting smoke event (tenant=${SENTINEL_TENANT}, id=${id})…`);
  await ingest(cfg, event, fetch);

  // Tinybird ingest is near-real-time but not instant — poll up to ~30s.
  let daily = [];
  let publishes = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    daily = await queryPipe(cfg, 'events_by_tenant_daily', { days: '1' }, fetch);
    publishes = await queryPipe(cfg, 'site_publishes_by_source', { days: '1' }, fetch);
    if (eventsDailyHasRow(daily, event.event_id)) break;
    console.warn(`  …not visible yet (attempt ${attempt}/10)`);
  }

  const inDaily = eventsDailyHasRow(daily, event.event_id);
  const sliced = publishes.some((r) => r.source === 'smoke-test');
  console.warn(`events_by_tenant_daily round-trip: ${inDaily ? 'OK' : 'MISSING'}`);
  console.warn(`site_publishes_by_source JSONExtract(payload.source): ${sliced ? 'OK' : 'MISSING'}`);

  // Leave prod clean — remove the sentinel rows (best-effort; needs delete scope).
  const cleaned = await cleanupSmoke(cfg, fetch).catch(() => false);
  console.warn(`cleanup of sentinel rows: ${cleaned ? 'OK' : 'skipped (token lacks delete scope)'}`);

  if (inDaily && sliced) {
    console.warn('\n✓ Live pipeline proven: ingest → datasource (jsonpath) → pipe → payload-slice.');
    process.exit(0);
  }
  console.error('\n✗ Smoke event did not round-trip within the poll window.');
  process.exit(1);
}
