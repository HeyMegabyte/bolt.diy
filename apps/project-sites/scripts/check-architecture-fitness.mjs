#!/usr/bin/env node
/**
 * check-architecture-fitness.mjs — convergence §15 architecture fitness gate.
 *
 * Scans src/ + libs/ for EXCLUDED-vendor references (§4) that must not appear in
 * new architecture, and classifies each as either a tracked, DOCUMENTED migration
 * (an ADR exists → exempt from hard-fail while the migration completes) or a hard
 * VIOLATION (a clean vendor reappearing = a regression to block).
 *
 * Maturity ladder (rules/audit-arc-maturity-ladder.md): ships in REPORT mode
 * (exit 0) so it's visible every run without blocking; `--ci`/`--strict` exits 1
 * on any NON-documented violation, which today is zero — so it locks the clean
 * exclude-list (polar/trigger.dev/postmark/clay/socket.dev/chainguard = 0) as a
 * regression guard while the Resend→SES/Listmonk migration (ADR-0019) burns down.
 *
 * Uniform-JSON output (rules/uniform-json-output.md) on stdout with --json;
 * human report on stderr. Pure exclude-list kept in lockstep with
 * src/platform/service-registry.ts EXCLUDED_VENDORS.
 *
 * Usage:
 *   node scripts/check-architecture-fitness.mjs           # report (exit 0)
 *   node scripts/check-architecture-fitness.mjs --ci      # gate (exit 1 on violation)
 *   node scripts/check-architecture-fitness.mjs --json    # machine output
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN_DIRS = ['src', 'libs'];
const SCAN_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|dist|\.wrangler|coverage|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/;
// Exclusion-DEFINITION files legitimately enumerate excluded vendors by name
// (root-cause-validator-findings: a detector must not flag its own denylist).
const ALLOWLIST = [/(^|\/)src\/platform\/service-registry\.ts$/];

/**
 * Each rule: a vendor excluded by §4, the detection pattern, and whether its
 * removal is DOCUMENTED by an ADR (→ tracked-migration bucket, not a hard fail).
 * `clay`/`polar`/`socket` use disambiguated patterns to avoid false positives on
 * common words (validator-precision-discipline: prefer false negatives).
 */
const RULES = [
  { vendor: 'resend', pattern: /\bresend\b/i, documented: 'ADR-0019' },
  { vendor: 'postmark', pattern: /\bpostmark\b/i, documented: null },
  { vendor: 'polar.sh', pattern: /polar\.sh|@polar-sh|\bpolar\/sdk\b/i, documented: null },
  { vendor: 'trigger.dev', pattern: /trigger\.dev|@trigger\.dev/i, documented: null },
  { vendor: 'clay', pattern: /\bclay\.com\b|@clay\b/i, documented: null },
  { vendor: 'socket.dev', pattern: /socket\.dev/i, documented: null },
  { vendor: 'chainguard', pattern: /chainguard/i, documented: null },
];

/**
 * Scan a single line for excluded-vendor hits.
 * @returns matched rule vendors (usually 0 or 1).
 */
export function scanLine(line) {
  // Ignore lines that are migration/exclusion DOC context (so the ADR + this
  // file's own rule table don't self-flag).
  if (/migration note|excluded|do not use|deprecated|legacy|ADR-\d/i.test(line)) return [];
  return RULES.filter((r) => r.pattern.test(line)).map((r) => r);
}

async function walk(dir, acc) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (SKIP.test(full)) continue;
    if (e.isDirectory()) await walk(full, acc);
    else if (SCAN_EXT.test(e.name)) acc.push(full);
  }
  return acc;
}

async function main() {
  const argv = process.argv.slice(2);
  const ci = argv.includes('--ci') || argv.includes('--strict');
  const asJson = argv.includes('--json');

  const files = [];
  for (const d of SCAN_DIRS) await walk(join(ROOT, d), files);

  const findings = [];
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (ALLOWLIST.some((re) => re.test(rel))) continue;
    let text;
    try {
      text = await readFile(f, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const r of scanLine(lines[i])) {
        findings.push({
          file: relative(ROOT, f),
          line: i + 1,
          vendor: r.vendor,
          documented: r.documented,
          confidence: 'HIGH',
        });
      }
    }
  }

  const tracked = findings.filter((f) => f.documented);
  const violations = findings.filter((f) => !f.documented);
  const byVendor = {};
  for (const f of findings) byVendor[f.vendor] = (byVendor[f.vendor] ?? 0) + 1;

  const ts = new Date().toISOString();
  if (asJson) {
    process.stdout.write(
      JSON.stringify({
        meta: { repo: ROOT, generated_at: ts, check: 'architecture-fitness' },
        findings,
        summary: {
          tracked_migration: tracked.length,
          violations: violations.length,
          by_vendor: byVendor,
          exit: ci && violations.length > 0 ? 1 : 0,
        },
      }) + '\n',
    );
  } else {
    process.stderr.write(`\nArchitecture fitness (§15) — exclude-list scan\n`);
    for (const [v, n] of Object.entries(byVendor).sort((a, b) => b[1] - a[1])) {
      const rule = RULES.find((r) => r.vendor === v);
      const tag = rule?.documented ? `tracked-migration (${rule.documented})` : 'VIOLATION';
      process.stderr.write(`  ${v.padEnd(14)} ${String(n).padStart(3)} refs  → ${tag}\n`);
    }
    if (violations.length === 0) {
      process.stderr.write(`  ✓ 0 hard violations (clean exclude-list locked as regression guard)\n`);
    } else {
      process.stderr.write(`  ✗ ${violations.length} hard violation(s) — an excluded vendor reappeared\n`);
      for (const f of violations.slice(0, 20)) {
        process.stderr.write(`    ${f.file}:${f.line} (${f.vendor})\n`);
      }
    }
    if (tracked.length) {
      process.stderr.write(
        `  ℹ ${tracked.length} tracked-migration refs (Resend→SES/Listmonk, ADR-0019) — not blocking until migration completes\n`,
      );
    }
  }

  if (ci && violations.length > 0) process.exit(1);
  process.exit(0);
}

// Run only when invoked directly (so a test runner can import `scanLine`).
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
