/**
 * Per-feature E2E check runner — runs entirely on Cloudflare, NO Docker.
 *
 * Two check kinds:
 *   - `http`    — fetch a prod URL + assert status / body substring (works on any
 *                 Worker, no binding).
 *   - `browser` — drive a real Chromium via Browser Rendering + `@cloudflare/playwright`
 *                 (`launch(env.BROWSER)`), navigate + assert a selector / text.
 *
 * Contract consumed by the spec-sheet "Run all in parallel" button:
 *   POST /api/feature-e2e/:key/run     → { runId, specs:[{path,status:'queued'}] }
 *   GET  /api/feature-e2e/runs/:runId  → { status, specs:[{path,status,durationMs}] }
 *
 * Run state lives in CACHE_KV (`e2erun:<id>`, 10-min TTL); checks run concurrently
 * via `ctx.waitUntil`, each updating KV so the client poll sees live progress.
 */

import { Hono } from 'hono';
import type { BrowserWorker } from '@cloudflare/playwright';
import type { Env, Variables } from '../types/env.js';

const PROD = 'https://projectsites.dev';
const RUN_TTL = 600;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

export type CheckStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface E2eCheck {
  /** Plain-English label shown in the spec-sheet table. */
  label: string;
  kind: 'http' | 'browser';
  /** Path (prefixed with the prod origin) or absolute URL. */
  url: string;
  expectStatus?: number;
  bodyIncludes?: string;
  /** browser-only: assert this selector is present. */
  selector?: string;
  /** browser-only: assert the page's text contains this. */
  textIncludes?: string;
}

interface SpecState {
  path: string;
  status: CheckStatus;
  durationMs?: number;
  detail?: string;
}

interface RunState {
  status: 'running' | 'passed' | 'failed';
  specs: SpecState[];
}

/**
 * Per-flag check registry. Most platform flags have a real HTTP smoke check
 * (mirrors docs.ts smoke steps); UI surfaces get a Browser Rendering check.
 * Unknown keys fall back to a homepage-renders smoke check.
 */
const CHECK_REGISTRY: Readonly<Record<string, readonly E2eCheck[]>> = {
  llms_txt: [
    { label: '/llms.txt responds', kind: 'http', url: '/llms.txt', expectStatus: 200 },
    {
      label: 'robots.txt names AI crawlers',
      kind: 'http',
      url: '/robots.txt',
      expectStatus: 200,
      bodyIncludes: 'GPTBot',
    },
  ],
  mcp_server: [
    {
      label: '/.well-known/mcp lists tools',
      kind: 'http',
      url: '/.well-known/mcp',
      expectStatus: 200,
      bodyIncludes: 'tools',
    },
  ],
  public_api: [
    {
      label: 'OpenAPI 3.1 spec served',
      kind: 'http',
      url: '/api/openapi.json',
      expectStatus: 200,
      bodyIncludes: 'openapi',
    },
  ],
  search_engine_submit: [
    {
      label: 'sitemap.xml served for indexing',
      kind: 'http',
      url: '/sitemap.xml',
      expectStatus: 200,
    },
  ],
  pwa_manifest_full: [
    {
      label: 'homepage links a PWA manifest',
      kind: 'http',
      url: '/',
      expectStatus: 200,
      bodyIncludes: 'rel="manifest"',
    },
  ],
  structured_data_autopilot: [
    {
      label: 'JSON-LD on homepage',
      kind: 'http',
      url: '/',
      expectStatus: 200,
      bodyIncludes: 'application/ld+json',
    },
  ],
  quotable_answer_block: [
    {
      label: 'data-quotable block present',
      kind: 'http',
      url: '/',
      expectStatus: 200,
      bodyIncludes: 'data-quotable',
    },
  ],
  speculation_rules: [
    {
      label: 'speculation rules injected',
      kind: 'http',
      url: '/',
      expectStatus: 200,
      bodyIncludes: 'speculationrules',
    },
  ],
  accessibility_statement: [
    {
      label: '/accessibility renders WCAG statement',
      kind: 'http',
      url: '/accessibility',
      expectStatus: 200,
      bodyIncludes: 'WCAG',
    },
  ],
  site_mcp_server: [
    {
      label: 'platform MCP discovery responds',
      kind: 'http',
      url: '/.well-known/mcp',
      expectStatus: 200,
    },
  ],
  core_feature_flags: [
    {
      label: 'Feature Flags admin shell renders',
      kind: 'browser',
      url: '/admin/feature-flags',
      selector: '[data-testid="ff-layer-heading"]',
    },
  ],
  core_site_create: [
    { label: 'Homepage renders with a heading', kind: 'browser', url: '/', selector: 'h1' },
  ],
};

