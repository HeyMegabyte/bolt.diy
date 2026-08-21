#!/usr/bin/env node
/**
 * verify-integration-health-statuses.mjs — TECHNICAL regression guard for the live
 * `GET /api/integrations/health` statuses (the data behind the /admin/system-services
 * health chips). Complements verify-system-services-health.mjs (which confirms the UI
 * renders chips + 0 console errors as brian) by asserting the DATA is CORRECT — locking
 * in the 2026-08-08 four-fire lying-status arc:
 *   - twenty / listmonk / payload → LIVE-probed at a PUBLIC health endpoint (crm/healthz,
 *     mail/health, cms/healthz) → must NEVER read config-presence 'unknown'. An 'unknown'
 *     means the probe regressed back to an authed data endpoint (twenty /rest/companies
 *     403, listmonk /api/health 403) or a config-presence check.
 *   - lago / unkey / nango / inngest / postiz → decommissioned → must read 'removed',
 *     never a config-presence status.
 *   - unkey → must NEVER read 'failing'. api.projectsites.dev/api/health is the MAIN
 *     worker's own health (self-subrequest LOOP), so live-probing it falsely reports
 *     failing; 'unknown' (config-presence) is the honest state (the worker uses D1 for
 *     API keys per ADR-0030, not the managed unkey service).
 *
 * Robust invariants, NOT brittle exact-match: a genuine outage (failing/degraded on a
 * live-probed service) is ALLOWED — only the CODE-regression statuses (unknown/failing
 * where they're structurally impossible) fail the guard, per validator-precision-discipline.
 *
 * Public endpoint — no auth / no Browserbase. Real-browser UA keeps the WAF friendly.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const URL = 'https://projectsites.dev/api/integrations/health';

/** Services LIVE-probed at a public health endpoint — a probe regression shows as 'unknown'. */
const LIVE_PROBED = ['twenty', 'listmonk', 'payload'];
/** Decommissioned per ADR-0034 — must read 'removed'. */
const REMOVED = ['lago', 'nango', 'inngest', 'postiz', 'unkey'];

const res = await fetch(URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
if (!res.ok) {
  console.log(`::error:: ${URL} → HTTP ${res.status} (expected 200)`);
  process.exit(1);
}
const body = await res.json();
const integrations = Array.isArray(body.integrations) ? body.integrations : [];
const status = Object.fromEntries(integrations.map((i) => [i.integration, i.status]));

const failures = [];

for (const name of LIVE_PROBED) {
  if (!(name in status)) failures.push(`${name}: MISSING from /api/integrations/health response`);
  else if (status[name] === 'unknown')
    failures.push(
      `${name}=unknown — live-probe regressed to config-presence (should probe its PUBLIC health endpoint)`,
    );
}
for (const name of REMOVED) {
  if (status[name] !== 'removed')
    failures.push(`${name}=${status[name] ?? 'MISSING'} — should be 'removed' (decommissioned ADR-0034)`);
}
if (status.unkey === 'failing')
  failures.push(
    `unkey=failing — self-subrequest-loop regressed (api.projectsites.dev/api/health is the MAIN worker; keep unkey config-presence)`,
  );

const failingNow = integrations.filter((i) => i.status === 'failing').map((i) => i.integration);
console.log(
  JSON.stringify({ url: URL, count: integrations.length, statuses: status, failingNow, failures }, null, 2),
);

if (failures.length) {
  console.log(`::error:: ${failures.length} integration-health status regression(s) — see above`);
  process.exit(1);
}
console.log(
  '✅ integration-health statuses correct — twenty/listmonk/payload live (not unknown), decommissioned removed',
);
