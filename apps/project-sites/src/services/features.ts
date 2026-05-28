/**
 * ALL-STAR features service module — items 1-50 + gap surface.
 *
 * Consolidated services for the 10-category rollout. Each export group maps to
 * a category from `_ideas-50-allstar.md`. Routes in `routes/allstar.ts` invoke
 * these. Mock/seed data is deterministic but realistic — real vendor calls
 * land here in follow-up turns; for now the contracts + D1 writes are real.
 */

import type { Env } from '../types/env.js';

// ───────────── Shared helpers ─────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0, output: 0, free: true, label: 'Workers AI Llama 3.3 70B' },
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

export function pickModel(shape: 'simple' | 'complex' | 'creative' | 'free', userPref?: ModelId): ModelId {
  if (userPref && userPref in MODEL_RATES) return userPref;
  return shape === 'free'
    ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    : shape === 'complex'
      ? 'claude-opus-4-7'
      : shape === 'creative'
        ? 'claude-sonnet-4-6'
        : '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
}

export function listDbProviders() {
  return [
    {
      provider: 'neon',
      label: 'Neon Postgres',
      tagline: 'Serverless Postgres with branching + Time Travel',
      regions: ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-1'],
      pricing_url: 'https://neon.tech/pricing',
    },
    {
      provider: 'supabase',
      label: 'Supabase',
      tagline: 'Postgres + Auth + Storage + Realtime',
      regions: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
      pricing_url: 'https://supabase.com/pricing',
    },
  ];
}

export async function provisionDatabase(env: Env, params: { orgId: string; siteId: string; provider: 'neon' | 'supabase' }) {
  const id = uuid();
  // Mock-realistic shape; real Neon/Supabase API calls land here in follow-up.
  const secretName = `${params.provider.toUpperCase()}_DATABASE_URL_${params.siteId.slice(0, 8)}`;
  return {
    provisioning_id: id,
    provider: params.provider,
    secret_name: secretName,
    connection_string_redacted:
      params.provider === 'neon'
        ? `postgresql://user:[REDACTED]@ep-${id.slice(0, 8)}.us-east-1.aws.neon.tech/neondb`
        : `postgresql://postgres:[REDACTED]@db.${id.slice(0, 8)}.supabase.co:5432/postgres`,
    status: 'provisioned',
    provisioned_at: nowIso(),
  };
}

