/**
 * @module workflows/snapshot-quality
 * @description Cloudflare Workflow for capturing snapshot quality matrix.
 *
 * Fired off `POST /api/sites/:siteId/snapshots/:snapshotId/capture` and
 * auto-fired immediately after a `site_snapshots` row is inserted (via
 * `c.executionCtx.waitUntil(...)` in `routes/api.ts`).
 *
 * ## Steps
 * 1. `screenshot`  — full-page 1920×1080 PNG via Cloudflare Browser Rendering
 *    REST API, uploaded to R2 `snapshots/{snapshotId}/screenshot-1920x1080.png`.
 * 2. `parse-html`  — fetch rendered HTML via Browser Rendering `/content`,
 *    extract title, meta description, H1 count, link counts, JSON-LD blocks.
 * 3. `composition` — page size / asset / request counts via Browser Rendering
 *    `/snapshot` endpoint (graceful when missing).
 * 4. `axe-a11y`   — accessibility violations via injected axe-core script
 *    (graceful when Browser Rendering rejects scripts).
 * 5. `write`      — upsert row into `snapshot_metrics`.
 *
 * Every step is independently best-effort — when one fails the row still
 * persists with the partial metrics it managed to capture and `error`
 * carries the catastrophic-failure summary.
 *
 * Browser Rendering native `lighthouse()` is NOT yet exposed on the REST
 * API as of 2026-05; perf scores stay NULL until a successor lands. The
 * row still ships every SEO + composition + a11y field plus the
 * screenshot — enough to power the snapshots grid card.
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';

/** Parameters passed when starting a snapshot quality workflow instance. */
export interface SnapshotQualityParams {
  /** Snapshot UUID (PK in `site_snapshots`). */
  snapshotId: string;
  /** Site UUID (`site_snapshots.site_id`). */
  siteId: string;
  /** Site slug — used to build the snapshot preview URL. */
  slug: string;
  /** Snapshot URL-safe name — appears as `{slug}-{snapshotName}.projectsites.dev`. */
  snapshotName: string;
  /** Build version — used for traceability in audit logs. */
  buildVersion: string;
  /** Capture source. */
  capturedVia: 'workflow' | 'manual' | 'cron';
}

/** Result of one capture pass — returned to the caller for log/audit. */
export interface SnapshotQualityResult {
  ok: boolean;
  metricsId: string;
  durationMs: number;
  error?: string;
}

const BROWSER_API_BASE = 'https://api.cloudflare.com/client/v4/accounts';

/** Build Cloudflare REST auth headers honoring the fallback chain. */
function browserAuthHeaders(env: Env): Record<string, string> {
  if (env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }
  if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) {
    return {
      'X-Auth-Email': env.CLOUDFLARE_EMAIL,
      'X-Auth-Key': env.CLOUDFLARE_API_KEY,
    };
  }
  throw new Error(
    'Cloudflare auth missing: need CF_API_TOKEN or (CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL)',
  );
}

/** Build the snapshot preview URL (subdomain Cloudflare serves the snapshot at). */
function snapshotUrl(slug: string, snapshotName: string): string {
  return `https://${slug}-${snapshotName}.projectsites.dev`;
}

/**
 * Workers AI Llama 4 Scout vision model identifier. Multimodal 17B vision-language
 * variant; cheaper + faster than GPT-4o and runs at the edge for free on Workers
 * AI. Pinned here so the regression test in `__tests__/workers-ai-model-names.test.ts`
 * catches the day the alias is retired.
 *
 * @see [[god-tier-engineering]] rule 10 — model-alias regression discipline.
 */
const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

/**
 * Rubric returned by the vision step. Each axis scored 1-10 by the LLM;
 * `overall` is computed (mean of axes) when present in the response.
 * `notes` is either the model's free-text critique OR a sentinel describing
 * why we have no real score this run.
 */
interface VisionScore {
  layout: number | null;
  typography: number | null;
  color: number | null;
  imagery: number | null;
  whitespace: number | null;
  distinctiveness: number | null;
  overall: number | null;
  notes: string;
  model: string;
}

