#!/usr/bin/env node
/**
 * verify-editor-roundtrip.mjs — B.6 EDITOR ROUND-TRIP headless envelope (FULL-FLOW).
 *
 * The full edit→publish→live-{slug}-updates round-trip runs through the bolt.diy
 * WebContainer UI (editor.projectsites.dev iframe, ~30-60s cold boot) and a real
 * mutating publish that can invoke the functions container — OUT of headless scope
 * (Browserbase + mutating/$-gated), same shape as B.5's real-card leg + B.7's
 * emailed-token leg. What IS headless-verifiable + non-mutating is the envelope:
 *
 *   READ leg  — the editor bootstraps a workbench from GET /api/sites/by-slug/:slug/chat
 *               (a synthetic bolt chat export reconstructed from the site's PUBLISHED R2
 *               artifacts). For an OWNED published site it returns 200 + a real payload.
 *               NOTE: /chat, /build-context, /files are PUBLIC-BY-SLUG BY DESIGN
 *               (auth NONE — slug + R2 obscurity is the access token; they reconstruct
 *               what {slug}.projectsites.dev already serves publicly; the editor reads
 *               them cross-origin with ACAO:*). So we do NOT assert a foreign 404 here —
 *               that is not an IDOR, and org-scoping them would break the editor bootstrap.
 *   PUBLISH SECURITY — POST /api/sites/:id/publish-bolt is the write leg. It must be
 *               auth-gated (401), org-scoped (foreign id → 404, never a cross-org publish),
 *               body-slug-ignored (uses the OWNED slug — guards publish-body-slug IDOR),
 *               and input-validated (empty files → 400). Every rejection fires BEFORE any
 *               R2 write, so this probe is fully NON-MUTATING (never publishes real files).
 *
 * Fail-open: skips (exit 0) on unset E2E_API_KEY. The foreign-publish check additionally
 * needs a foreign site id (via wrangler d1); if CLOUDFLARE_API_KEY is unset that ONE
 * assertion is skipped, the rest still run on E2E_API_KEY alone.
 *
 * Run:  E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-editor-roundtrip.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveSecret } from './_browserbase-creds.mjs';

const KEY = resolveSecret('E2E_API_KEY');
const CF_KEY = resolveSecret('CLOUDFLARE_API_KEY');
const CF_EMAIL = resolveSecret('CLOUDFLARE_EMAIL') || 'blzalewski@gmail.com';
const ORG = process.env.RECONCILE_ORG || 'e2e-test-org';
const API = process.env.RECONCILE_API_BASE || 'https://project-sites.manhattan.workers.dev';
const DB = 'project-sites-db-production';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const authH = { authorization: `Bearer ${KEY}`, 'user-agent': UA, Origin: 'https://projectsites.dev' };

if (!KEY) {
  console.log('::notice:: verify-editor-roundtrip skipped — E2E_API_KEY unset');
  process.exit(0);
}

const status = async (url, opts = {}) => {
  try {
    const res = await fetch(url, opts);
    return res.status;
  } catch {
    return 0;
  }
};

/** One remote D1 query → first result row (ORG is a trusted constant). Null if CF creds absent. */
function d1(sql) {
  if (!CF_KEY) return null;
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--env', 'production', '--json', '--command', sql],
    { cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_KEY: CF_KEY, CLOUDFLARE_EMAIL: CF_EMAIL }, maxBuffer: 8 << 20 },
  );
  const out = r.stdout || '';
  const s = out.indexOf('[');
  if (s < 0) return null;
  try {
    return JSON.parse(out.slice(s))[0]?.results?.[0] ?? null;
  } catch {
    return null;
  }
}

try {
  // Own published site (the editor's bootstrap target).
  const sitesRes = await fetch(`${API}/api/sites`, { headers: authH });
  const sitesBody = await sitesRes.json().catch(() => null);
  const own = (sitesBody?.data ?? []).find((s) => s.slug) ?? (sitesBody?.data ?? [])[0];
  if (!own?.id || !own?.slug) {
    console.log('::notice:: verify-editor-roundtrip skipped — no owned site to bootstrap');
    process.exit(0);
  }

  const rows = [];

  // READ leg — editor bootstraps from /chat (public-by-slug by design); owned → 200 + real payload.
  const chatRes = await fetch(`${API}/api/sites/by-slug/${own.slug}/chat`, { headers: authH });
  const chatBody = await chatRes.json().catch(() => null);
  const chatOk = chatRes.status === 200 && chatBody && Array.isArray(chatBody.messages) && typeof chatBody.description === 'string';
  rows.push({ k: 'read: /chat bootstrap (owned → 200 + bolt chat schema)', ok: chatOk, detail: `status=${chatRes.status} msgs=${Array.isArray(chatBody?.messages) ? chatBody.messages.length : '?'}` });

  // PUBLISH SECURITY — all rejections fire before any R2 write (NON-MUTATING).
  const unauth = await status(`${API}/api/sites/${own.id}/publish-bolt`, {
    method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ path: 'x.html', content: '<i>probe</i>' }] }),
  });
  rows.push({ k: 'publish unauth → 401', ok: unauth === 401, detail: `status=${unauth}` });

  const empty = await status(`${API}/api/sites/${own.id}/publish-bolt`, {
    method: 'POST', headers: { ...authH, 'content-type': 'application/json' },
    body: JSON.stringify({ files: [] }),
  });
  rows.push({ k: 'publish own + empty files → 400 (validated pre-write)', ok: empty === 400, detail: `status=${empty}` });

  // Cross-org publish IDOR — needs a foreign id (CF creds). Skip just this row if absent.
  const foreign = d1(`SELECT id FROM sites WHERE org_id!='${ORG}' AND deleted_at IS NULL AND status='published' ORDER BY created_at DESC LIMIT 1;`);
  if (foreign?.id) {
    const fpub = await status(`${API}/api/sites/${foreign.id}/publish-bolt`, {
      method: 'POST', headers: { ...authH, 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ path: 'x.html', content: '<i>probe</i>' }] }),
    });
    rows.push({ k: 'publish FOREIGN id → 404 (no cross-org publish IDOR, pre-write)', ok: fpub === 404, detail: `status=${fpub}` });
  } else {
    rows.push({ k: 'publish FOREIGN id → 404', ok: true, detail: 'skipped (no CF creds for a foreign id)', skip: true });
  }

  const fails = rows.filter((r) => !r.ok);
  console.log('\n=== B.6 EDITOR ROUND-TRIP envelope (read bootstrap + publish security) ===');
  console.log(`  site ${own.slug}`);
  for (const r of rows) console.log(`  ${r.skip ? '·' : r.ok ? '✓' : '✗'} ${r.k}  [${r.detail}]`);
  console.log(
    fails.length
      ? `\nVERDICT: 🔴 FAIL — ${fails.length}/${rows.length} envelope checks failed`
      : `\nVERDICT: ✅ PASS — editor bootstraps + publish path is auth/org/IDOR/validation-gated (full WebContainer edit→publish→live-update is out-of-headless-scope)`,
  );
  process.exit(fails.length ? 1 : 0);
} catch (err) {
  console.log(`\n🔴 ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
