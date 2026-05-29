/**
 * @module services/ai_components
 * @description AI Code Components Generator (IDEAS-50 #42).
 *
 * Describe a widget in plain language → get a React TSX component with the
 * site's brand tokens auto-inherited from `_brand.json` in R2.
 *
 * Flow:
 *   1. Load the site's `_brand.json` from R2 (palette, fonts, tone).
 *   2. Build a system prompt that injects those tokens.
 *   3. Call Workers AI Llama 3.3 70B FP8 (model alias per [[model-routing]]).
 *   4. Validate the AI output against `GeneratedComponentSchema` per
 *      [[contract-first-ai]].
 *   5. Persist to the `ai_components` table as `status='draft'`.
 *   6. Owner can later publish via `/api/ai-components/:id/publish` which
 *      creates a corresponding `plugins` row.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from './db.js';
import {
  AiComponentRowSchema,
  BrandTokensSnapshotSchema,
  GenerateComponentInputSchema,
  GeneratedComponentSchema,
  PublishComponentInputSchema,
  type AiComponentRow,
  type BrandTokensSnapshot,
  type GenerateComponentInput,
  type GeneratedComponent,
  type PublishComponentInput,
} from '../../libs/features/ai_components/feature.schemas.js';

/** Workers AI Llama 3.3 70B FP8 (fp8-fast — never the retired bare alias). */
export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function uuid(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand-token loader.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load `_brand.json` for the site from R2 and return the validated snapshot.
 * Falls back to a sensible default snapshot when the file is missing or
 * malformed so callers always have a usable shape.
 */
export async function loadBrandSnapshot(env: Env, siteId: string): Promise<BrandTokensSnapshot> {
  const fallback: BrandTokensSnapshot = {
    palette: { primary: '#0b0b14', accent: '#3b82f6', ink: '#f4f4ff' },
    fonts: { heading: 'Inter', body: 'Inter' },
    tone: 'Professional, clear, and trustworthy.',
    theme: 'dark',
  };
  try {
    const site = await dbQueryOne<{ slug: string }>(
      env.DB,
      'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
      [siteId],
    );
    if (!site) return fallback;

    const obj = await env.SITES_BUCKET.get(`sites/${site.slug}/latest/_brand.json`);
    if (!obj) return fallback;

    const raw = (await obj.json()) as unknown;
    const parsed = BrandTokensSnapshotSchema.safeParse(raw);
    return parsed.success ? { ...fallback, ...parsed.data } : fallback;
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder.
// ─────────────────────────────────────────────────────────────────────────────

export function buildPrompt(input: GenerateComponentInput, brand: BrandTokensSnapshot): {
  system: string;
  user: string;
} {
  const paletteEntries = brand.palette ? Object.entries(brand.palette) : [];
  const paletteStr = paletteEntries.length
    ? paletteEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')
    : '  primary: #0b0b14\n  accent: #3b82f6\n  ink: #f4f4ff';

  const fontStr = brand.fonts
    ? `heading: ${brand.fonts.heading ?? 'Inter'}, body: ${brand.fonts.body ?? 'Inter'}`
    : 'heading: Inter, body: Inter';

  const system = `You are an expert React + TypeScript developer.
Generate a production-ready React component scaffolded for shadcn/ui + Tailwind.

Brand tokens (use these EXACTLY):
${paletteStr}
Fonts: ${fontStr}
Tone: ${brand.tone ?? 'Professional, clear, and trustworthy.'}
Theme: ${brand.theme ?? 'dark'}

Rules:
- Single default-export functional component, PascalCase name
- Use Tailwind classes; reference palette colors via the names above (e.g. text-primary)
- Include TypeScript types for all props
- No external state libraries; useState/useReducer only
- No external API calls inside the component
- Return ONLY a JSON object matching this schema:
{"name": "<PascalCase>", "component_code": "<full TSX>", "description": "<one-sentence summary>"}`;

  const user = `Build a React component for the following widget:\n\n${input.description.slice(0, 1900)}`;
  return { system, user };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI call + validation.
// ─────────────────────────────────────────────────────────────────────────────

interface RawAiResponse {
  response?: string;
  usage?: { total_tokens?: number };
}

/**
 * Call Workers AI and validate the structured output against the contract.
 *
 * @throws Error('AI_INVALID_OUTPUT') when the AI returns malformed JSON or
 *   the validated shape does not match `GeneratedComponentSchema`.
 */
export async function callAi(
  env: Env,
  prompt: { system: string; user: string },
): Promise<{ generated: GeneratedComponent; tokens: number }> {
  const raw = (await env.AI.run(AI_MODEL, {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: 4096,
  })) as RawAiResponse;

  const responseText = raw.response ?? '';
  const tokens = raw.usage?.total_tokens ?? 0;

  // Strip code fences if the model wrapped the JSON.
  const cleaned = responseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error('AI_INVALID_OUTPUT');
  }

  const parsed = GeneratedComponentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error('AI_INVALID_OUTPUT');
  }
  return { generated: parsed.data, tokens };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate + persist.
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateResult {
  ok: true;
  id: string;
  name: string;
  component_code: string;
  description: string;
  ai_tokens: number;
}

export async function generateComponent(
  env: Env,
  input: GenerateComponentInput,
  userId: string,
  orgId: string,
): Promise<GenerateResult> {
  // Validate input at the boundary (defense in depth — route handler also validates).
  const validated = GenerateComponentInputSchema.parse(input);

  const brand = await loadBrandSnapshot(env, validated.site_id);
  const prompt = buildPrompt(validated, brand);
  const { generated, tokens } = await callAi(env, prompt);

  // Caller-provided name override wins over AI-supplied name.
  const finalName = validated.name ?? generated.name;

  const id = `aic_${uuid()}`;
  const { error } = await dbInsert(env.DB, 'ai_components', {
    id,
    site_id: validated.site_id,
    org_id: orgId,
    created_by: userId,
    name: finalName,
    description: generated.description,
    component_code: generated.component_code,
    brand_tokens_snapshot: JSON.stringify(brand),
    ai_model: AI_MODEL,
    ai_tokens: tokens,
    status: 'draft',
    published_to_marketplace: 0,
    generation_count: 1,
  });
  if (error) throw new Error(`DB_INSERT_FAILED: ${error}`);

  return {
    ok: true,
    id,
    name: finalName,
    component_code: generated.component_code,
    description: generated.description,
    ai_tokens: tokens,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads + lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

export async function getComponent(env: Env, id: string): Promise<AiComponentRow | null> {
  const row = await dbQueryOne<Record<string, unknown>>(
    env.DB,
    `SELECT id, site_id, org_id, created_by, name, description, component_code,
            brand_tokens_snapshot, ai_model, ai_tokens, status,
            published_to_marketplace, marketplace_plugin_id, generation_count,
            created_at, updated_at
       FROM ai_components
       WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;
  const parsed = AiComponentRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

export async function listSiteComponents(env: Env, siteId: string, limit = 100): Promise<Array<{
  id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  generation_count: number;
}>> {
  const { data } = await dbQuery<{
    id: string;
    name: string;
    description: string;
    status: string;
    created_at: string;
    generation_count: number;
  }>(
    env.DB,
    `SELECT id, name, description, status, created_at, generation_count
       FROM ai_components
       WHERE site_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT ?`,
    [siteId, Math.min(limit, 500)],
  );
  return data ?? [];
}

/**
 * Regenerate an existing component with the same description (used when the
 * first attempt was unsatisfying). Increments `generation_count` and
 * overwrites `component_code`.
 */
export async function regenerateComponent(
  env: Env,
  componentId: string,
): Promise<GenerateResult> {
  const existing = await getComponent(env, componentId);
  if (!existing) throw new Error('COMPONENT_NOT_FOUND');

  const brand = await loadBrandSnapshot(env, existing.site_id);
  const prompt = buildPrompt(
    { site_id: existing.site_id, description: existing.description },
    brand,
  );
  const { generated, tokens } = await callAi(env, prompt);

  await dbExecute(
    env.DB,
    `UPDATE ai_components
        SET component_code = ?,
            ai_tokens = ?,
            generation_count = generation_count + 1,
            brand_tokens_snapshot = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      generated.component_code,
      tokens,
      JSON.stringify(brand),
      new Date().toISOString(),
      componentId,
    ],
  );

  return {
    ok: true,
    id: componentId,
    name: existing.name,
    component_code: generated.component_code,
    description: existing.description,
    ai_tokens: tokens,
  };
}

/**
 * Publish a draft component to the plugin marketplace as a new plugin row.
 * The published component shows up in the plugin catalog under category
 * `ai` and inherits the standard 70/30 plugin marketplace economics.
 *
 * @throws Error('COMPONENT_NOT_FOUND') when component is missing.
 * @throws Error('ALREADY_PUBLISHED') when component already promoted.
 */
export async function publishComponent(
  env: Env,
  input: PublishComponentInput,
  userId: string,
): Promise<{ ok: true; plugin_id: string }> {
  const validated = PublishComponentInputSchema.parse(input);
  const component = await getComponent(env, validated.component_id);
  if (!component) throw new Error('COMPONENT_NOT_FOUND');
  if (component.published_to_marketplace === 1) throw new Error('ALREADY_PUBLISHED');
  if (component.created_by !== userId) throw new Error('FORBIDDEN');

  const pluginId = `plg_${uuid()}`;
  const manifestJson = JSON.stringify({
    version: '1.0',
    hooks: [],
    env_vars: [],
    scripts: [],
    permissions: [],
  });

  const insertRes = await dbInsert(env.DB, 'plugins', {
    id: pluginId,
    slug: `ai-${component.name.toLowerCase()}-${pluginId.slice(0, 8)}`,
    name: component.name,
    description: component.description,
    creator_user_id: userId,
    category: validated.category === 'other' ? 'ai' : validated.category,
    manifest_json: manifestJson,
    price_cents: validated.price_cents,
    install_count: 0,
    sales_count: 0,
    total_revenue_cents: 0,
    rating_avg: 0,
    rating_count: 0,
    status: 'pending',
  });
  if (insertRes.error) throw new Error(`DB_INSERT_FAILED: ${insertRes.error}`);

  await dbExecute(
    env.DB,
    `UPDATE ai_components
        SET published_to_marketplace = 1,
            marketplace_plugin_id = ?,
            status = 'published',
            updated_at = ?
      WHERE id = ?`,
    [pluginId, new Date().toISOString(), component.id],
  );

  return { ok: true, plugin_id: pluginId };
}

export async function archiveComponent(env: Env, id: string, userId: string): Promise<{ ok: true }> {
  const existing = await getComponent(env, id);
  if (!existing) throw new Error('COMPONENT_NOT_FOUND');
  if (existing.created_by !== userId) throw new Error('FORBIDDEN');
  await dbExecute(
    env.DB,
    `UPDATE ai_components SET status = 'archived', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), id],
  );
  return { ok: true };
}