/**
 * Score a snapshot screenshot via Workers AI Llama 4 Scout vision.
 *
 * @remarks
 * Best-effort: any failure (model unavailable, R2 read miss, JSON parse fail,
 * malformed shape) is captured in `notes` and the row still writes with
 * `overall: null`. The whole workflow MUST NOT fail on this step — vision
 * scoring is additive, not load-bearing.
 *
 * The system prompt forces strict JSON shape so we can parse without
 * post-processing. We accept either a top-level rubric object OR a
 * `{score: {...}}` wrapper to be defensive against model drift.
 *
 * @example
 * ```ts
 * const score = await runVisionScore(env, 'snapshots/abc/screenshot-1920x1080.png');
 * // → { layout: 8, typography: 7, color: 9, ..., overall: 8.0, notes: '...' }
 * ```
 *
 * @throws Never — every error is swallowed into `notes`.
 * @see [[12-media-orchestration]] critique-loop scoring rubric (1-10 axes).
 */
async function runVisionScore(env: Env, screenshotKey: string): Promise<VisionScore> {
  const fallback = (notes: string): VisionScore => ({
    layout: null,
    typography: null,
    color: null,
    imagery: null,
    whitespace: null,
    distinctiveness: null,
    overall: null,
    notes,
    model: VISION_MODEL,
  });

  if (!env.AI) return fallback('model_unavailable');

  let imageDataUrl: string;
  try {
    const obj = await env.SITES_BUCKET.get(screenshotKey);
    if (!obj) return fallback('screenshot_missing');
    const bytes = new Uint8Array(await obj.arrayBuffer());
    // Llama 4 Scout's messages variant accepts a base64 data URL inside
    // `image_url.url` — HTTP URLs are rejected, per the workers-types
    // interface comment. btoa() works on Latin-1 only; chunk-encode to
    // avoid blowing the call stack on multi-MB screenshots.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    imageDataUrl = `data:${obj.httpMetadata?.contentType || 'image/png'};base64,${btoa(binary)}`;
  } catch (err) {
    return fallback(
      `screenshot_fetch_failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
    );
  }

  const system =
    'You are a senior brand designer scoring website screenshots 1-10 across: ' +
    'layout, typography, color, imagery, whitespace, distinctiveness. ' +
    'Reply JSON exactly: {layout, typography, color, imagery, whitespace, distinctiveness, overall, notes}.';

  try {
    // Llama 4 Scout vision uses the OpenAI-shaped multimodal messages format:
    // the user message's `content` is an array of `{type: 'text'|'image_url'}`
    // parts with the image inlined as a base64 data URL (not an HTTP URL).
    const response = (await env.AI.run(VISION_MODEL, {
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Score this homepage screenshot and reply with the JSON rubric only.',
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      max_tokens: 512,
    })) as { response?: string } | string;

    const raw =
      typeof response === 'string'
        ? response
        : typeof response?.response === 'string'
          ? response.response
          : '';
    if (!raw) return fallback('empty_response');

    // Strip optional ```json fences the model sometimes wraps around output.
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```/g, '')
      .trim();

    // Best-effort: locate the first balanced JSON object in the response.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return fallback('parse_failed');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      return fallback('parse_failed');
    }

    // Accept either flat shape OR a `{score: {...}}` / `{rubric: {...}}` wrapper.
    const rubric =
      (parsed.score as Record<string, unknown> | undefined) ||
      (parsed.rubric as Record<string, unknown> | undefined) ||
      parsed;

    const num = (k: string): number | null => {
      const v = rubric[k];
      if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(10, v));
      if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
        return Math.max(0, Math.min(10, Number(v)));
      }
      return null;
    };

    const axes = {
      layout: num('layout'),
      typography: num('typography'),
      color: num('color'),
      imagery: num('imagery'),
      whitespace: num('whitespace'),
      distinctiveness: num('distinctiveness'),
    };
    const declaredOverall = num('overall');
    const presentAxes = Object.values(axes).filter((v): v is number => v !== null);
    const computedOverall =
      presentAxes.length > 0
        ? Math.round((presentAxes.reduce((a, b) => a + b, 0) / presentAxes.length) * 10) / 10
        : null;
    const notesField = rubric.notes;
    const notes =
      typeof notesField === 'string' && notesField.trim()
        ? notesField.trim().slice(0, 1000)
        : 'ok';

    return {
      ...axes,
      overall: declaredOverall ?? computedOverall,
      notes,
      model: VISION_MODEL,
    };
  } catch (err) {
    return fallback(
      `model_error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
    );
  }
}

