#!/usr/bin/env node
/**
 * media-mcp-probe.mjs — TECHNICAL LIVE verification (P0.55) of the two media/MCP
 * response-shape contracts the FE fixes target. NON-MUTATING + no paid credits:
 *
 *  1. POST /api/media/stock/search → 200 + a `candidates` array key (the worker
 *     returns `{ ok, candidates }`; the FE now reads `r.candidates`, not `r.data`).
 *     Stock search hits free-tier image APIs — no generation credits spent, no writes.
 *  2. GET /api/mcp/connections → 200 + a `data` key (the worker returns `{ data }`;
 *     env-vars-attachment now reads `res.data`, not `res.connections`). Read-only.
 *
 * We assert the KEY is present (shape), not the content — an empty candidates/data
 * array still proves the FE reads the right key. Generation (image/video/podcast)
 * + paste-key/send-to-bolt are NOT probed live (credits / writes) — Karma covers them.
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 * Exits 0 (skip) if any is unset.
 */
import { chromium } from '@playwright/test';

const BB = process.env.BROWSERBASE_API_KEY;
const PROJ = process.env.BROWSERBASE_PROJECT_ID;
const PW = process.env.E2E_TEST_PASSWORD;
if (!BB || !PROJ || !PW) {
  console.log('::notice:: media-mcp-probe skipped — creds unset');
  process.exit(0);
}

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST', headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 600 }),
});
if (!r.ok) { console.log('session create failed', r.status); process.exit(3); }
const { id } = await r.json();
const browser = await chromium.connectOverCDP(`wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`);
let exitCode = 0;
try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);

  const login = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }) });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, token: j?.data?.token ?? null };
  }, PW);
  if (!login.token) { console.log(JSON.stringify({ ok: false, stage: 'login', login })); process.exit(4); }
  const token = login.token;

  const call = (method, path, body) => page.evaluate(async ({ path, method, body, token }) => {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, keys: j && typeof j === 'object' ? Object.keys(j) : [] };
  }, { path, method, body, token });

  const stock = await call('POST', '/api/media/stock/search', { query: 'mountain landscape', sources: ['unsplash', 'pexels'], perPage: 3 });
  const conns = await call('GET', '/api/mcp/connections', null);

  const report = {
    ok: stock.status === 200 && stock.keys.includes('candidates') && conns.status === 200 && conns.keys.includes('data'),
    stockSearch: { status: stock.status, keys: stock.keys, hasCandidates: stock.keys.includes('candidates') },
    mcpConnections: { status: conns.status, keys: conns.keys, hasData: conns.keys.includes('data') },
  };
  console.log(JSON.stringify(report, null, 2));
  exitCode = report.ok ? 0 : 5;
} finally {
  await browser.close();
}
process.exit(exitCode);
