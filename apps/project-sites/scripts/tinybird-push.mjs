#!/usr/bin/env node
/**
 * tinybird-push — CLI-free deploy of the in-repo Tinybird datafiles
 * (tinybird/datasources/*.datasource + tinybird/pipes/*.pipe) via the classic
 * Datafiles REST API (`POST /v0/datasources|pipes`). Node-only; uses the worker
 * token chain (TINYBIRD_TOKEN → TINYBIRD_PASSWORD → TINYBIRD_MCP_TOKEN),
 * mirroring services/tinybird.ts resolveTinybird.
 *
 * ⚠️ WORKSPACE TYPE MATTERS. The projectsites prod workspace is **Tinybird
 * Forward**, where the classic create API is DISABLED — it returns 403
 * "Adding or modifying pipes ... can only be done via deployments." On a Forward
 * workspace this script cannot create artifacts; deploy via the Forward `tb` CLI
 * (`tb deploy`) or the `/v1/deployments` REST flow instead (admin token =
 * TINYBIRD_MCP_TOKEN). The script DETECTS this and prints the right guidance
 * rather than a bare 403. It still works on CLASSIC workspaces.
 *
 * Idempotent: a 409 (already exists) is treated as success. Datasources push
 * first (pipes reference them). Pipes are reversible (DELETE /v0/pipes/{name}).
 *
 * Usage:  node scripts/tinybird-push.mjs            # push all
 *         node scripts/tinybird-push.mjs --dry-run  # print the plan only
 *
 * The pure builders (resolveConfig, datafileEndpoint, classifyResponse) are
 * exported + unit-tested in scripts/__tests__/tinybird-push.test.mjs.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tinybird');

/** Resolve `{ host, token }` from env, or `null` when unconfigured. */
export function resolveConfig(env) {
  const host = (env.TINYBIRD_API_HOST || '').trim().replace(/\/+$/, '');
  const token = (env.TINYBIRD_TOKEN || env.TINYBIRD_PASSWORD || env.TINYBIRD_MCP_TOKEN || '').trim();
  if (!host || !token) return null;
  return { host, token };
}

/** Map a datafile path to its create endpoint (datasource vs pipe). */
export function datafileEndpoint(host, file) {
  const kind = file.endsWith('.datasource') ? 'datasources' : 'pipes';
  return `${host}/v0/${kind}`;
}

/**
 * Classify a create response. 2xx → created; 409 → exists (idempotent success);
 * a 403 whose body names the Forward "via deployments" restriction →
 * `forward-deploy-required` (the classic API is disabled on this workspace);
 * anything else → failed.
 */
export function classifyResponse(status, bodyText = '') {
  if (status >= 200 && status < 300) return 'created';
  if (status === 409) return 'exists';
  if (status === 403 && /can only be done via deployments|via deployments/i.test(bodyText)) {
    return 'forward-deploy-required';
  }
  return 'failed';
}

async function pushFile(cfg, file, body, doFetch) {
  const res = await doFetch(datafileEndpoint(cfg.host, file), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'text/plain' },
    body,
  });
  // Read the body once; 403 Forward detection + failure detail both need it.
  const text = res.status >= 300 ? await res.text().catch(() => '') : '';
  const verdict = classifyResponse(res.status, text);
  const detail = verdict === 'failed' || verdict === 'forward-deploy-required' ? text.slice(0, 300) : '';
  return { file, status: res.status, verdict, detail };
}

/** Push the datasource(s) then the pipes. Returns per-file results. */
export async function pushAll(cfg, deps = {}) {
  const doFetch = deps.fetchImpl ?? fetch;
  const read = deps.readFileImpl ?? ((p) => readFile(p, 'utf8'));
  const list = deps.listImpl ?? (async () => {
    const ds = (await readdir(join(ROOT, 'datasources'))).filter((f) => f.endsWith('.datasource')).map((f) => join('datasources', f));
    const pipes = (await readdir(join(ROOT, 'pipes'))).filter((f) => f.endsWith('.pipe')).map((f) => join('pipes', f));
    return [...ds, ...pipes]; // datasources first
  });

  const files = await list();
  const results = [];
  for (const rel of files) {
    const body = await read(join(ROOT, rel));
    results.push(await pushFile(cfg, rel, body, doFetch));
  }
  return results;
}

// ── CLI entry (skipped under test import) ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('tinybird-push.mjs')) {
  const cfg = resolveConfig(process.env);
  if (!cfg) {
    console.error('tinybird-push: TINYBIRD_API_HOST + a token are required.');
    process.exit(2);
  }
  if (process.argv.includes('--dry-run')) {
    console.warn(`Would push to ${cfg.host} (datasources first, then pipes).`);
    process.exit(0);
  }
  const results = await pushAll(cfg);
  for (const r of results) {
    console.warn(`${r.verdict.padEnd(24)} ${r.file} (${r.status})${r.detail ? ` — ${r.detail}` : ''}`);
  }
  // Forward workspace: the classic create API is disabled — guide to `tb deploy`.
  if (results.some((r) => r.verdict === 'forward-deploy-required')) {
    console.error(
      '\nThis is a Tinybird FORWARD workspace — the classic Datafiles API is disabled.\n' +
        'Deploy the datafiles via the Forward CLI instead:\n' +
        '  1. Install the Forward CLI (see docs.tinybird.co)\n' +
        '  2. tb login   (admin token = get-secret TINYBIRD_MCP_TOKEN)\n' +
        '  3. From a project containing tinybird/datasources + tinybird/pipes:  tb --cloud deploy\n' +
        'Or POST to the /v1/deployments REST flow. This classic pusher only works on classic workspaces.',
    );
    process.exit(3);
  }
  const failed = results.filter((r) => r.verdict === 'failed');
  if (failed.length) {
    console.error(`\n${failed.length} datafile(s) failed.`);
    process.exit(1);
  }
  console.warn(`\n✓ ${results.length} datafile(s) pushed (created or already-exist).`);
}