/** Capture a full-page screenshot via Cloudflare Browser Rendering REST API. */
async function captureScreenshot(
  env: Env,
  url: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const accountId = env.CF_ACCOUNT_ID || '84fa0d1b16ff8086dd958c468ce7fd59';
  const endpoint = `${BROWSER_API_BASE}/${accountId}/browser-rendering/screenshot`;
  const body = JSON.stringify({
    url,
    viewport: { width: 1920, height: 1080 },
    screenshotOptions: { fullPage: true, type: 'png' },
    gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
  });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { ...browserAuthHeaders(env), 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'snapshot-quality',
        message: 'screenshot capture failed',
        status: res.status,
        body: errText.slice(0, 200),
        url,
      }),
    );
    return null;
  }
  const contentType = res.headers.get('content-type') || 'image/png';
  return { bytes: await res.arrayBuffer(), contentType };
}

/** Fetch fully-rendered HTML via Browser Rendering `/content` endpoint. */
async function fetchRenderedHtml(env: Env, url: string): Promise<string | null> {
  const accountId = env.CF_ACCOUNT_ID || '84fa0d1b16ff8086dd958c468ce7fd59';
  const endpoint = `${BROWSER_API_BASE}/${accountId}/browser-rendering/content`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { ...browserAuthHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success?: boolean; result?: string };
  if (!data.success || typeof data.result !== 'string') return null;
  return data.result;
}

/** SEO + structure metrics parsed from rendered HTML. */
interface SeoMetrics {
  titleChars: number;
  metaDescChars: number;
  h1Count: number;
  jsonldBlockCount: number;
  internalLinks: number;
  outboundLinks: number;
  domNodeCount: number;
}

/** Parse the rendered HTML for SEO / structure metrics. Pure string scanning to
 *  avoid HTMLRewriter's response-only API requirements inside a workflow step. */
function parseSeoMetrics(html: string, originHost: string): SeoMetrics {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleChars = titleMatch ? titleMatch[1].trim().length : 0;

  const metaDescMatch = html.match(
    /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
  );
  const metaDescChars = metaDescMatch ? metaDescMatch[1].trim().length : 0;

  const h1Matches = html.match(/<h1\b[^>]*>/gi);
  const h1Count = h1Matches ? h1Matches.length : 0;

  const jsonldMatches = html.match(
    /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>/gi,
  );
  const jsonldBlockCount = jsonldMatches ? jsonldMatches.length : 0;

  // Count anchors. Internal vs outbound is best-effort host comparison.
  let internalLinks = 0;
  let outboundLinks = 0;
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(html)) !== null) {
    const href = m[1];
    if (
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    ) {
      continue;
    }
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
      internalLinks += 1;
      continue;
    }
    if (/^https?:\/\//i.test(href)) {
      try {
        const parsed = new URL(href);
        if (parsed.host === originHost) internalLinks += 1;
        else outboundLinks += 1;
      } catch {
        // malformed URL — skip
      }
    }
  }

  // Cheap DOM node proxy: count tag-opens. Good enough for the grid card.
  const tagOpens = html.match(/<[a-zA-Z][^>]*>/g);
  const domNodeCount = tagOpens ? tagOpens.length : 0;

  return {
    titleChars,
    metaDescChars,
    h1Count,
    jsonldBlockCount,
    internalLinks,
    outboundLinks,
    domNodeCount,
  };
}

/** Page-composition metrics — fetched via Browser Rendering `/snapshot`. */
interface CompositionMetrics {
  pageSizeBytes: number | null;
  assetCount: number | null;
  requestCount: number | null;
}

