#!/usr/bin/env node
/**
 * check-ai-gateway.mjs — AI-Gateway bypass detector (P0 #19 margin-leak).
 *
 * Every OpenAI/Anthropic model call MUST route through Cloudflare AI Gateway
 * (`gatewayFetch` / `aiGatewayUrl` in `src/services/ai_gateway.ts`) so we get
 * response caching, per-call observability, and the gateway margin. A direct
 * `fetch('https://api.openai.com/…')` / `api.anthropic.com` bypasses all three
 * — that is the margin leak. This gate enumerates every bypass so the arc can
 * drive the count to zero (~3 call sites routed per loop fire), then flip to
 * blocking to prevent regressions.
 *
 * Heuristic (per validator-precision-discipline — prefers false-negatives):
 *   FLAG any line containing a string-literal `https://api.openai.com` or
 *   `https://api.anthropic.com` inside `src/`, EXCEPT:
 *     - the gateway helper itself (`src/services/ai_gateway.ts` — owns the
 *       DIRECT_BASE_URLS fallback), and `external_llm.ts` gateway plumbing,
 *     - test files (`__tests__`, `*.test.ts`),
 *     - pure comment lines (`*` / `//` / JSDoc) and doc strings.
 *
 * Exit 0 always (report-only / audit-arc "Surface" step). Pass `--ci` to exit 1
 * once the surface is stable at zero (regression gate).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;
const CI = process.argv.includes('--ci');

// The gateway helper + its plumbing legitimately reference the direct vendor URLs.
const EXEMPT_FILES = new Set(['ai_gateway.ts']);
const DIRECT_RE = /https:\/\/api\.(openai|anthropic)\.com/;

/** Recursively collect .ts files under src/, skipping tests + d.ts. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...walk(p));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const findings = [];
for (const file of walk(ROOT)) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  if (EXEMPT_FILES.has(base)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!DIRECT_RE.test(line)) return;
    const trimmed = line.trim();
    // Skip pure comment / JSDoc lines — only real fetch call sites count.
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    // Only flag lines that look like an actual fetch/URL use (not a type/comment).
    if (!/fetch\(|['"`]https:\/\/api\.(openai|anthropic)\.com/.test(line)) return;
    findings.push(`${file.replace(ROOT, 'src')}:${i + 1}  ${trimmed.slice(0, 100)}`);
  });
}

if (findings.length === 0) {
  console.log('✓ AI-Gateway: no direct OpenAI/Anthropic fetch bypasses found.');
  process.exit(0);
}

console.log(`AI-Gateway bypass detector — ${findings.length} direct vendor fetch(es) NOT routed through gatewayFetch:`);
for (const f of findings) console.log(`  ${f}`);
console.log('\nFix: route each through `gatewayFetch(env, "openai"|"anthropic", pathSuffix, init)`');
console.log('(src/services/ai_gateway.ts) — it caches, observes, and falls back to direct on a gateway 5xx.');
process.exit(CI ? 1 : 0);
