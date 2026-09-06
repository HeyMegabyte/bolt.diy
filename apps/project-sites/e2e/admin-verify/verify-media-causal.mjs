#!/usr/bin/env node
/**
 * verify-media-causal.mjs — CAUSAL test for the Media Library mutation flow
 * (upload → read-back → raw-fetch → soft-delete → confirm-gone) on the real e2e-test-org.
 *
 * WHY: `reconcile-surfaces.mjs` proves the media DISPLAY matches the store (count), but is
 * BLIND to a broken WRITE. Media upload is a TWO-store write (D1 row + R2 object) — a
 * lying-success where the 201 lands the D1 row but the R2 put silently failed would show
 * the asset in the library yet 404/empty its bytes (a broken thumbnail on every surface).
 * This uploads a real 1×1 PNG and asserts (a) it persists in the list (D1), (b) its bytes
 * are actually fetchable via /:id/raw (R2 — the stronger persist check a count-reconcile
 * can't make), (c) the soft-delete actually removes it (no dangling asset). Complements
 * env-vars + api-tokens (same self-cleaning create→delete shape); media had READ
 * reconciliation (AL-039) but no WRITE probe.
 *
 * Pure-API with E2E_API_KEY + `Origin` (omitting Origin trips Bot Fight). Multipart upload
 * via the native FormData/File (Node 22) — DO NOT set Content-Type by hand (fetch sets the
 * multipart boundary). Org-scoped, self-cleaning (soft-deletes its probe asset + sweeps
 * stale CAUSAL_MEDIA_ leftovers). Skips (exit 0) when E2E_API_KEY is unset.
 *
 * Usage: E2E_API_KEY=$(get-secret E2E_API_KEY) node e2e/admin-verify/verify-media-causal.mjs
 */
const KEY = process.env.E2E_API_KEY;
if (!KEY) {
  console.log('::notice:: verify-media-causal skipped — E2E_API_KEY unset');
  process.exit(0);
}

const BASE = process.env.PROD_URL || 'https://projectsites.dev';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// Auth+Origin, but NOT Content-Type — fetch sets the multipart boundary for FormData bodies.
const authHeaders = { Authorization: `Bearer ${KEY}`, 'User-Agent': UA, Origin: BASE };
const api = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });
const listAssets = (d) => (Array.isArray(d) ? d : (d?.assets ?? d?.data ?? d?.items ?? []));

// Smallest valid 1×1 transparent PNG (68 bytes).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const results = [];
const record = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? '✅' : '🔴'} ${name} — ${detail}`);
};

const probeName = `CAUSAL_MEDIA_${Date.now()}.png`;
let createdId = '';

try {
  // 1) UPLOAD — multipart. A 2xx is necessary but NOT sufficient (lying-success class).
  const fd = new FormData();
  fd.append('file', new File([PNG_1x1], probeName, { type: 'image/png' }));
  const upRes = await api('/api/media/upload', { method: 'POST', body: fd });
  const upBody = await upRes.json().catch(() => ({}));
  createdId = upBody?.asset?.id ?? upBody?.data?.id ?? upBody?.id ?? '';
  record('upload asset', upRes.status >= 200 && upRes.status < 300 && !!createdId, `POST → ${upRes.status}, asset id ${createdId || 'MISSING'}`);

  // 2) READ-BACK — the uploaded asset must appear in the list (D1 persist == display).
  const listAfter = listAssets(await (await api('/api/media/assets?limit=100')).json());
  const found = listAfter.find((a) => a?.id === createdId || a?.name === probeName);
  if (found && !createdId) createdId = found.id;
  record('read-back after upload', !!found, found ? `asset "${probeName}" present (id=${createdId || 'n/a'})` : `asset "${probeName}" MISSING → lying-success (2xx, no D1 persist)`);

  // 3) RAW FETCH — the bytes must be fetchable (R2 object actually written, not just the row).
  if (createdId) {
    const rawRes = await api(`/api/media/assets/${createdId}/raw`);
    const buf = rawRes.ok ? await rawRes.arrayBuffer().catch(() => new ArrayBuffer(0)) : new ArrayBuffer(0);
    record('raw bytes fetchable (R2 persist)', rawRes.ok && buf.byteLength > 0, `GET /:id/raw → ${rawRes.status}, ${buf.byteLength} bytes`);
  } else {
    record('raw bytes fetchable (R2 persist)', false, 'no id to fetch');
  }

  // 4) SOFT-DELETE the probe asset.
  let delStatus = 0;
  if (createdId) {
    delStatus = (await api(`/api/media/assets/${createdId}`, { method: 'DELETE' })).status;
    record('delete asset', delStatus >= 200 && delStatus < 300, `DELETE → ${delStatus}`);
  } else {
    record('delete asset', false, 'no id to delete');
  }

  // 5) CONFIRM-GONE — the deleted asset must NOT reappear in the list.
  const listGone = listAssets(await (await api('/api/media/assets?limit=100')).json());
  const stillThere = listGone.some((a) => a?.id === createdId || a?.name === probeName);
  record('confirm gone after delete', !stillThere, stillThere ? 'asset STILL present → dropped delete' : 'asset removed');

  // Safety sweep: soft-delete any stale CAUSAL_MEDIA_ leftovers from an interrupted run.
  for (const a of listGone) {
    if (a?.name?.startsWith('CAUSAL_MEDIA_') && a.id) await api(`/api/media/assets/${a.id}`, { method: 'DELETE' }).catch(() => {});
  }

  const ok = results.length === 5 && results.every(Boolean);
  console.log(`\nVERDICT: ${ok ? '✅ PASS — media upload→read-back→raw→delete→gone all persisted (D1 + R2)' : '🔴 FAIL — a media mutation lied or dropped'}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  if (createdId) await api(`/api/media/assets/${createdId}`, { method: 'DELETE' }).catch(() => {});
  console.log(`🔴 verify-media-causal threw: ${String(e).slice(0, 140)}`);
  process.exit(1);
}