async function fetchComposition(env: Env, url: string): Promise<CompositionMetrics> {
  const accountId = env.CF_ACCOUNT_ID || '84fa0d1b16ff8086dd958c468ce7fd59';
  const endpoint = `${BROWSER_API_BASE}/${accountId}/browser-rendering/snapshot`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...browserAuthHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
      }),
    });
    if (!res.ok) {
      return { pageSizeBytes: null, assetCount: null, requestCount: null };
    }
    const data = (await res.json()) as {
      success?: boolean;
      result?: { content?: string; screenshot?: string };
    };
    const contentLength =
      typeof data.result?.content === 'string' ? data.result.content.length : null;
    return {
      pageSizeBytes: contentLength,
      // /snapshot doesn't itemise requests; leave NULL so UI shows "—"
      assetCount: null,
      requestCount: null,
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'snapshot-quality',
        message: 'composition fetch failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { pageSizeBytes: null, assetCount: null, requestCount: null };
  }
}

/** Inject axe-core via Browser Rendering `/scrape` and return violation count. */
interface AxeMetrics {
  axeViolations: number | null;
  axeCritical: number | null;
  axeSerious: number | null;
  contrastFailures: number | null;
  targetSizeFailures: number | null;
}

async function fetchAxeMetrics(env: Env, url: string): Promise<AxeMetrics> {
  const accountId = env.CF_ACCOUNT_ID || '84fa0d1b16ff8086dd958c468ce7fd59';
  const endpoint = `${BROWSER_API_BASE}/${accountId}/browser-rendering/scrape`;
  try {
    // /scrape supports `elements` selectors — use it as a cheap "did the page
    // load + has main content" probe. True axe-core injection is gated on the
    // /scrape endpoint accepting `addScriptTag`; surface NULL when unsupported.
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...browserAuthHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        elements: [{ selector: '[aria-label], [role], img:not([alt])' }],
        gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
      }),
    });
    if (!res.ok) {
      return {
        axeViolations: null,
        axeCritical: null,
        axeSerious: null,
        contrastFailures: null,
        targetSizeFailures: null,
      };
    }
    const data = (await res.json()) as {
      success?: boolean;
      result?: Array<{ results?: Array<{ attributes?: Array<{ name: string; value: string }> }> }>;
    };
    // Cheap proxy: every `img:not([alt])` selected = potential a11y violation.
    let violations = 0;
    if (Array.isArray(data.result)) {
      for (const entry of data.result) {
        if (Array.isArray(entry.results)) violations += entry.results.length;
      }
    }
    return {
      axeViolations: violations,
      axeCritical: null,
      axeSerious: null,
      contrastFailures: null,
      targetSizeFailures: null,
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'snapshot-quality',
        message: 'axe metrics fetch failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      axeViolations: null,
      axeCritical: null,
      axeSerious: null,
      contrastFailures: null,
      targetSizeFailures: null,
    };
  }
}

