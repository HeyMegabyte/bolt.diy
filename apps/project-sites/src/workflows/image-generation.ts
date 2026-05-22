/**
 * @module workflows/image-generation
 * @description Cloudflare Workflows v2 — resumable AI image generation pipeline.
 *
 * Replaces the synchronous `generateSectionImage` / `generateWebsiteImages`
 * helpers with a durable, step-based workflow. Each step is independently
 * retryable on transient OpenAI / Stability / R2 failures, and the workflow
 * resumes from the latest completed step instead of restarting the whole
 * image generation from scratch.
 *
 * ## Step graph
 *
 * | Step                       | Purpose                                                    |
 * | -------------------------- | ---------------------------------------------------------- |
 * | `validate-prompt`          | Zod-style runtime check of caller-provided prompt+slug     |
 * | `call-dalle`               | Try OpenAI DALL-E 3 first (preferred provider)             |
 * | `call-stability-fallback`  | Run Stability AI when DALL-E missing / failed              |
 * | `upload-to-r2`             | Persist final PNG bytes to `sites/{slug}/assets/...`       |
 * | `persist-asset-row`        | Insert into `ai_context_files` for traceability            |
 *
 * Caller (the site-generation workflow's `generate-section-images` phase)
 * fires this workflow per image concept and either awaits the final state
 * or polls `/api/sites/:siteId/workflows/image-generation/:id`.
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';

/**
 * Allowed DALL-E output sizes (also accepted by the Stability adapter).
 */
export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';

/**
 * Parameters for one image-generation workflow run.
 *
 * @example
 * ```ts
 * await env.IMAGE_GENERATION_WORKFLOW.create({
 *   id: `imgwf-${siteId}-${concept}-${Date.now()}`,
 *   params: { siteId, slug, concept: 'hero', prompt, size: '1792x1024' },
 * });
 * ```
 */
export interface ImageGenerationParams {
  /** Site ID for traceability + asset-row persistence. */
  siteId: string;
  /** Site slug — drives the R2 key prefix `sites/{slug}/assets/...`. */
  slug: string;
  /** Short concept slug (`hero`, `team`, `service-1`). Used in the filename. */
  concept: string;
  /** Full DALL-E prompt (already brand-aware; the workflow does not edit it). */
  prompt: string;
  /** Output dimensions. Default `1024x1024`. */
  size?: ImageSize;
}

/** Successful output. */
export interface ImageGenerationResult {
  ok: true;
  key: string;
  size: number;
  provider: 'dalle3' | 'stability';
  confidence: number;
}

/** Failure output. */
export interface ImageGenerationFailure {
  ok: false;
  error: string;
}

/** Retry policy for each call (3 tries, 30s exponential backoff). */
const RETRY_30S = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' as const },
} as const;

/**
 * Workflow entrypoint for AI image generation with provider fallback.
 *
 * Failure semantics: every step either succeeds or returns a structured
 * `null`-equivalent (so retries don't keep firing). DALL-E failure is not
 * a workflow failure — it advances to the Stability fallback step. Only
 * when BOTH providers fail does the workflow throw, and even then the
 * R2 upload step is skipped (no partial assets).
 *
 * @example
 * ```ts
 * const instance = await env.IMAGE_GENERATION_WORKFLOW.create({
 *   id: `imgwf-${siteId}-hero-${Date.now()}`,
 *   params: { siteId, slug, concept: 'hero', prompt, size: '1792x1024' },
 * });
 * // poll later: GET /api/sites/${siteId}/workflows/image-generation/${instance.id}
 * ```
 */
