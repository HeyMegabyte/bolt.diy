/**
 * Features service module — the live surface only.
 *
 * Originally a 50-export "ALL-STAR" grab-bag; the 46 exports backing trimmed
 * feature flags were knip-dead (zero-runtime-impact, tree-shaken) and were
 * removed 2026-06-09. What remains is the genuinely-wired set: the token-cost
 * meter (`recordTokenEvent` / `getMonthlyBurn` + the model-rate helpers)
 * and `getPwaManifest`. Routes call these from `routes/features.ts`.
 * D1 writes are real.
 */

import type { Env } from '../types/env.js';

// ───────────── Shared helpers ─────────────

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ───────────── A1 — Items 1-4 ─────────────

const MODEL_RATES = {
  'claude-opus-4-7': { input: 15, output: 75, free: false, label: 'Claude Opus 4.7' },
  'claude-sonnet-4-6': { input: 3, output: 15, free: false, label: 'Claude Sonnet 4.6' },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': {
    input: 0,
    output: 0,
    free: true,
    label: 'Workers AI Llama 3.3 70B',
  },
  'gpt-5': { input: 10, output: 30, free: false, label: 'GPT-5' },
} as const;
export type ModelId = keyof typeof MODEL_RATES;

export function listModels() {
  return Object.entries(MODEL_RATES).map(([id, m]) => ({ id, ...m }));
}

export function estimatePromptCost(model: ModelId, inputTokens: number, outputTokens: number) {
  const r = MODEL_RATES[model] ?? MODEL_RATES['claude-sonnet-4-6'];
  const usd = (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
  return { usd: Number(usd.toFixed(6)), free: r.free, model };
}

export function pickModel(
  shape: 'simple' | 'complex' | 'creative' | 'free',
  userPref?: ModelId,
): ModelId {
  if (userPref && userPref in MODEL_RATES) return userPref;
  return shape === 'free'
    ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    : shape === 'complex'
      ? 'claude-opus-4-7'
      : shape === 'creative'
        ? 'claude-sonnet-4-6'
        : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
}

// ───────────── A2 — Items 5-8 ─────────────

export async function recordTokenEvent(
  env: Env,
  params: { orgId: string; model: ModelId; inputTokens: number; outputTokens: number },
) {
  const cost = estimatePromptCost(params.model, params.inputTokens, params.outputTokens);
  const cents = Math.round(cost.usd * 100);
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO token_events (id, org_id, model, input_tokens, output_tokens, usd_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, params.orgId, params.model, params.inputTokens, params.outputTokens, cents, nowIso())
    .run()
    .catch(() => {});
  return { id, ...cost, cents };
}

export async function getMonthlyBurn(env: Env, orgId: string) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const rows = await env.DB.prepare(
    'SELECT model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(usd_cents) AS usd_cents FROM token_events WHERE org_id = ? AND created_at >= ? GROUP BY model',
  )
    .bind(orgId, monthStart.toISOString())
    .all<{ model: string; input_tokens: number; output_tokens: number; usd_cents: number }>()
    .catch(() => ({ results: [] }));
  const byModel: Record<string, { tokens: number; usd: number }> = {};
  let totalCents = 0;
  let totalTokens = 0;
  for (const r of rows.results || []) {
    const tokens = (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
    byModel[r.model] = { tokens, usd: (r.usd_cents ?? 0) / 100 };
    totalCents += r.usd_cents ?? 0;
    totalTokens += tokens;
  }
  const daysIn = (Date.now() - monthStart.getTime()) / 86_400_000;
  const daysOf = 30;
  const projectedCents = daysIn > 0 ? Math.round((totalCents / daysIn) * daysOf) : 0;
  return {
    period_start: monthStart.toISOString(),
    used_usd: totalCents / 100,
    used_tokens: totalTokens,
    projected_monthly_usd: projectedCents / 100,
    by_model: byModel,
    thresholds: [
      { pct: 80, alert: 'warning' },
      { pct: 100, alert: 'critical' },
    ],
  };
}

export function getPwaManifest(_env: Env, orgId: string) {
  return {
    name: 'Project Sites',
    short_name: 'PS',
    start_url: '/admin',
    display: 'standalone',
    theme_color: '#060610',
    background_color: '#060610',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      {
        src: '/screenshots/wide-dashboard.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'wide',
        label: 'Admin dashboard',
      },
      {
        src: '/screenshots/wide-editor.png',
        sizes: '1280x720',
        type: 'image/png',
        form_factor: 'wide',
        label: 'AI editor',
      },
      {
        src: '/screenshots/narrow-mobile.png',
        sizes: '390x844',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'Mobile admin',
      },
    ],
    shortcuts: [
      {
        name: 'New site',
        short_name: 'New',
        url: '/admin/new',
        description: 'Generate a new site from a prompt',
      },
      { name: 'Billing', url: '/admin/billing', description: 'View usage + invoices' },
      { name: 'Dashboard', url: '/admin/dashboard', description: 'Site list' },
    ],
    share_target: {
      action: '/admin/share-import',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'image', accept: ['image/*'] }],
      },
    },
    file_handlers: [
      {
        action: '/admin/import',
        accept: { 'application/json': ['.json'], 'text/markdown': ['.md'] },
      },
    ],
    protocol_handlers: [{ protocol: 'web+projectsites', url: '/admin/handle?uri=%s' }],
  };
}