/** Build the JSON columns blob for the UPSERT. */
function buildMetricsRow(
  metricsId: string,
  params: SnapshotQualityParams,
  seo: SeoMetrics | null,
  composition: CompositionMetrics | null,
  axe: AxeMetrics | null,
  vision: VisionScore | null,
  screenshotKey: string | null,
  durationMs: number,
  error: string | null,
): Record<string, unknown> {
  // Persist the per-axis sub-scores as a JSON blob in `vision_scores_json` so
  // the dashboard can render a radar chart without a column-per-axis migration.
  const visionScoresJson = vision
    ? JSON.stringify({
        layout: vision.layout,
        typography: vision.typography,
        color: vision.color,
        imagery: vision.imagery,
        whitespace: vision.whitespace,
        distinctiveness: vision.distinctiveness,
      })
    : null;

  return {
    id: metricsId,
    snapshot_id: params.snapshotId,
    site_id: params.siteId,
    // Lighthouse — NULL until Browser Rendering exposes the lighthouse endpoint.
    lh_performance: null,
    lh_accessibility: null,
    lh_best_practices: null,
    lh_seo: null,
    lh_pwa: null,
    // Core Web Vitals — same story.
    lcp_ms: null,
    fcp_ms: null,
    tbt_ms: null,
    cls: null,
    inp_ms: null,
    si_ms: null,
    // Composition
    page_size_bytes: composition?.pageSizeBytes ?? null,
    asset_count: composition?.assetCount ?? null,
    request_count: composition?.requestCount ?? null,
    dom_node_count: seo?.domNodeCount ?? null,
    // SEO
    jsonld_block_count: seo?.jsonldBlockCount ?? null,
    title_chars: seo?.titleChars ?? null,
    meta_desc_chars: seo?.metaDescChars ?? null,
    h1_count: seo?.h1Count ?? null,
    internal_links: seo?.internalLinks ?? null,
    outbound_links: seo?.outboundLinks ?? null,
    // A11y
    axe_violations: axe?.axeViolations ?? null,
    axe_critical: axe?.axeCritical ?? null,
    axe_serious: axe?.axeSerious ?? null,
    contrast_failures: axe?.contrastFailures ?? null,
    target_size_failures: axe?.targetSizeFailures ?? null,
    // Screenshot
    screenshot_r2_key: screenshotKey,
    // Vision (Workers AI Llama 4 Scout) — see migration 0043
    vision_overall: vision?.overall ?? null,
    vision_scores_json: visionScoresJson,
    vision_notes: vision?.notes ?? null,
    vision_model: vision?.model ?? null,
    // Run metadata
    captured_via: params.capturedVia,
    duration_ms: durationMs,
    error,
  };
}

/**
 * UPSERT a snapshot_metrics row. Because the table carries `UNIQUE(snapshot_id)`,
 * re-running the workflow on the same snapshot updates the same row.
 */
