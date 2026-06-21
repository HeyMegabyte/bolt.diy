#!/usr/bin/env node
/**
 * tinybird-push — CLI-free deploy of the in-repo Tinybird datafiles
 * (tinybird/datasources/*.datasource + tinybird/pipes/*.pipe) via the Events/
 * Datafiles REST API. Exists because `tinybird-cli` (the classic `tb push`) has
 * no wheel for Python 3.14 in this environment — this script needs only Node +
 * the worker's Tinybird token chain (TINYBIRD_TOKEN → TINYBIRD_PASSWORD →
 * TINYBIRD_MCP_TOKEN), mirroring services/tinybird.ts resolveTinybird.
 *
 * Idempotent: a 409 (already exists) is treated as success. The datasource is
 * pushed first (pipes reference it). Each artifact's raw datafile is POSTed as
 * text/plain — the same payload the CLI sends. Pipes are reversible (DELETE
 * /v0/pipes/{name}), so this is a two-way door on a greenfield workspace.
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

/** Classify a create response: ok (2xx) or exists (409) → success; else fail. */
export function classifyResponse(status) {
  if (status >= 200 && status < 300) return 'created';
  if (status === 409) return 'exists';
  return 'failed';
}

async function pushFile(cfg, file, body, doFetch) {
  const res = await doFetch(datafileEndpoint(cfg.host, file), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'text/plain' },
    body,
  });
  const verdict = classifyResponse(res.status);
  let detail = '';
  if (verdict === 'failed') detail = (await res.text().catch(() => '')).slice(0, 300);
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
    console.warn(`${r.verdict.padEnd(8)} ${r.file} (${r.status})${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => r.verdict === 'failed');
  if (failed.length) {
    console.error(`\n${failed.length} datafile(s) failed.`);
    process.exit(1);
  }
  console.warn(`\n✓ ${results.length} datafile(s) pushed (created or already-exist).`);
}