/** Pure resolver — exported for tests. Falls back to a homepage smoke check. */
export function checksFor(key: string): E2eCheck[] {
  const reg = CHECK_REGISTRY[key];
  if (reg && reg.length) return [...reg];
  return [
    { label: `Homepage renders (smoke for ${key})`, kind: 'http', url: '/', expectStatus: 200 },
  ];
}

/** Resolve a check's URL against the prod origin. Exported for tests. */
export function resolveCheckUrl(check: E2eCheck): string {
  return check.url.startsWith('http') ? check.url : `${PROD}${check.url}`;
}

async function runHttpCheck(
  check: E2eCheck,
): Promise<{ status: 'passed' | 'failed'; detail?: string }> {
  try {
    const res = await fetch(resolveCheckUrl(check), {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    });
    if (check.expectStatus && res.status !== check.expectStatus)
      return { status: 'failed', detail: `HTTP ${res.status}` };
    if (check.bodyIncludes) {
      const body = await res.text();
      if (!body.includes(check.bodyIncludes))
        return { status: 'failed', detail: `missing "${check.bodyIncludes}"` };
    }
    return { status: 'passed' };
  } catch (e) {
    return { status: 'failed', detail: (e as Error).message };
  }
}

async function runBrowserCheck(
  env: Env,
  check: E2eCheck,
): Promise<{ status: 'passed' | 'failed'; detail?: string }> {
  if (!env.BROWSER) return { status: 'failed', detail: 'Browser Rendering binding unavailable' };
  try {
    const { launch } = await import('@cloudflare/playwright');
    const browser = await launch(env.BROWSER as BrowserWorker);
    try {
      const page = await browser.newPage();
      await page.goto(resolveCheckUrl(check), { waitUntil: 'domcontentloaded', timeout: 25_000 });
      if (check.selector) {
        const el = await page.$(check.selector);
        if (!el) return { status: 'failed', detail: `selector "${check.selector}" not found` };
      }
      if (check.textIncludes) {
        const text = (await page.textContent('body')) ?? '';
        if (!text.includes(check.textIncludes))
          return { status: 'failed', detail: `text "${check.textIncludes}" not found` };
      }
      return { status: 'passed' };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { status: 'failed', detail: (e as Error).message };
  }
}

/** Run all checks concurrently, persisting live status to KV after each completes. */
async function executeRun(env: Env, runId: string, checks: E2eCheck[]): Promise<void> {
  const kvKey = `e2erun:${runId}`;
  const specs: SpecState[] = checks.map((ch) => ({ path: ch.label, status: 'running' }));
  const persist = (status: RunState['status']) =>
    env.CACHE_KV.put(kvKey, JSON.stringify({ status, specs } satisfies RunState), {
      expirationTtl: RUN_TTL,
    }).catch(() => {});
  await persist('running');
  await Promise.all(
    checks.map(async (ch, i) => {
      const t0 = Date.now();
      const r = ch.kind === 'browser' ? await runBrowserCheck(env, ch) : await runHttpCheck(ch);
      specs[i] = {
        path: ch.label,
        status: r.status,
        durationMs: Date.now() - t0,
        detail: r.detail,
      };
      await persist('running');
    }),
  );
  await persist(specs.every((s) => s.status === 'passed') ? 'passed' : 'failed');
}

export const featureE2e = new Hono<{ Bindings: Env; Variables: Variables }>();

featureE2e.post('/api/feature-e2e/:key/run', async (c) => {
  const key = c.req.param('key');
  const checks = checksFor(key);
  const runId = crypto.randomUUID();
  const initial: RunState = {
    status: 'running',
    specs: checks.map((ch) => ({ path: ch.label, status: 'queued' })),
  };
  await c.env.CACHE_KV.put(`e2erun:${runId}`, JSON.stringify(initial), { expirationTtl: RUN_TTL });
  c.executionCtx.waitUntil(executeRun(c.env, runId, checks));
  return c.json({ runId, specs: initial.specs });
});

featureE2e.get('/api/feature-e2e/runs/:runId', async (c) => {
  const raw = await c.env.CACHE_KV.get(`e2erun:${c.req.param('runId')}`);
  if (!raw) return c.json({ status: 'error', specs: [] }, 404);
  return c.json(JSON.parse(raw) as RunState);
});