export class ImageGenerationWorkflow extends WorkflowEntrypoint<Env, ImageGenerationParams> {
  override async run(
    event: Readonly<WorkflowEvent<ImageGenerationParams>>,
    step: WorkflowStep,
  ): Promise<ImageGenerationResult | ImageGenerationFailure> {
    const env = this.env;
    const params = event.payload;

    // ── Step 1: validate-prompt ─────────────────────────────
    const validated = await step.do('validate-prompt', RETRY_30S, async () => {
      const slug = (params.slug || '').trim();
      const concept = (params.concept || '').trim();
      const prompt = (params.prompt || '').trim();
      if (!slug) throw new Error('slug_required');
      if (!concept) throw new Error('concept_required');
      if (prompt.length < 10) throw new Error('prompt_too_short');
      if (prompt.length > 4000) throw new Error('prompt_too_long');
      const size: ImageSize = params.size ?? '1024x1024';
      const safeConcept = concept.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
      return { slug, concept: safeConcept, prompt, size };
    });

    // ── Step 2: call-dalle ──────────────────────────────────
    const dalleBytes = await step.do('call-dalle', RETRY_30S, async () => {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) return null;
      try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: validated.prompt,
            n: 1,
            size: validated.size,
            response_format: 'url',
            quality: 'standard',
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { data?: { url?: string }[] };
        const imageUrl = data.data?.[0]?.url;
        if (!imageUrl) return null;
        const img = await fetch(imageUrl);
        if (!img.ok) return null;
        const bytes = await img.arrayBuffer();
        return Array.from(new Uint8Array(bytes));
      } catch {
        return null;
      }
    });

    // ── Step 3: call-stability-fallback ─────────────────────
    const stabilityBytes = await step.do('call-stability-fallback', RETRY_30S, async () => {
      if (dalleBytes) return null;
      const apiKey = env.STABILITY_API_KEY;
      if (!apiKey) return null;
      try {
        const [wStr, hStr] = validated.size.split('x');
        const width = Number.parseInt(wStr ?? '1024', 10);
        const height = Number.parseInt(hStr ?? '1024', 10);
        const res = await fetch(
          'https://api.stability.ai/v2beta/stable-image/generate/core',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: 'image/png',
            },
            body: (() => {
              const fd = new FormData();
              fd.set('prompt', validated.prompt);
              fd.set('output_format', 'png');
              fd.set('aspect_ratio', width >= height ? '16:9' : '9:16');
              return fd;
            })(),
          },
        );
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        return Array.from(new Uint8Array(bytes));
      } catch {
        return null;
      }
    });

    const finalBytes = dalleBytes ?? stabilityBytes;
    if (!finalBytes) {
      return { ok: false, error: 'all_providers_failed' };
    }
    const provider: 'dalle3' | 'stability' = dalleBytes ? 'dalle3' : 'stability';

    // ── Step 4: upload-to-r2 ────────────────────────────────
    const uploaded = await step.do('upload-to-r2', RETRY_30S, async () => {
      const png = new Uint8Array(finalBytes).buffer;
      const key = `sites/${validated.slug}/assets/generated/${validated.concept}.png`;
      await env.SITES_BUCKET.put(key, png, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          source: 'generated',
          provider,
          confidence: provider === 'dalle3' ? '85' : '75',
          prompt: validated.prompt.slice(0, 200),
        },
      });
      return { key, bytes: png.byteLength };
    });

    // ── Step 5: persist-asset-row ───────────────────────────
    await step.do('persist-asset-row', RETRY_30S, async () => {
      try {
        await env.DB.prepare(
          `INSERT INTO ai_context_files
             (id, site_id, org_id, filename, content_type, size_bytes, r2_key, extracted_text,
              source, drive_file_id, drive_modified_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', NULL, NULL)`,
        )
          .bind(
            crypto.randomUUID(),
            params.siteId,
            // org_id is unknown to the workflow — site-generation passes it
            // through `additionalContext`. For now we look it up; on failure
            // we proceed (asset_row is best-effort).
            await lookupOrgId(env, params.siteId),
            `${validated.concept}.png`,
            'image/png',
            uploaded.bytes,
            uploaded.key,
            '',
            // intentional positional placeholder for drive_file_id (NULL above)
          )
          .run();
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'image-generation-workflow',
            message: 'asset_row_insert_failed',
            siteId: params.siteId,
            key: uploaded.key,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

    return {
      ok: true,
      key: uploaded.key,
      size: uploaded.bytes,
      provider,
      confidence: provider === 'dalle3' ? 85 : 75,
    };
  }
}

/**
 * Best-effort org-id lookup for the asset-row insert step.
 *
 * @internal
 */
async function lookupOrgId(env: Env, siteId: string): Promise<string> {
  try {
    const row = await env.DB.prepare(`SELECT org_id FROM sites WHERE id = ?`)
      .bind(siteId)
      .first<{ org_id: string | null }>();
    return row?.org_id ?? '';
  } catch {
    return '';
  }
}
