#!/usr/bin/env node
/**
 * check-body-slug-write-idor.mjs — BODY-KEYED write-IDOR detector.
 *
 * Complements `check-idor-handlers.mjs`, which is PATH-PARAM granular: it only
 * inspects mutation handlers whose attacker-controlled resource id is a `:slug`/
 * `:siteId` PATH param feeding a *D1* write. That detector is BLIND to the class
 * where the write TARGET is a slug/id taken from the request BODY and the write
 * lands in *R2* (site files + `_manifest.json`) — exactly the two cross-org
 * site-takeover IDORs fixed in convergence iter-159 (commit c9079d22):
 *
 *   - `POST /api/publish/bolt` (reachable UNAUTHENTICATED) set `slug = existingSlug`
 *     (from the body) then `SITES_BUCKET.put(`sites/${slug}/…`)` + rewrote the
 *     `_manifest.json` current_version — with NO ownership check. Any caller could
 *     overwrite another org's LIVE site with arbitrary HTML/JS.
 *   - `POST /api/sites/:id/publish-bolt` verified `:id` ownership but wrote to a
 *     body-supplied `providedSlug || site.slug` (verify-X, write-to-Y).
 *
 * A handler is FLAGGED when it:
 *   (a) writes site files to R2 under a slug-keyed path — `SITES_BUCKET.put(`sites/${VAR}/…`)`, AND
 *   (b) derives that slug from the request BODY — an `existingSlug` / `providedSlug`
 *       binding, or a `slug` destructured from `body` / read via `body.slug`, AND
 *   (c) has NO ownership gate in its body (none of the OWNERSHIP idioms below).
 *
 * Per validator-precision-discipline this prefers FALSE-NEGATIVES: any ownership
 * idiom clears the handler. A handler that writes only to the verified-owned
 * `site.slug` (no body slug feeding the R2 path) never trips (b). A PATH-param
 * slug (`c.req.param('slug')`) is NOT body-derived → correctly ignored (that's the
 * intentional-public build-context/chat/research surface).
 *
 * KNOWN GAP: the "verify-X, write-to-Y" variant (an ownership check on `:id` but a
 * write keyed by a DIFFERENT body slug) is CLEARED by (c) — detecting "the checked
 * key ≠ the written key" needs data-flow, not regex. The `:id` fix removed the body
 * slug entirely, so the current tree is clean; this detector guards the higher-value
 * NO-ownership class (the unauthenticated, exploitable-by-anyone instance).
 *
 * Exit 0 by default (report). Pass `--ci` to exit 1 on any finding.
 * Usage: node scripts/check-body-slug-write-idor.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

/** (a) A site-file write to R2 keyed by a `${VAR}` slug — the takeover write target. */
const R2_SITE_WRITE = /SITES_BUCKET\.put\(\s*`sites\/\$\{[A-Za-z_$][\w$]*\}/;

/**
 * (b) The R2 write's slug is BODY-derived. These idioms only appear when a slug/id
 * comes off the request body (a path-param slug uses `c.req.param('slug')`, which
 * this deliberately does NOT match).
 */
const BODY_SLUG = [
  /\bexistingSlug\b/,
  /\bprovidedSlug\b/,
  /\bbody\.slug\b/,
  // `slug` (optionally aliased) destructured out of a `= body` / `body as {…}` block.
  /\bslug\s*:\s*[A-Za-z_$][\w$]*\s*[,}]/,
];

/**
 * (c) Ownership idioms — mirrors check-idor-handlers' set. A handler is org-safe if
 * its body matches ANY of these. Keep in sync as new shared helpers land.
 */
const OWNERSHIP = [
  /\b(?:requireOwnedSite|loadSiteAndAuth|assertSiteOwned|assertSiteOwnership|ownsSiteData|ownsSite|siteOwned|loadOwnedSite|requireSiteMembership)\b/,
  /\bisSuperAdmin\b/,
  /\brequireSuperAdmin\b/,
  /org_id\s*!==\s*/,
  /!==\s*orgId\b/,
  /org_id\s*===\s*/,
  /===\s*orgId\b/,
  /org_id\s*!=\s*/,
  // an ownership SELECT that binds BOTH slug/id AND org_id (the guard for this class).
  /WHERE\s+slug\s*=\s*\?\s+AND\s+org_id/i,
  /WHERE\s+[a-z_.]*org_id/i,
  /AND\s+[a-z_.]*org_id/i,
];

/** Intentionally-public write endpoints (no ownership BY DESIGN). Keep minimal + audited. */
const PUBLIC_PATHS = [/^\/api\/contact-form\//, /^\/api\/public-data\//, /^\/api\/container-upload\//];

/**
 * Classify a single mutation-handler body. Pure — no I/O — so it's unit-testable.
 * @param {string} routePath - the registered route path (for the public allowlist).
 * @param {string} body - the handler's source text.
 * @returns {{ flagged: boolean }}
 */
export function scanHandler(routePath, body) {
  if (PUBLIC_PATHS.some((rx) => rx.test(routePath))) return { flagged: false };
  if (!R2_SITE_WRITE.test(body)) return { flagged: false }; // (a) no slug-keyed R2 site write
  if (!BODY_SLUG.some((rx) => rx.test(body))) return { flagged: false }; // (b) slug not body-derived
  if (OWNERSHIP.some((rx) => rx.test(body))) return { flagged: false }; // (c) has an ownership gate
  return { flagged: true };
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts') && !ent.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

function run() {
  const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
  const SCAN_DIRS = [join(APP_DIR, 'src', 'routes'), join(APP_DIR, 'libs')];
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(APP_DIR, file);
      // Handler boundaries: `<router>.<method>('/path', …)` for mutating methods.
      const re = /\b[a-zA-Z][\w$]*\.(post|put|patch)\(\s*['"`]([^'"`]+)['"`]/g;
      const starts = [];
      let m;
      while ((m = re.exec(text)) !== null) {
        // Only real route registrations — their path starts with `/`. This excludes
        // R2/KV writes (`SITES_BUCKET.put(`sites/…`)`) whose key would otherwise
        // parse as a fake handler declaration.
        if (!m[2].startsWith('/')) continue;
        starts.push({ idx: m.index, method: m[1], path: m[2] });
      }
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const end = i + 1 < starts.length ? starts[i + 1].idx : text.length;
        const body = text.slice(s.idx, Math.min(end, s.idx + 8000));
        if (scanHandler(s.path, body).flagged) {
          const line = text.slice(0, s.idx).split('\n').length;
          findings.push({ file: rel, line, method: s.method.toUpperCase(), path: s.path });
        }
      }
    }
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ total: findings.length, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    console.log(
      '✅ check-body-slug-write-idor: clean — every slug-keyed R2 site-write derived from the request body carries an ownership gate.',
    );
  } else {
    console.log(
      `🔒 check-body-slug-write-idor: ${findings.length} handler(s) write site files to R2 under a BODY-supplied slug with NO ownership gate (cross-org takeover):`,
    );
    for (const f of findings) console.log(`   ${f.method.padEnd(5)} ${f.path}  (${f.file}:${f.line})`);
    console.log(
      "   Fix: if the body slug names an EXISTING site row, require the caller's org to own it (404 non-leak); or write only to a verified-owned site.slug.",
    );
  }
  process.exit(process.argv.includes('--ci') && findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