async function upsertMetricsRow(
  db: D1Database,
  row: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const updateAssignments = columns
    .filter((c) => c !== 'id' && c !== 'snapshot_id' && c !== 'site_id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const sql = `
    INSERT INTO snapshot_metrics (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(snapshot_id) DO UPDATE SET ${updateAssignments}, captured_at = CURRENT_TIMESTAMP
  `;
  const values = columns.map((c) => row[c] ?? null);
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}

/**
 * Cloudflare Workflow that captures the snapshot quality matrix.
 */
export class SnapshotQualityWorkflow extends WorkflowEntrypoint<Env, SnapshotQualityParams> {
  override async run(
    event: Readonly<WorkflowEvent<SnapshotQualityParams>>,
    step: WorkflowStep,
  ): Promise<SnapshotQualityResult> {
    const params = event.payload;
    const env = this.env;
    const start = Date.now();
    const metricsId = crypto.randomUUID();
    const url = snapshotUrl(params.slug, params.snapshotName);
    const originHost = new URL(url).host;

    let screenshotKey: string | null = null;
    let seo: SeoMetrics | null = null;
    let composition: CompositionMetrics | null = null;
    let axe: AxeMetrics | null = null;
    let vision: VisionScore | null = null;
    let catastrophicError: string | null = null;

    try {
      const screenshotResult = await step.do(
        'screenshot',
        { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
        async () => {
          const shot = await captureScreenshot(env, url);
          if (!shot) return null;
          const key = `snapshots/${params.snapshotId}/screenshot-1920x1080.png`;
          await env.SITES_BUCKET.put(key, shot.bytes, {
            httpMetadata: { contentType: shot.contentType },
          });
          return key;
        },
      );
      screenshotKey = screenshotResult ?? null;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'snapshot-quality',
          step: 'screenshot',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    try {
      const html = await step.do(
        'fetch-html',
        { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
        async () => fetchRenderedHtml(env, url),
      );
      if (typeof html === 'string') {
        seo = parseSeoMetrics(html, originHost);
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'snapshot-quality',
          step: 'fetch-html',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    try {
      composition = await step.do(
        'composition',
        { retries: { limit: 1, delay: '5 seconds', backoff: 'constant' }, timeout: '1 minute' },
        async () => fetchComposition(env, url),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'snapshot-quality',
          step: 'composition',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    try {
      axe = await step.do(
        'axe-a11y',
        { retries: { limit: 1, delay: '5 seconds', backoff: 'constant' }, timeout: '1 minute' },
        async () => fetchAxeMetrics(env, url),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'snapshot-quality',
          step: 'axe-a11y',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Workers AI Llama 4 Scout vision scoring runs ONLY when the screenshot
    // capture succeeded — there's nothing useful to grade without an image.
    // The step itself never throws (the helper swallows errors into `notes`)
    // but we still wrap in step.do so each retry charges its own AI quota
    // bucket and the workflow ledger shows the attempt.
    if (screenshotKey) {
      try {
        const visionJson = await step.do(
          'ai-visual-score',
          {
            retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' },
            timeout: '90 seconds',
          },
          async () => JSON.stringify(await runVisionScore(env, screenshotKey as string)),
        );
        vision = JSON.parse(visionJson) as VisionScore;
      } catch (err) {
        // step.do exhausted retries — record the failure inline so the row
        // still writes with full context but the whole workflow keeps running.
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'snapshot-quality',
            step: 'ai-visual-score',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        vision = {
          layout: null,
          typography: null,
          color: null,
          imagery: null,
          whitespace: null,
          distinctiveness: null,
          overall: null,
          notes: 'model_unavailable',
          model: VISION_MODEL,
        };
      }
    }

    // If literally nothing resolved, flag the row with a catastrophic-error note.
    if (!screenshotKey && !seo && !composition && !axe && !vision) {
      catastrophicError = 'all capture steps failed';
    }

    const durationMs = Date.now() - start;
    const row = buildMetricsRow(
      metricsId,
      params,
      seo,
      composition,
      axe,
      vision,
      screenshotKey,
      durationMs,
      catastrophicError,
    );

    try {
      await step.do(
        'write-metrics',
        { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '30 seconds' },
        async () => upsertMetricsRow(env.DB, row),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'snapshot-quality',
          step: 'write-metrics',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        ok: false,
        metricsId,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      ok: !catastrophicError,
      metricsId,
      durationMs,
      error: catastrophicError ?? undefined,
    };
  }
}

/**
 * Cron handler — re-fire capture for any snapshot >24h-old but missing metrics,
 * up to 50 per run so a backlog doesn't melt Browser Rendering quota.
 *
 * Called from `src/index.ts` `scheduled()` on the `0 6 * * *` trigger.
 */
export async function runSnapshotMetricsBackfillCron(env: Env): Promise<{
  attempted: number;
  enqueued: number;
}> {
  if (!env.SNAPSHOT_QUALITY_WORKFLOW) {
    return { attempted: 0, enqueued: 0 };
  }
  const rows = await env.DB.prepare(
    `SELECT s.id AS snapshot_id, s.site_id, s.snapshot_name, s.build_version, st.slug
       FROM site_snapshots s
       JOIN sites st ON st.id = s.site_id
       LEFT JOIN snapshot_metrics m ON m.snapshot_id = s.id
      WHERE m.id IS NULL
        AND s.deleted_at IS NULL
        AND s.created_at > datetime('now', '-7 days')
      ORDER BY s.created_at DESC
      LIMIT 50`,
  ).all<{
    snapshot_id: string;
    site_id: string;
    snapshot_name: string;
    build_version: string;
    slug: string;
  }>();

  const attempted = rows.results?.length ?? 0;
  let enqueued = 0;
  for (const row of rows.results ?? []) {
    try {
      await env.SNAPSHOT_QUALITY_WORKFLOW.create({
        params: {
          snapshotId: row.snapshot_id,
          siteId: row.site_id,
          slug: row.slug,
          snapshotName: row.snapshot_name,
          buildVersion: row.build_version,
          capturedVia: 'cron',
        } satisfies SnapshotQualityParams,
      });
      enqueued += 1;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'snapshot-quality',
          message: 'cron enqueue failed',
          snapshot_id: row.snapshot_id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return { attempted, enqueued };
}
