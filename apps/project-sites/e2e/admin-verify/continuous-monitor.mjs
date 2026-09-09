#!/usr/bin/env node
/**
 * continuous-monitor.mjs — the "always-running" prod heartbeat (Brian directive 2026-09-08).
 *
 * A gentle, paced, never-crashing loop that continuously proves projectsites.dev is
 * alive + honest without hammering prod (respects `workers-observability-prod-verify-sampling`:
 * one lightweight check per ~90s cycle, well under 100 req/60s). Each cycle rotates through a
 * different surface so over time it covers health, the guest funnel entry, the editor, and a
 * generated site — logging a timestamped PASS/FAIL line to stdout AND ./_monitor.log.
 *
 * One failed check never stops the loop (caught + logged). Runs CYCLES iterations (default 160
 * × ~90s ≈ 4h) then exits cleanly; re-launch to keep it running.
 *
 * Usage: node e2e/admin-verify/continuous-monitor.mjs   (CYCLES=… INTERVAL_MS=… to tune)
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const LOG = resolve(dirname(fileURLToPath(import.meta.url)), '_monitor.log');
const CYCLES = Number(process.env.CYCLES || 160);
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 90_000);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };

/** Each probe returns a short status string; throwing is caught + logged as FAIL. */
const PROBES = [
  { name: 'marketing /', fn: async () => `${(await fetch('https://projectsites.dev/', { headers: H })).status}` },
  { name: 'api /health', fn: async () => { const r = await fetch('https://projectsites.dev/api/health', { headers: H }); const j = await r.json().catch(() => ({})); return `${r.status} ${j?.status ?? '?'}`; } },
  { name: 'editor /', fn: async () => `${(await fetch('https://editor.projectsites.dev/', { headers: H })).status}` },
  { name: 'guest search', fn: async () => { const r = await fetch('https://projectsites.dev/api/sites/search?q=coffee', { headers: H }); return `${r.status}`; } },
  { name: 'gen-site harborline', fn: async () => `${(await fetch('https://harborline-coffee-roasters-boston.projectsites.dev/', { headers: H })).status}` },
  { name: 'sitemap', fn: async () => `${(await fetch('https://harborline-coffee-roasters-boston.projectsites.dev/sitemap.xml', { headers: H })).status}` },
];

function log(line) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const msg = `[${stamp}] ${line}`;
  console.log(msg);
  try { appendFileSync(LOG, msg + '\n'); } catch { /* best-effort */ }
}

log(`▶ continuous-monitor START — ${CYCLES} cycles × ${Math.round(INTERVAL_MS / 1000)}s`);
let pass = 0, fail = 0;
for (let i = 0; i < CYCLES; i++) {
  const probe = PROBES[i % PROBES.length];
  const t0 = Date.now();
  try {
    const status = await probe.fn();
    const ok = /\b200\b|\bok\b/i.test(status);
    if (ok) pass++; else fail++;
    log(`${ok ? '✅' : '⚠️ '} cycle ${i + 1}/${CYCLES} · ${probe.name} → ${status} (${Date.now() - t0}ms) · ${pass}✓/${fail}⚠`);
  } catch (e) {
    fail++;
    log(`🔴 cycle ${i + 1}/${CYCLES} · ${probe.name} → ERROR ${String(e).slice(0, 80)} · ${pass}✓/${fail}⚠`);
  }
  if (i < CYCLES - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
log(`■ continuous-monitor DONE — ${pass}✓ / ${fail}⚠ over ${CYCLES} cycles`);
