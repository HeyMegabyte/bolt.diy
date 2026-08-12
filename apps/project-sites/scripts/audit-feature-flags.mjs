#!/usr/bin/env node
/**
 * audit-feature-flags.mjs — flag-hygiene audit for the quarterly cleanup the
 * [[feature-flags]] doctrine mandates. Joins FLAG_REGISTRY against actual code
 * readers + metadata quality and classifies every flag: REMOVE / IMPROVE / PROMOTE
 * / KEEP.
 *
 * Signals per flag:
 *   readers      — non-test, non-registry .ts files that reference the key
 *   readerKinds  — worker (isFlagOn/requireFlag) · ui (useFeatureFlag/featureFlagGuard) · grabbag (features.ts only)
 *   descLen      — description length (doctrine floor = 240 chars)
 *   stage/default — promotion state
 *
 * Verdicts:
 *   REMOVE   — 0 readers and not a core_* sentinel (dead flag; code never checks it)
 *   IMPROVE  — thin description (<240), OR grab-bag-only reader, OR stuck experimental with real readers
 *   PROMOTE  — has real readers, is used, still experimental/beta but effectively live
 *   KEEP     — sentinel or healthy stable/beta with readers + adequate metadata
 *
 * Usage: node scripts/audit-feature-flags.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REGISTRY = resolve(APP, 'src/modules/feature_flags/registry.ts');
const JSON_OUT = process.argv.includes('--json');
const DESC_FLOOR = 240;

// ── Parse the registry (clean object literal; anchor on each `key: '...'`). ──
const src = readFileSync(REGISTRY, 'utf8');
const keyRe = /\bkey:\s*'([a-z0-9_]+)'/g;
const anchors = [...src.matchAll(keyRe)].map((m) => ({ key: m[1], at: m.index }));
const flags = anchors.map((a, i) => {
  const block = src.slice(a.at, anchors[i + 1]?.at ?? src.length);
  const stage = block.match(/stage:\s*'([a-z]+)'/)?.[1] ?? '?';
  const enabled = /default_enabled:\s*true/.test(block);
  const rollout = Number(block.match(/default_rollout_percent:\s*(\d+)/)?.[1] ?? 0);
  const desc = block.match(/description:\s*([\s\S]*?),\s*\n\s*default_enabled/)?.[1] ?? '';
  const descLen = desc.replace(/['"\s+]/g, '').length; // rough char count after joining concat
  return { key: a.key, stage, enabled, rollout, descLen };
});

// ── Find readers of each key (one grep over real code, minus registry/tests/migrations). ──
function readersFor(key) {
  let out = '';
  try {
    out = execSync(
      `/usr/bin/grep -rlE "['\\"]${key}['\\"]" src frontend/src --include=*.ts 2>/dev/null || true`,
      { cwd: APP, encoding: 'utf8' },
    );
  } catch {
    /* grep exit 1 = no match */
  }
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/registry\.ts$|\/__tests__\/|\.spec\.ts$|feature_flags\/services\.ts$/.test(f));
}

const rows = flags.map((f) => {
  const readers = readersFor(f.key);
  const isSentinel = f.key.startsWith('core_');
  const onlyGrabbag = readers.length > 0 && readers.every((r) => /routes\/features\.ts$/.test(r));
  const hasUi = readers.some((r) => /frontend\//.test(r));
  const hasWorker = readers.some((r) => /(^|\/)src\//.test(r));

  let verdict, reason;
  if (isSentinel) {
    verdict = 'KEEP'; reason = 'core_* sentinel (always-on, protected)';
  } else if (readers.length === 0) {
    verdict = 'REMOVE'; reason = 'DEAD — no code reads this flag';
  } else if (onlyGrabbag && !f.enabled) {
    verdict = 'IMPROVE'; reason = 'grab-bag only (features.ts, default-off) — validate boundary or retire';
  } else if (f.descLen < DESC_FLOOR) {
    verdict = 'IMPROVE'; reason = `thin description (${f.descLen}<${DESC_FLOOR})`;
  } else if (f.stage === 'experimental' && (hasWorker || hasUi)) {
    verdict = 'PROMOTE'; reason = 'experimental but has live readers — promote to beta/stable or kill';
  } else {
    verdict = 'KEEP'; reason = `healthy (${f.stage}, ${readers.length} reader file(s))`;
  }
  return { ...f, readers: readers.length, readerFiles: readers, hasUi, hasWorker, onlyGrabbag, verdict, reason };
});

const by = (v) => rows.filter((r) => r.verdict === v);
const summary = {
  total: rows.length,
  REMOVE: by('REMOVE').length,
  IMPROVE: by('IMPROVE').length,
  PROMOTE: by('PROMOTE').length,
  KEEP: by('KEEP').length,
  no_e2e_field: 'registry interface has NO e2e_tests/smoke_steps field (doctrine requires both)',
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log(`\n═══ Feature-Flag Audit — ${rows.length} flags ═══`);
  console.log(`REMOVE ${summary.REMOVE} · IMPROVE ${summary.IMPROVE} · PROMOTE ${summary.PROMOTE} · KEEP ${summary.KEEP}\n`);
  for (const v of ['REMOVE', 'PROMOTE', 'IMPROVE', 'KEEP']) {
    const list = by(v);
    if (!list.length) continue;
    console.log(`\n── ${v} (${list.length}) ──`);
    for (const r of list.sort((a, b) => a.key.localeCompare(b.key))) {
      const tag = `${r.stage}${r.enabled ? '/on' : '/off'}·${r.readers}r·${r.descLen}c`;
      console.log(`  ${r.key.padEnd(34)} [${tag}] ${r.reason}`);
    }
  }
  console.log(`\n⚠️  Structural: registry FlagDefinition has no e2e_tests/smoke_steps field — the doctrine mandates both. Every flag technically fails that gate.`);
}
