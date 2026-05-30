/**
 * @module libs/features/gbp_assist/service
 * @description Service layer for Google Business Profile (GBP) Assist (idea #9).
 *
 * Three capabilities:
 *  - {@link checkGbpStatus}    — detect an existing profile via Places + a deep-link.
 *  - {@link generateContentPack} — LLM-generate an SEO-optimized GBP content pack.
 *  - {@link getSetupChecklist} — ordered guided steps with persisted done-state.
 *
 * MVP is guided (deep-link + content-pack the owner pastes), not a silent GBP
 * API write — that needs Google approval.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { lookupBusiness } from '../../../src/services/google_places.js';
import { callExternalLLM } from '../../../src/services/external_llm.js';
import {
  GBP_DESCRIPTION_MAX,
  GbpContentPackDraftSchema,
  type GbpContentPack,
  type GbpStatus,
  type GbpChecklistResponse,
  type GbpChecklistStep,
} from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'gbp_assist';

/** Google console URL for creating a brand-new profile. */
const GBP_CREATE_URL = 'https://business.google.com/create';

/** Subset of the `sites` row this service reads. */
interface SiteRow {
  id: string;
  business_name: string;
  business_address: string | null;
  business_phone: string | null;
  business_website: string | null;
  google_place_id: string | null;
}

/** Ordered guided steps. `done` is overlaid from persisted checklist_state. */
const CHECKLIST_STEPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claim', label: 'Claim or create your Google Business Profile' },
  { id: 'verify', label: 'Verify ownership (postcard, phone, or email)' },
  { id: 'categories', label: 'Set your primary + secondary categories' },
  { id: 'hours', label: 'Add accurate business hours' },
  { id: 'photos', label: 'Upload at least 5 high-quality photos' },
  { id: 'first_post', label: 'Publish your first GBP post' },
  { id: 'link_website', label: 'Link your website + appointment URL' },
];

/** Structured-output JSON Schema handed to the LLM for the content pack. */
const CONTENT_PACK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'primaryCategory',
    'secondaryCategories',
    'description',
    'services',
    'attributes',
    'firstPost',
  ],
  properties: {
    primaryCategory: { type: 'string' },
    secondaryCategories: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    services: { type: 'array', items: { type: 'string' } },
    attributes: { type: 'array', items: { type: 'string' } },
    firstPost: { type: 'string' },
  },
};

/**
 * Load the minimal site row this feature needs. Returns null when the site is
 * missing or soft-deleted.
 *
 * @param env    - Worker env (uses `env.DB`).
 * @param siteId - Site to load.
 */