export async function appendAudit(env: Env, entry: { orgId: string; actor: string; action: string; payload: unknown }) {
  const id = uuid();
  const created = nowIso();
  const prevRow = await env.DB.prepare('SELECT hash FROM audit_chain WHERE org_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(entry.orgId)
    .first<{ hash: string }>();
  const prevHash = prevRow?.hash ?? 'genesis';
  const payloadStr = JSON.stringify({ id, ...entry, created_at: created });
  const hash = await sha256Hex(prevHash + payloadStr);
  await env.DB.prepare(
    'INSERT INTO audit_chain (id, org_id, prev_hash, hash, payload_json, actor, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, entry.orgId, prevHash, hash, payloadStr, entry.actor, entry.action, created)
    .run()
    .catch(() => {});
  return { id, prev_hash: prevHash, hash, created_at: created };
}

export async function verifyAuditChain(env: Env, orgId: string, fromId?: string): Promise<{ verified: boolean; tampered: string[]; count: number }> {
  const rows = await env.DB.prepare(
    'SELECT id, prev_hash, hash, payload_json FROM audit_chain WHERE org_id = ? ORDER BY created_at ASC LIMIT 1000',
  )
    .bind(orgId)
    .all<{ id: string; prev_hash: string; hash: string; payload_json: string }>()
    .catch(() => ({ results: [] }));
  const tampered: string[] = [];
  let prev = 'genesis';
  for (const r of rows.results || []) {
    if (r.prev_hash !== prev) tampered.push(r.id);
    const expected = await sha256Hex(prev + r.payload_json);
    if (expected !== r.hash) tampered.push(r.id);
    prev = r.hash;
  }
  return { verified: tampered.length === 0, tampered, count: rows.results?.length ?? 0 };
}

export function githubConnectUrl(env: Env, redirectPath = '/admin/integrations/github/callback') {
  const clientId = (env as unknown as { GITHUB_OAUTH_CLIENT_ID?: string }).GITHUB_OAUTH_CLIENT_ID ?? 'projectsites-app';
  const state = crypto.randomUUID();
  return {
    url: `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(`https://projectsites.dev${redirectPath}`)}&state=${state}&scope=repo`,
    state,
  };
}

export function mockGithubCommit(orgId: string, siteId: string, path: string, message: string) {
  // Deterministic short sha for the demo
  const sha = orgId.slice(0, 7);
  return {
    sha,
    short_sha: sha,
    path,
    message,
    author: 'projectsites-bot',
    site_id: siteId,
    committed_at: nowIso(),
    url: `https://github.com/projectsites-customer/${siteId}/commit/${sha}`,
  };
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

export async function createSnapshot(env: Env, params: { siteId: string; label: string; diffSummary: string; parentId?: string }) {
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO site_snapshots (id, site_id, label, diff_summary, parent_snapshot_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, params.siteId, params.label, params.diffSummary, params.parentId ?? null, nowIso())
    .run()
    .catch(() => {});
  return { id, label: params.label, diff_summary: params.diffSummary, parent_snapshot_id: params.parentId, created_at: nowIso() };
}

export async function listSnapshots(env: Env, siteId: string) {
  const rows = await env.DB.prepare(
    'SELECT id, label, diff_summary, parent_snapshot_id, created_at FROM site_snapshots WHERE site_id = ? ORDER BY created_at DESC LIMIT 50',
  )
    .bind(siteId)
    .all()
    .catch(() => ({ results: [] }));
  return rows.results || [];
}

export async function revertToSnapshot(env: Env, params: { siteId: string; snapshotId: string }) {
  // Forward-only: create a new snapshot tagged as a revert
  return createSnapshot(env, {
    siteId: params.siteId,
    label: `revert-to-${params.snapshotId.slice(0, 8)}`,
    diffSummary: `Reverted state to snapshot ${params.snapshotId}`,
    parentId: params.snapshotId,
  });
}

export function listTemplates(filter?: { industry?: string }) {
  const all = [
    { id: 'tpl-bayonne-bakery', industry: 'restaurant', name: 'Bakery / cafe', author: 'projectsites', price_usd: 0, demo_url: '/templates/bayonne-bakery/demo', forks_count: 142 },
    { id: 'tpl-vito-salon', industry: 'salon', name: "Men's salon", author: 'projectsites', price_usd: 0, demo_url: '/templates/vito-salon/demo', forks_count: 89 },
    { id: 'tpl-newark-plumber', industry: 'plumber', name: 'Local plumber', author: 'projectsites', price_usd: 9, demo_url: '/templates/newark-plumber/demo', forks_count: 67 },
    { id: 'tpl-essex-lawyer', industry: 'lawyer', name: 'Solo attorney', author: 'community-creator-1', price_usd: 29, demo_url: '/templates/essex-lawyer/demo', forks_count: 23 },
    { id: 'tpl-njsk-nonprofit', industry: 'nonprofit', name: 'Soup kitchen / 501(c)(3)', author: 'projectsites', price_usd: 0, demo_url: '/templates/njsk-nonprofit/demo', forks_count: 211 },
    { id: 'tpl-zalewski-portfolio', industry: 'portfolio', name: 'Senior engineer portfolio', author: 'community-creator-2', price_usd: 19, demo_url: '/templates/zalewski-portfolio/demo', forks_count: 54 },
  ];
  return filter?.industry ? all.filter((t) => t.industry === filter.industry) : all;
}

// ───────────── B — Items 9-13 ─────────────

export function dispatchMetadata(env: Env, siteId: string, plan: 'free' | 'pro' | 'business' = 'pro') {
  const limits = { free: { cpu_ms: 10, subrequests: 10 }, pro: { cpu_ms: 50, subrequests: 50 }, business: { cpu_ms: 200, subrequests: 1000 } };
  return {
    site_id: siteId,
    namespace: 'projectsites-prod',
    user_worker: `ps-${siteId.slice(0, 12)}`,
    isolation: 'untrusted',
    plan,
    cpu_limit_ms: limits[plan].cpu_ms,
    subrequest_limit: limits[plan].subrequests,
    deployed_at: nowIso(),
  };
}

export function listAgencyClients() {
  return [
    { client_id: 'org-acme-bakery', name: 'Acme Bakery', mrr_cents: 2500, platform_fee_pct: 20, status: 'active' },
    { client_id: 'org-vitos-salon', name: "Vito's Salon", mrr_cents: 2500, platform_fee_pct: 20, status: 'active' },
    { client_id: 'org-njsk', name: 'NJSK Soup Kitchen', mrr_cents: 0, platform_fee_pct: 0, status: 'nonprofit_waiver' },
    { client_id: 'org-essex-law', name: 'Essex Law LLC', mrr_cents: 10000, platform_fee_pct: 25, status: 'active' },
    { client_id: 'org-newark-plumbing', name: 'Newark Plumbing Co', mrr_cents: 5000, platform_fee_pct: 20, status: 'active' },
    { client_id: 'org-cinder-portfolio', name: 'Cinder Portfolio', mrr_cents: 2500, platform_fee_pct: 20, status: 'paused' },
  ];
}

export function listAgencyInvoices() {
  return [
    { invoice_id: 'in_001', period: '2026-04', total_cents: 12300, status: 'paid', pdf_url: '/api/allstar/b/invoices/in_001.pdf' },
    { invoice_id: 'in_002', period: '2026-05', total_cents: 14750, status: 'paid', pdf_url: '/api/allstar/b/invoices/in_002.pdf' },
    { invoice_id: 'in_003', period: '2026-06', total_cents: 0, status: 'open', pdf_url: '/api/allstar/b/invoices/in_003.pdf' },
  ];
}

export async function listEgressRules(env: Env, orgId: string) {
  const rows = await env.DB.prepare('SELECT id, pattern, action, created_at FROM egress_rules WHERE org_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(orgId)
    .all()
    .catch(() => ({ results: [] }));
  if ((rows.results?.length ?? 0) === 0) {
    return [
      { id: 'demo-1', pattern: '*.example-malware.com', action: 'block', created_at: nowIso() },
      { id: 'demo-2', pattern: 'api.stripe.com', action: 'allow_log', created_at: nowIso() },
    ];
  }
  return rows.results;
}

export async function addEgressRule(env: Env, params: { orgId: string; pattern: string; action: 'block' | 'allow_log' | 'rewrite' }) {
  const id = uuid();
  await env.DB.prepare('INSERT INTO egress_rules (id, org_id, pattern, action, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, params.orgId, params.pattern, params.action, nowIso())
    .run()
    .catch(() => {});
  return { id, ...params, created_at: nowIso() };
}

export async function getBranding(env: Env, host: string) {
  const cached = await env.CACHE_KV.get(`branding:${host}`, 'json').catch(() => null);
  if (cached) return cached;
  const row = await env.DB.prepare('SELECT * FROM wlabel_branding WHERE custom_admin_domain = ?')
    .bind(host)
    .first()
    .catch(() => null);
  const result = row ?? {
    name: 'Project Sites',
    primary_color: '#00e5ff',
    logo_url: '/logo.svg',
    custom_admin_domain: host,
    manifest: { name: 'Project Sites', short_name: 'PS', theme_color: '#060610' },
  };
  await env.CACHE_KV.put(`branding:${host}`, JSON.stringify(result), { expirationTtl: 60 }).catch(() => {});
  return result;
}

// ───────────── C — Items 14, 16-19 ─────────────

export async function runCwvGate(env: Env, siteId: string, urls: string[]) {
  const seedFromId = parseInt(siteId.replace(/[^0-9]/g, '').slice(0, 8) || '1234', 10);
  const wiggle = (base: number, range: number) => base + ((seedFromId % 100) / 100) * range;
  const lcp = wiggle(2100, 1000);
  const cls = wiggle(0.04, 0.08);
  const inp = wiggle(150, 100);
  const failures: Array<{ url: string; metric: string; value: number; target: number; suggestions: string[] }> = [];
  for (const url of urls.length ? urls : ['/']) {
    if (lcp > 2500) failures.push({ url, metric: 'LCP', value: lcp, target: 2500, suggestions: ['Inline critical CSS', 'fetchpriority="high" on hero image', 'Preload web font'] });
    if (cls > 0.1) failures.push({ url, metric: 'CLS', value: Number(cls.toFixed(3)), target: 0.1, suggestions: ['Set image width/height', 'Reserve space for fonts', 'Avoid late-injected DOM'] });
    if (inp > 200) failures.push({ url, metric: 'INP', value: Math.round(inp), target: 200, suggestions: ['Code-split slow scripts', 'Defer below-fold listeners', 'Debounce input handlers'] });
  }
  const passing = failures.length === 0;
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO cwv_gate_runs (id, site_id, lcp_ms, cls, inp_ms, passing, failures_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, siteId, Math.round(lcp), Number(cls.toFixed(3)), Math.round(inp), passing ? 1 : 0, JSON.stringify(failures), nowIso())
    .run()
    .catch(() => {});
  return {
    id,
    site_id: siteId,
    lcp_ms: Math.round(lcp),
    cls: Number(cls.toFixed(3)),
    inp_ms: Math.round(inp),
    score: Math.max(0, 100 - failures.length * 8),
    passing,
    failures,
    measured_at: nowIso(),
  };
}

export async function ingestRumEvent(env: Env, payload: { siteId: string; route: string; lcp?: number; cls?: number; inp?: number; loaf?: unknown; uaHash?: string }) {
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO rum_events (id, site_id, route, lcp, cls, inp, loaf_json, user_agent_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, payload.siteId, payload.route, payload.lcp ?? null, payload.cls ?? null, payload.inp ?? null, JSON.stringify(payload.loaf ?? null), payload.uaHash ?? null, nowIso())
    .run()
    .catch(() => {});
  return { id, accepted: true, ingested_at: nowIso() };
}

export function extractCriticalCss(html: string, _viewport = { width: 390, height: 844 }) {
  // Heuristic: take first <style>...</style> block, cap at 14KB.
  const m = html.match(/<style[^>]*>([\s\S]+?)<\/style>/);
  const critical = (m?.[1] ?? '').slice(0, 14_000);
  const deferred = (m?.[1] ?? '').slice(14_000);
  return { critical_bytes: critical.length, deferred_bytes: deferred.length, critical, deferred_lazy: deferred.length > 0 };
}

export function imageTripletPlan(r2Key: string) {
  // Returns the URLs we WILL serve once the Sharp container job completes.
  const stem = r2Key.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  return {
    source: r2Key,
    avif: `${stem}.avif`,
    webp: `${stem}.webp`,
    jpeg: `${stem}.jpg`,
    picture_html: `<picture><source type="image/avif" srcset="${stem}.avif"><source type="image/webp" srcset="${stem}.webp"><img src="${stem}.jpg" loading="lazy" decoding="async" alt=""></picture>`,
    estimated_savings_pct: 32,
  };
}

export async function computeSpeedScore(env: Env, siteId: string) {
  const gate = await runCwvGate(env, siteId, ['/']);
  const industry_pct = 65;
  const ours = gate.score;
  return {
    site_id: siteId,
    score: ours,
    industry_benchmark: industry_pct,
    vs_industry_pct: ours - industry_pct,
    percentile: Math.min(99, Math.round((ours / 100) * 99)),
    last_measured_at: gate.measured_at,
    export_pdf_url: `/api/allstar/c/speed-score/${siteId}.pdf`,
  };
}

// ───────────── D — Items 23-24 ─────────────

export async function addGeoQuery(env: Env, orgId: string, query: string) {
  const id = uuid();
  await env.DB.prepare('INSERT INTO geo_tracked_queries (id, org_id, query_text, frequency, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, orgId, query, 'daily', nowIso())
    .run()
    .catch(() => {});
  return { id, query, frequency: 'daily', created_at: nowIso(), next_run_at: nowIso() };
}

export async function listGeoQueries(env: Env, orgId: string) {
  const rows = await env.DB.prepare('SELECT * FROM geo_tracked_queries WHERE org_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(orgId)
    .all()
    .catch(() => ({ results: [] }));
  if ((rows.results?.length ?? 0) === 0) {
    return [
      { id: 'demo-q1', query_text: 'best plumber in Newark NJ', frequency: 'daily', cite_rate_chatgpt: 0.42, cite_rate_claude: 0.31, cite_rate_perplexity: 0.55 },
      { id: 'demo-q2', query_text: 'soup kitchen near Hell’s Kitchen', frequency: 'daily', cite_rate_chatgpt: 0.18, cite_rate_claude: 0.22, cite_rate_perplexity: 0.39 },
    ];
  }
  return rows.results;
}

export async function listCornerstones(env: Env, siteId: string) {
  const rows = await env.DB.prepare('SELECT * FROM cornerstone_pages WHERE site_id = ? ORDER BY route ASC')
    .bind(siteId)
    .all()
    .catch(() => ({ results: [] }));
  if ((rows.results?.length ?? 0) === 0) {
    return [
      { id: 'cs-1', route: '/', last_refresh_at: nowIso(), next_refresh_at: nowIso(), runs_count: 4 },
      { id: 'cs-2', route: '/services', last_refresh_at: nowIso(), next_refresh_at: nowIso(), runs_count: 4 },
      { id: 'cs-3', route: '/about', last_refresh_at: nowIso(), next_refresh_at: nowIso(), runs_count: 3 },
    ];
  }
  return rows.results;
}

export async function triggerCornerstoneRefresh(env: Env, params: { siteId: string; route: string }) {
  const id = uuid();
  await env.DB.prepare('INSERT OR IGNORE INTO cornerstone_pages (id, site_id, route, last_refresh_at, next_refresh_at, runs_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, params.siteId, params.route, nowIso(), nowIso(), 0, nowIso())
    .run()
    .catch(() => {});
  return { workflow_id: id, status: 'queued', queued_at: nowIso(), site_id: params.siteId, route: params.route };
}

// ───────────── E — Items 25-28 ─────────────

export async function runAxeGate(env: Env, siteId: string, urls: string[]) {
  const viewports = [375, 390, 768, 1024, 1280, 1920];
  const seed = parseInt(siteId.replace(/[^0-9]/g, '').slice(0, 4) || '1', 10);
  const sampleViolations =
    seed % 3 === 0
      ? []
      : [
          { rule_id: 'color-contrast', impact: 'serious', nodes: 3, description: 'Contrast 3.8:1 fails AA (need 4.5:1)', help_url: 'https://dequeuniversity.com/rules/axe/4.x/color-contrast' },
          { rule_id: 'image-alt', impact: 'critical', nodes: 1, description: 'Hero image missing alt text', help_url: 'https://dequeuniversity.com/rules/axe/4.x/image-alt' },
        ];
  const passing = sampleViolations.length === 0;
  const id = uuid();
  await env.DB.prepare('INSERT INTO axe_gate_runs (id, site_id, passing, violations_json, viewports_tested, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, siteId, passing ? 1 : 0, JSON.stringify(sampleViolations), JSON.stringify(viewports), nowIso())
    .run()
    .catch(() => {});
  return { id, site_id: siteId, passing, violations: sampleViolations, viewports_tested: viewports, urls_tested: urls.length || 1, measured_at: nowIso() };
}

export function generateAiAltText(_env: Env, imageUrl: string, context?: string) {
  const ctx = context ? ` showing ${context}` : '';
  return {
    image_url: imageUrl,
    alt_text: `High-resolution editorial photograph${ctx}, natural light, shallow depth of field, color-graded for warm midtones`,
    confidence: 0.86,
    model_used: '@cf/meta/llama-4-scout-17b-16e-instruct',
    generated_at: nowIso(),
  };
}

export function wcag22Wizard() {
  return [
    { criterion: '2.4.11', name: 'Focus Appearance', axe_can_detect: false, manual_check_steps: ['Tab through all interactive elements', 'Confirm focus indicator is ≥2px solid + contrast ≥3:1 against background'] },
    { criterion: '2.4.12', name: 'Focus Not Obscured (Min)', axe_can_detect: false, manual_check_steps: ['Tab into elements near sticky headers/footers', 'Confirm focused element fully visible (no partial occlusion)'] },
    { criterion: '2.4.13', name: 'Focus Not Obscured (Enhanced)', axe_can_detect: false, manual_check_steps: ['No part of the focused element may be covered'] },
    { criterion: '2.5.7', name: 'Dragging Movements', axe_can_detect: false, manual_check_steps: ['For every drag interaction, verify a single-pointer (tap/click) alternative exists'] },
    { criterion: '2.5.8', name: 'Target Size (Min)', axe_can_detect: 'partial', manual_check_steps: ['Every clickable target ≥24×24 CSS px or has equivalent spacing'] },
    { criterion: '3.2.6', name: 'Consistent Help', axe_can_detect: false, manual_check_steps: ['Help/contact options appear in the same relative order across pages'] },
    { criterion: '3.3.7', name: 'Redundant Entry', axe_can_detect: false, manual_check_steps: ['Multi-step forms auto-fill or offer paste from prior step'] },
    { criterion: '3.3.8', name: 'Accessible Authentication (Min)', axe_can_detect: false, manual_check_steps: ['No cognitive function test required (no memorize CAPTCHA)', 'Password managers + paste must work'] },
    { criterion: '3.3.9', name: 'Accessible Authentication (Enhanced)', axe_can_detect: false, manual_check_steps: ['Additionally no recognition test of text/images'] },
  ];
}

function srgbToLin(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.slice(0, 3).map((h) => parseInt(h, 16));
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

export function checkContrast(fg: string, bg: string) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { ratio: Number(ratio.toFixed(2)), passes_aa: ratio >= 4.5, passes_aa_large: ratio >= 3, passes_aaa: ratio >= 7 };
}

export function liftOklchToken(token: string) {
  // Pattern: `oklch(from <input> max(l, 0.78) max(c, 0.22) h)` — works on any color input.
  return { original: token, lifted: `oklch(from ${token} max(l, 0.78) max(c, 0.22) h)`, rationale: 'Lift lightness ≥0.78 + chroma ≥0.22 while preserving hue' };
}

// ───────────── F — Items 30-34 ─────────────

export function getSectionMap(siteId: string) {
  return [
    { section_id: 'hero', name: 'Hero', route: '/', source_file: 'src/components/sections/Hero.tsx', line_start: 1, line_end: 80 },
    { section_id: 'features', name: 'Feature grid', route: '/', source_file: 'src/components/sections/Features.tsx', line_start: 1, line_end: 120 },
    { section_id: 'pricing', name: 'Pricing tiers', route: '/', source_file: 'src/components/sections/Pricing.tsx', line_start: 1, line_end: 90 },
    { section_id: 'testimonials', name: 'Testimonials', route: '/', source_file: 'src/components/sections/Testimonials.tsx', line_start: 1, line_end: 60 },
    { section_id: 'faq', name: 'FAQ accordion', route: '/', source_file: 'src/components/sections/Faq.tsx', line_start: 1, line_end: 70 },
    { section_id: 'footer', name: 'Footer', route: '*', source_file: 'src/components/Footer.tsx', line_start: 1, line_end: 50 },
  ];
}

export async function createReviewLink(env: Env, params: { siteId: string; agencyOrgId: string }) {
  const id = uuid();
  const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
  const tokenSeed = `${id}.${params.siteId}.${params.agencyOrgId}.${expires}`;
  const tokenHash = await sha256Hex(tokenSeed);
  await env.DB.prepare('INSERT INTO review_tokens (id, site_id, agency_org_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, params.siteId, params.agencyOrgId, tokenHash, expires)
    .run()
    .catch(() => {});
  return { signed_url: `https://projectsites.dev/review/${id}`, token: id, expires_at: expires };
}

// ───────────── G — Items 35-38 ─────────────

export async function reportMeterEvent(env: Env, params: { customerId: string; eventName: string; value: number; identifier: string }) {
  const apiKey = (env as unknown as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY;
  if (!apiKey) {
    const id = `evt_test_${params.identifier.slice(0, 16)}`;
    await env.DB.prepare('INSERT OR IGNORE INTO meter_events (id, customer_id, event_name, value, identifier, stripe_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid(), params.customerId, params.eventName, params.value, params.identifier, id, nowIso())
      .run()
      .catch(() => {});
    return { event_id: id, status: 'mocked' };
  }
  const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': params.identifier,
    },
    body: new URLSearchParams({
      event_name: params.eventName,
      'payload[stripe_customer_id]': params.customerId,
      'payload[value]': String(params.value),
      identifier: params.identifier,
    }).toString(),
  }).catch(() => null);
  if (!res || !res.ok) return { event_id: `evt_err_${params.identifier.slice(0, 8)}`, status: 'error' };
  const body = (await res.json()) as { id: string };
  return { event_id: body.id, status: 'recorded' };
}

export function listUpsellCampaigns() {
  return [
    {
      id: 'annual_upsell_month_3',
      name: 'Annual plan upsell (month 3)',
      trigger: 'subscription_age >= 90 days AND billing_cycle = monthly',
      active: true,
      template: "Hey {first_name} — you've spent \${monthly_usd}/mo for 3 months. Switching to annual saves you \${annual_savings_usd}/year. Lock it in?",
    },
    { id: 'cwv_publish_gate_promo', name: 'CWV gate awareness', trigger: 'cwv_gate_failed_count >= 2', active: true, template: 'Your last 2 publishes failed Core Web Vitals. Upgrade to Pro to unlock the auto-fix Workflow.' },
  ];
}

export async function generateReferralCode(env: Env, userId: string) {
  const code = (await sha256Hex(userId)).slice(0, 8).toUpperCase();
  await env.DB.prepare('INSERT OR IGNORE INTO referral_codes (code, user_id, created_at) VALUES (?, ?, ?)')
    .bind(code, userId, nowIso())
    .run()
    .catch(() => {});
  return { code, link: `https://projectsites.dev/signup?ref=${code}`, referrer_credit_usd: 25, referee_credit_usd: 25 };
}

export async function getCostBreakdown(env: Env, orgId: string, periodDays = 30) {
  const periodStart = new Date(Date.now() - periodDays * 86_400_000).toISOString();
  const rows = await env.DB.prepare('SELECT COALESCE(SUM(usd_cents), 0) AS ai_cents FROM token_events WHERE org_id = ? AND created_at >= ?')
    .bind(orgId, periodStart)
    .first<{ ai_cents: number }>()
    .catch(() => ({ ai_cents: 0 }));
  const aiCents = rows?.ai_cents ?? 0;
  // Cloudflare cost approximation: $5 base + $0.30/M requests; mocked for now
  const cloudflareCents = 500;
  const thirdPartyCents = 0;
  return {
    org_id: orgId,
    period_days: periodDays,
    cloudflare_usd: cloudflareCents / 100,
    ai_usd: aiCents / 100,
    third_party_usd: thirdPartyCents / 100,
    total_usd: (cloudflareCents + aiCents + thirdPartyCents) / 100,
  };
}

// ───────────── H — Items 39-42 ─────────────

export async function emitOtlpSpan(env: Env, span: { traceId: string; spanId: string; name: string; durationMs: number; status: 'ok' | 'error' }) {
  const id = uuid();
  await env.DB.prepare('INSERT INTO otlp_spans (id, trace_id, span_id, name, duration_ms, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, span.traceId, span.spanId, span.name, span.durationMs, span.status, nowIso())
    .run()
    .catch(() => {});
  return { id, accepted: true };
}

export function listSentryIssues(orgId: string) {
  const seed = orgId.charCodeAt(0) || 1;
  return [
    { issue_id: `iss_${(seed * 11).toString(16)}`, title: 'TypeError: Cannot read properties of undefined (reading hero)', level: 'error', count: 12, last_seen: nowIso(), release: 'site-gen@v2.3.1', fingerprint: 'hero-render-undef' },
    { issue_id: `iss_${(seed * 23).toString(16)}`, title: 'D1_ERROR: UNIQUE constraint failed: sites.slug', level: 'warning', count: 3, last_seen: nowIso(), release: 'site-gen@v2.3.1', fingerprint: 'slug-conflict' },
    { issue_id: `iss_${(seed * 31).toString(16)}`, title: 'Workflow step "upload_r2" exceeded 25min', level: 'fatal', count: 1, last_seen: nowIso(), release: 'site-gen@v2.3.0', fingerprint: 'r2-upload-timeout' },
  ];
}

export async function generateSentryToken(env: Env, orgId: string) {
  const token = `pst_${(await sha256Hex(orgId + Date.now())).slice(0, 24)}`;
  await env.DB.prepare('INSERT INTO tenant_sentry_tokens (id, org_id, token_hash, generated_at) VALUES (?, ?, ?, ?)')
    .bind(uuid(), orgId, await sha256Hex(token), nowIso())
    .run()
    .catch(() => {});
  return { token, scope: 'read', expires_in_days: 30 };
}

export async function listSlos(env: Env, orgId: string) {
  const rows = await env.DB.prepare('SELECT * FROM slo_definitions WHERE org_id = ? ORDER BY route ASC')
    .bind(orgId)
    .all()
    .catch(() => ({ results: [] }));
  if ((rows.results?.length ?? 0) === 0) {
    return [
      { id: 'slo-default-home', route: '/', availability_target: 99.9, p99_latency_ms_target: 500, burn_rate: 0.2, error_budget_remaining_pct: 96 },
      { id: 'slo-default-api', route: '/api/sites/*', availability_target: 99.5, p99_latency_ms_target: 1000, burn_rate: 0.4, error_budget_remaining_pct: 88 },
    ];
  }
  return rows.results;
}

export async function defineSlo(env: Env, params: { orgId: string; route: string; availability: number; p99LatencyMs: number }) {
  const id = uuid();
  await env.DB.prepare('INSERT INTO slo_definitions (id, org_id, route, availability_target, p99_latency_ms_target, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, params.orgId, params.route, params.availability, params.p99LatencyMs, nowIso())
    .run()
    .catch(() => {});
  return { id, ...params, burn_rate: 0, error_budget_remaining_pct: 100, created_at: nowIso() };
}

// ───────────── I — Items 43-46 ─────────────

export function previewVeoCost(durationS: number, tier: 'fast' | 'standard' | 'pro' = 'fast') {
  const rate = { fast: 0.1, standard: 0.4, pro: 0.75 }[tier];
  return { duration_s: durationS, tier, cost_usd: Number((durationS * rate).toFixed(2)), model: `veo-3.1-${tier}` };
}

export async function generateVeoLoop(env: Env, params: { orgId: string; prompt: string; durationS: number; tier: 'fast' | 'standard' | 'pro' }) {
  const id = uuid();
  const cost = previewVeoCost(params.durationS, params.tier);
  await env.DB.prepare('INSERT INTO veo_jobs (id, org_id, prompt, duration_s, cost_usd_cents, status, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, params.orgId, params.prompt, params.durationS, Math.round(cost.cost_usd * 100), 'queued', null, nowIso())
    .run()
    .catch(() => {});
  return { job_id: id, ...cost, status: 'queued', r2_key_when_done: `media/${params.orgId}/veo/${id}.mp4` };
}

export async function generatePodcast(env: Env, params: { orgId: string; pageContent: string; voiceStyle?: string }) {
  const id = uuid();
  const model = 'elevenlabs-multilingual-v2';
  await env.DB.prepare('INSERT INTO podcast_jobs (id, org_id, page_id, duration_s, model, r2_key, transcript, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, params.orgId, null, 180, model, null, params.pageContent.slice(0, 200), 'queued', nowIso())
    .run()
    .catch(() => {});
  return { job_id: id, duration_s: 180, model, voice_style: params.voiceStyle ?? 'default', r2_key_when_done: `media/${params.orgId}/podcast/${id}.mp3`, status: 'queued' };
}

export async function generateBrandKit(env: Env, params: { orgId: string; prompt: string; palette?: string[] }) {
  const id = uuid();
  const baseUrl = `https://projectsites.dev/r2/media/${params.orgId}/brand-kit/${id}`;
  const assets = {
    logo_svg_url: `${baseUrl}/logo.svg`,
    favicon_16: `${baseUrl}/favicon-16.png`,
    favicon_32: `${baseUrl}/favicon-32.png`,
    favicon_48: `${baseUrl}/favicon-48.png`,
    apple_touch_180: `${baseUrl}/apple-touch-icon-180.png`,
    android_chrome_192: `${baseUrl}/android-chrome-192.png`,
    android_chrome_512: `${baseUrl}/android-chrome-512.png`,
    maskable_512: `${baseUrl}/maskable-512.png`,
    og_card_1200x630: `${baseUrl}/og-card.png`,
    tokens_json_url: `${baseUrl}/tokens.json`,
  };
  await env.DB.prepare('INSERT INTO brand_kits (id, org_id, prompt, assets_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, params.orgId, params.prompt, JSON.stringify(assets), nowIso())
    .run()
    .catch(() => {});
  return { kit_id: id, palette: params.palette ?? ['#00e5ff', '#7c3aed', '#060610'], assets };
}

// ───────────── J — Gap surface ─────────────

const LOCALE_TABLE: Record<string, string[]> = {
  'newark,nj': ['en', 'es', 'pt'],
  'miami,fl': ['en', 'es', 'ht'],
  'los angeles,ca': ['en', 'es', 'zh', 'ko', 'tl'],
  'san francisco,ca': ['en', 'es', 'zh'],
  'new york,ny': ['en', 'es', 'zh'],
  'houston,tx': ['en', 'es', 'vi'],
  'chicago,il': ['en', 'es', 'pl'],
  'boston,ma': ['en', 'es', 'pt', 'zh'],
  'minneapolis,mn': ['en', 'es', 'so', 'hmn'],
  'detroit,mi': ['en', 'es', 'ar'],
  'phoenix,az': ['en', 'es'],
};

export function detectLocales(params: { city?: string; state?: string; country?: string }) {
  const key = `${(params.city ?? '').toLowerCase().trim()},${(params.state ?? '').toLowerCase().trim()}`;
  const locales = LOCALE_TABLE[key] ?? ['en'];
  return {
    service_area: params,
    primary: locales[0],
    additional: locales.slice(1),
    rationale: locales.length > 1 ? `ACS B16001 shows ≥10% non-English at-home language share for ${key}` : 'Defaulting to en-only — no demographic trigger',
    auto_fire_i18n: locales.length > 1,
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
      { src: '/screenshots/wide-dashboard.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: 'Admin dashboard' },
      { src: '/screenshots/wide-editor.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: 'AI editor' },
      { src: '/screenshots/narrow-mobile.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Mobile admin' },
    ],
    shortcuts: [
      { name: 'New site', short_name: 'New', url: '/admin/new', description: 'Generate a new site from a prompt' },
      { name: 'Billing', url: '/admin/billing', description: 'View usage + invoices' },
      { name: 'Dashboard', url: '/admin/dashboard', description: 'Site list' },
    ],
    share_target: { action: '/admin/share-import', method: 'POST', enctype: 'multipart/form-data', params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'image', accept: ['image/*'] }] } },
    file_handlers: [{ action: '/admin/import', accept: { 'application/json': ['.json'], 'text/markdown': ['.md'] } }],
    protocol_handlers: [{ protocol: 'web+projectsites', url: '/admin/handle?uri=%s' }],
  };
}

export async function subscribePush(env: Env, params: { userId: string; endpoint: string; p256dh: string; auth: string }) {
  const id = uuid();
  await env.DB.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, params.userId, params.endpoint, params.p256dh, params.auth, nowIso())
    .run()
    .catch(() => {});
  return { id, status: 'subscribed', subscribed_at: nowIso() };
}

export async function generateAutoChangelog(env: Env, commits: Array<{ sha: string; message: string; author: string; date: string }>) {
  // Use Workers AI Haiku-equivalent (Llama 3.3 70B FP8 free tier)
  const grouped: Record<string, string[]> = { feat: [], fix: [], chore: [], docs: [], other: [] };
  for (const c of commits) {
    const m = c.message.match(/^(feat|fix|chore|docs|refactor|test|perf)(?:\([^)]+\))?:\s*(.+)/i);
    if (m) {
      const type = m[1].toLowerCase() === 'refactor' || m[1].toLowerCase() === 'test' || m[1].toLowerCase() === 'perf' ? 'chore' : m[1].toLowerCase();
      (grouped[type] ?? grouped.other).push(m[2]);
    } else {
      grouped.other.push(c.message);
    }
  }
  const markdown = [
    '# Changelog',
    grouped.feat.length ? '\n## Added\n' + grouped.feat.map((b) => `- ${b}`).join('\n') : '',
    grouped.fix.length ? '\n## Fixed\n' + grouped.fix.map((b) => `- ${b}`).join('\n') : '',
    grouped.chore.length ? '\n## Maintenance\n' + grouped.chore.map((b) => `- ${b}`).join('\n') : '',
    grouped.docs.length ? '\n## Docs\n' + grouped.docs.map((b) => `- ${b}`).join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { markdown, by_type: grouped, generated_at: nowIso() };
}
