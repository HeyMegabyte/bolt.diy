#!/usr/bin/env node
// Flag-grouping codemod (Brian 2026-08-14): fold member flags into an anchor flag,
// keeping every module. Per member: (1) manifest flagKey → anchor, (2) isFlagOn
// readers → anchor, (3) remove member entry from registry.ts + docs.ts.
// The 7 anchors are exempted from the drift gate's DUPLICATE_FLAG_KEY (like __core__).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = {
  site_analytics: ['visitor_events_core'],
  site_doctor: ['prod_readiness_score', 'site_health_sparklines'],
  onboarding_copilot: ['onboarding_progress'],
  mcp_server: ['platform_mcp', 'mcp_oauth_provider'],
  activity_feed: ['mru_cards', 'usage_gauges', 'notification_badge', 'analytics_annotations'],
  batch_operations: ['site_clone', 'site_comparison'],
  social_publishing_native: ['social_agent'],
};
const memberToAnchor = {};
for (const [a, ms] of Object.entries(GROUPS)) for (const m of ms) memberToAnchor[m] = a;

// ── brace matcher + keyed-entry remover (from strip-child-site-feature) ──
function matchBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return i + 1; }
  }
  return -1;
}
function removeKeyedEntry(src, key) {
  const m = new RegExp(`\\n( *)${key}: \\{`).exec(src);
  if (!m) return src;
  const open = src.indexOf('{', m.index);
  let end = matchBrace(src, open);
  if (end < 0) return src;
  if (src[end] === ',') end++;
  return src.slice(0, m.index) + src.slice(end);
}

// ── 1. re-point manifest flagKey member → anchor ──
for (const [m, a] of Object.entries(memberToAnchor)) {
  for (const fn of ['feature.manifest.ts', 'manifest.ts']) {
    const p = join(R, 'libs/features', m, fn);
    if (existsSync(p)) {
      let s = readFileSync(p, 'utf8');
      const next = s.replace(`flagKey: '${m}'`, `flagKey: '${a}'`);
      if (next !== s) { writeFileSync(p, next); console.log(`manifest ${m} flagKey → ${a}`); }
    }
  }
}

// ── 2. re-point isFlagOn readers (src/index.ts + every member module dir) ──
function repoint(path) {
  if (!existsSync(path)) return 0;
  let s = readFileSync(path, 'utf8'); let n = 0;
  for (const [m, a] of Object.entries(memberToAnchor)) {
    const re = new RegExp(`(isFlagOn\\([^,]+,\\s*)'${m}'`, 'g');
    s = s.replace(re, (_, p1) => { n++; return `${p1}'${a}'`; });
  }
  if (n) writeFileSync(path, s);
  return n;
}
let readers = repoint(join(R, 'src/index.ts'));
for (const m of Object.keys(memberToAnchor)) {
  const dir = join(R, 'libs/features', m);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.ts')) readers += repoint(join(dir, f));
}
console.log(`re-pointed ${readers} isFlagOn readers`);

// ── 3. remove member entries from registry.ts + docs.ts ──
for (const file of ['src/modules/feature_flags/registry.ts', 'src/modules/feature_flags/docs.ts']) {
  const p = join(R, file);
  let s = readFileSync(p, 'utf8');
  for (const m of Object.keys(memberToAnchor)) s = removeKeyedEntry(s, m);
  writeFileSync(p, s);
}
console.log('removed 13 member entries from registry.ts + docs.ts');