async function loadSite(env: Env, siteId: string): Promise<SiteRow | null> {
  return dbQueryOne<SiteRow>(
    env.DB,
    `SELECT id, business_name, business_address, business_phone, business_website, google_place_id
       FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [siteId],
  ).catch(() => null);
}

/**
 * Detect whether the site's business already has a Google Business Profile and
 * return the right console deep-link.
 *
 * @remarks
 * Reuses {@link lookupBusiness} (Places Text Search + Details). When a place is
 * found, `hasProfile` is true, category/rating/reviewCount are surfaced, and the
 * deep-link points at the existing place's manage screen. When nothing is found
 * (or Places is unconfigured) the create deep-link is returned.
 *
 * @param env    - Worker env (uses `env.DB`, `env.GOOGLE_PLACES_API_KEY`).
 * @param siteId - Site to inspect.
 * @returns A {@link GbpStatus}.
 * @throws Error when the site does not exist.
 */
export async function checkGbpStatus(env: Env, siteId: string): Promise<GbpStatus> {
  const site = await loadSite(env, siteId);
  if (!site) throw new Error('site_not_found');

  const apiKey = (env as { GOOGLE_PLACES_API_KEY?: string }).GOOGLE_PLACES_API_KEY;
  const places = await lookupBusiness(
    apiKey,
    site.business_name,
    site.business_address ?? '',
  ).catch((err) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'gbp_assist',
        feature_slug: FLAG_KEY,
        message: 'places lookup failed',
        site_id: siteId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  });

  if (places) {
    const placeId = places.place_id || site.google_place_id || undefined;
    return {
      hasProfile: true,
      placeId,
      category: places.types[0] ?? undefined,
      rating: places.rating ?? undefined,
      reviewCount: places.review_count ?? undefined,
      deepLink: placeId
        ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
        : GBP_CREATE_URL,
    };
  }

  return { hasProfile: false, deepLink: GBP_CREATE_URL };
}

/** Clamp a description to the GBP limit at a word boundary. */
function clampDescription(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= GBP_DESCRIPTION_MAX) return trimmed;
  const slice = trimmed.slice(0, GBP_DESCRIPTION_MAX);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

/**
 * Best-effort spend recording — only fires when the `token_burn_meter` module
 * is present. Never throws; a failure is logged and swallowed.
 */
async function recordSpendBestEffort(
  env: Env,
  orgId: string | undefined,
  siteId: string,
  result: { model_used: string; token_count: number; cost_estimate: number },
): Promise<void> {
  if (!orgId) return;
  try {
    const mod = await import('../token_burn_meter/service.js');
    await mod.recordSpend(env, orgId, {
      tokensIn: 0,
      tokensOut: result.token_count,
      model: result.model_used,
      usd: result.cost_estimate,
      siteId,
    });
  } catch {
    /* token_burn_meter absent or record failed — ignore (idea #13 is optional). */
  }
}

/**
 * Generate an SEO-optimized GBP content pack from the site's business data.
 *
 * @remarks
 * Builds categories, a 750-char description containing the primary keyword
 * (`{business type} in {city}`), a service list, GBP attributes, and a first
 * GBP post. The description is clamped to {@link GBP_DESCRIPTION_MAX} after the
 * LLM returns. Spend is recorded best-effort via {@link recordSpendBestEffort}.
 *
 * @param env    - Worker env (uses `env.DB`, LLM provider keys).
 * @param siteId - Site to generate for.
 * @param orgId  - Owning org (for best-effort spend metering).
 * @returns A validated {@link GbpContentPack}.
 * @throws Error when the site does not exist.
 */
export async function generateContentPack(
  env: Env,
  siteId: string,
  orgId?: string,
): Promise<GbpContentPack> {
  const site = await loadSite(env, siteId);
  if (!site) throw new Error('site_not_found');

  const system =
    'You are a local-SEO specialist optimizing a Google Business Profile. ' +
    'Return strict JSON matching the schema. The description MUST be <= 750 characters, ' +
    'lead with the primary keyword "{business type} in {city}", read naturally, and avoid hype words. ' +
    'Pick the single best-fitting Google primary category and up to 9 secondary categories.';
  const user = JSON.stringify({
    businessName: site.business_name,
    address: site.business_address ?? '',
    phone: site.business_phone ?? '',
    website: site.business_website ?? '',
  });

  const result = await callExternalLLM(env, {
    system,
    user,
    temperature: 0.4,
    maxTokens: 1200,
    jsonMode: true,
    jsonSchema: { name: 'gbp_content_pack', schema: CONTENT_PACK_JSON_SCHEMA },
    responseSchema: CONTENT_PACK_JSON_SCHEMA,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.output);
  } catch {
    throw new Error('content_pack_parse_failed');
  }

  const draft = GbpContentPackDraftSchema.parse(parsedJson);
  await recordSpendBestEffort(env, orgId, siteId, result);

  return {
    primaryCategory: draft.primaryCategory,
    secondaryCategories: draft.secondaryCategories.slice(0, 9),
    description: clampDescription(draft.description),
    services: draft.services,
    attributes: draft.attributes,
    firstPost: draft.firstPost,
  };
}

/**
 * Return the ordered guided checklist with done-state overlaid from the
 * persisted `gbp_profiles.checklist_state` JSON map (defaults to all-incomplete).
 *
 * @param env    - Worker env (uses `env.DB`).
 * @param siteId - Site whose checklist to read.
 * @returns A {@link GbpChecklistResponse}.
 */
export async function getSetupChecklist(
  env: Env,
  siteId: string,
): Promise<GbpChecklistResponse> {
  const row = await dbQueryOne<{ checklist_state: string }>(
    env.DB,
    'SELECT checklist_state FROM gbp_profiles WHERE site_id = ? AND deleted_at IS NULL LIMIT 1',
    [siteId],
  ).catch(() => null);

  let doneMap: Record<string, boolean> = {};
  if (row?.checklist_state) {
    try {
      const parsed = JSON.parse(row.checklist_state) as unknown;
      if (parsed && typeof parsed === 'object') doneMap = parsed as Record<string, boolean>;
    } catch {
      /* corrupt state — treat as all-incomplete. */
    }
  }

  const steps: GbpChecklistStep[] = CHECKLIST_STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    done: doneMap[s.id] === true,
  }));

  return { siteId, steps };
}
