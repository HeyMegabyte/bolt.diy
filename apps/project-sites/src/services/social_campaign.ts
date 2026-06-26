/**
 * @module services/social_campaign
 * @description Pulse Social — AI campaign generator (the Part 9 moat).
 *
 * Turns a single business + its research signals into a *month of varied
 * posts* — not one auto-pilot post, but a dated, deduplicated CAMPAIGN that
 * rotates across post archetypes (service spotlight, review social proof,
 * before/after, Google Business update, seasonal offer, local event, …).
 *
 * Two layers, deliberately split for testability:
 *
 *   1. {@link planCampaign} — PURE + DETERMINISTIC. Given a spec + signals it
 *      produces the dated slot plan (date · archetype · angle · hashtags). No
 *      I/O, no AI, no `Date.now()` (the start date is an input) → trivially
 *      unit-tested and reproducible.
 *   2. {@link generateCampaignDrafts} — orchestrator. Runs the plan, fills each
 *      slot's copy through the EXISTING auto-pilot AI path
 *      ({@link generateAutoPilotPostForNetwork} → loadBusinessContext →
 *      callExternalLLM, inheriting its banned-word + char-limit guards), and
 *      persists `status='draft'` `pulse_posts` rows the user reviews before
 *      publishing. Reuses, never duplicates, the publisher/LLM infrastructure.
 *
 * @packageDocumentation
 */
import { z } from 'zod';
import type { Env } from '../types/env.js';
import { dbInsert, dbQueryOne } from './db.js';
import type { Platform } from './social_publishers/index.js';
import { DEFAULT_AUTO_PILOT_PROMPT, generateAutoPilotPostForNetwork } from './social_auto_pilot.js';

// ---------------------------------------------------------------------------
// Schemas + types
// ---------------------------------------------------------------------------

/** Supported campaign durations (days). */
export const CAMPAIGN_LENGTHS = [7, 14, 30] as const;

/** Post archetypes the planner rotates through. */
export const CAMPAIGN_POST_TYPES = [
  'service_spotlight',
  'review_social_proof',
  'before_after',
  'gbp_update',
  'seasonal_offer',
  'local_event',
  'behind_the_scenes',
  'faq_answer',
] as const;

export type CampaignPostType = (typeof CAMPAIGN_POST_TYPES)[number];

/** Whole-day milliseconds — slot dates advance in day steps. */
const MS_PER_DAY = 86_400_000;

/** Request shape for a campaign. */
export const CampaignSpecSchema = z
  .object({
    /** Campaign length in days. */
    length: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    /** ISO date the campaign starts (first slot is on this day). */
    start_date: z.string().datetime({ offset: true }).or(z.string().date()),
    /** Posting cadence; clamped to 1..7. Default 5. */
    posts_per_week: z.number().int().min(1).max(7).optional(),
    /** Connected `social_accounts.id`s the drafts target. */
    account_ids: z.array(z.string().min(1)).min(1).max(50),
    /** Optional owning site for attribution. */
    site_id: z.string().min(1).optional(),
    /** Primary network used to size copy (char limits / tone). Default facebook. */
    network: z.string().min(1).optional(),
  })
  .strict();

export type CampaignSpec = z.infer<typeof CampaignSpecSchema>;

/** Research-derived signals that gate which archetypes are eligible. */
export const CampaignSignalsSchema = z
  .object({
    business_name: z.string().min(1),
    /** Named services/offerings — drives service_spotlight rotation. */
    services: z.array(z.string().min(1)).max(50).default([]),
    has_reviews: z.boolean().default(false),
    has_photos: z.boolean().default(false),
    has_offers: z.boolean().default(false),
    /** Town / neighborhood for local_event + hashtags. */
    area_name: z.string().min(1).optional(),
  })
  .strict();

export type CampaignSignals = z.infer<typeof CampaignSignalsSchema>;

/** Combined request body for the campaign route: spec + business signals. */
export const CampaignRequestSchema = z
  .object({
    spec: CampaignSpecSchema,
    signals: CampaignSignalsSchema,
  })
  .strict();

export type CampaignRequest = z.infer<typeof CampaignRequestSchema>;

/** Auto-fillable campaign brief fields derived from the org's site. */
export interface CampaignPrefill {
  business_name: string;
  area_name?: string;
}

/** Best-effort city extraction from a free-form business address. */
function deriveArea(addr: string | null | undefined): string | undefined {
  if (!addr) return undefined;
  const parts = addr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // "street, city, state zip" → city is parts[1]; "city, state" → parts[0].
  if (parts.length >= 3) return parts[1] || undefined;
  if (parts.length === 2) return parts[0] || undefined;
  return undefined;
}

/**
 * Derive the auto-fillable campaign brief ({@link CampaignPrefill}) from the
 * org's most-recent (published-first) site — so the dashboard pre-populates the
 * required business name + area instead of making the user retype them.
 *
 * @param env - Worker bindings (DB)
 * @param orgId - tenant scope
 * @returns business name (empty when the org has no site yet) + optional area
 *
 * @example
 * const pre = await loadCampaignPrefill(env, orgId); // { business_name, area_name? }
 *
 * @remarks Impure — reads D1.
 */
export async function loadCampaignPrefill(env: Env, orgId: string): Promise<CampaignPrefill> {
  const site = await dbQueryOne<{ business_name: string | null; business_address: string | null }>(
    env.DB,
    `SELECT business_name, business_address FROM sites
      WHERE org_id = ? AND deleted_at IS NULL
      ORDER BY CASE WHEN status = 'published' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [orgId],
  );
  const businessName = site?.business_name?.trim() ?? '';
  const area = deriveArea(site?.business_address);
  return { business_name: businessName, ...(area ? { area_name: area } : {}) };
}

/** One dated slot in a campaign plan. */
export interface CampaignSlot {
  /** 0-based index in the plan. */
  index: number;
  /** ISO date (midnight UTC) the post is scheduled for. */
  date: string;
  post_type: CampaignPostType;
  /** One-line angle handed to the AI to write the post. */
  angle: string;
  /** Up to 3 suggested hashtags (no leading `#`). */
  hashtags: string[];
}

/** Output of {@link planCampaign}. */
export interface CampaignPlan {
  length: number;
  start_date: string;
  slot_count: number;
  slots: CampaignSlot[];
}

/** Thrown when a campaign cannot be planned (no eligible archetypes). */
export class CampaignPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignPlanError';
  }
}

// ---------------------------------------------------------------------------
// Pure planner
// ---------------------------------------------------------------------------

/** Slugify a phrase into a PascalCase-ish hashtag token (no `#`). */
function tagToken(phrase: string): string {
  return phrase
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** Eligible archetypes given the signals (gating keeps copy honest). */
function eligibleTypes(signals: CampaignSignals): CampaignPostType[] {
  const pool: CampaignPostType[] = ['gbp_update', 'behind_the_scenes', 'faq_answer'];
  if (signals.services.length > 0) pool.unshift('service_spotlight');
  if (signals.has_reviews) pool.push('review_social_proof');
  if (signals.has_photos) pool.push('before_after');
  if (signals.has_offers) pool.push('seasonal_offer');
  if (signals.area_name) pool.push('local_event');
  // Stable, de-duplicated order — service_spotlight leads when present.
  return [...new Set(pool)];
}

/** One-line angle brief for a slot (deterministic, signal-aware). */
function angleFor(type: CampaignPostType, signals: CampaignSignals, serviceIdx: number): string {
  const svc =
    signals.services.length > 0
      ? signals.services[serviceIdx % signals.services.length]
      : 'our core service';
  const area = signals.area_name ?? 'the local area';
  switch (type) {
    case 'service_spotlight':
      return `Spotlight "${svc}" — who it helps, what makes ours better, one clear next step.`;
    case 'review_social_proof':
      return `Turn a real customer win into social proof for ${signals.business_name} — no fabricated quotes.`;
    case 'before_after':
      return `Show a before/after transformation; describe the visual so a photo can be paired later.`;
    case 'gbp_update':
      return `A short Google Business-style update: hours, availability, or what's new this week.`;
    case 'seasonal_offer':
      return `Promote the current offer with urgency and a single CTA — never invent a discount.`;
    case 'local_event':
      return `Tie ${signals.business_name} to something happening in ${area} this season.`;
    case 'behind_the_scenes':
      return `A human, behind-the-scenes moment that builds trust — process, team, or craft.`;
    case 'faq_answer':
      return `Answer one real question a ${signals.business_name} customer asks, helpfully and briefly.`;
  }
}

/** Suggested hashtags for a slot (≤3, no leading `#`). */
function hashtagsFor(type: CampaignPostType, signals: CampaignSignals): string[] {
  const tags = [tagToken(signals.business_name)];
  if (signals.area_name) tags.push(tagToken(signals.area_name));
  const typeTag: Partial<Record<CampaignPostType, string>> = {
    service_spotlight: 'LocalBusiness',
    review_social_proof: 'CustomerLove',
    before_after: 'BeforeAndAfter',
    gbp_update: 'WhatsNew',
    seasonal_offer: 'LimitedOffer',
    local_event: 'CommunityLove',
    behind_the_scenes: 'BehindTheScenes',
    faq_answer: 'GoodToKnow',
  };
  if (typeTag[type]) tags.push(typeTag[type] as string);
  return [...new Set(tags.filter(Boolean))].slice(0, 3);
}

/**
 * Plan a campaign — PURE + DETERMINISTIC. Same `(spec, signals)` always yields
 * the identical dated slot plan. The start date is an input (never
 * `Date.now()`), so the function is reproducible and unit-testable.
 *
 * @param spec - validated {@link CampaignSpec}
 * @param signals - research-derived {@link CampaignSignals}
 * @returns the dated {@link CampaignPlan}
 * @throws {CampaignPlanError} when no archetypes are eligible (impossible with
 *   the always-on base pool, but guarded for safety).
 *
 * @example
 * const plan = planCampaign(
 *   { length: 7, start_date: '2026-07-01', posts_per_week: 5, account_ids: ['a'] },
 *   { business_name: 'Vito Salon', services: ['Haircut'], has_reviews: true, has_photos: false, has_offers: false },
 * );
 * plan.slot_count; // 5
 * plan.slots[0].post_type; // 'service_spotlight'
 */
export function planCampaign(spec: CampaignSpec, signals: CampaignSignals): CampaignPlan {
  const pool = eligibleTypes(signals);
  if (pool.length === 0)
    throw new CampaignPlanError('no eligible post archetypes for these signals');

  const ppw = Math.min(7, Math.max(1, spec.posts_per_week ?? 5));
  const slotCount = Math.max(1, Math.round((spec.length / 7) * ppw));

  // start_date may be a date ('2026-07-01') or full ISO — normalise to a
  // midnight-UTC epoch so day stepping is deterministic across timezones.
  const startMs = Date.parse(
    spec.start_date.length === 10 ? `${spec.start_date}T00:00:00.000Z` : spec.start_date,
  );

  const slots: CampaignSlot[] = [];
  let serviceIdx = 0;
  for (let i = 0; i < slotCount; i++) {
    const type = pool[i % pool.length];
    const dayOffset = Math.floor((i * spec.length) / slotCount);
    const dateMs = startMs + dayOffset * MS_PER_DAY;
    slots.push({
      index: i,
      date: new Date(dateMs).toISOString().slice(0, 10),
      post_type: type,
      angle: angleFor(type, signals, serviceIdx),
      hashtags: hashtagsFor(type, signals),
    });
    if (type === 'service_spotlight') serviceIdx++;
  }

  return { length: spec.length, start_date: spec.start_date, slot_count: slotCount, slots };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** A created draft row summary returned to the caller. */
export interface CampaignDraftRef {
  id: string;
  date: string;
  post_type: CampaignPostType;
}

/** Generator fn shape — overridable in tests to avoid hitting the LLM. */
export type SlotContentFn = (
  network: Platform,
  systemPromptTemplate: string,
) => Promise<{ text: string; mediaSuggestion?: string }>;

/**
 * Generate + persist a full campaign of `status='draft'` posts. Reuses the
 * auto-pilot AI path per slot (banned-word + char-limit guards inherited) and
 * inserts one `pulse_posts` row per slot, scheduled to the slot's date but left
 * as a draft for explicit user review before publishing.
 *
 * @param env - Worker bindings (DB + LLM config)
 * @param ownerOrgId - caller's org (tenant scope)
 * @param createdBy - caller's user id
 * @param spec - validated {@link CampaignSpec}
 * @param signals - {@link CampaignSignals} for the org's business
 * @param opts.contentFn - inject a fake generator in tests; defaults to the
 *   real {@link generateAutoPilotPostForNetwork}.
 * @returns the plan + the created draft refs
 * @throws {CampaignPlanError} when planning fails.
 *
 * @remarks Impure — calls the LLM + writes D1.
 */
export async function generateCampaignDrafts(
  env: Env,
  ownerOrgId: string,
  createdBy: string,
  spec: CampaignSpec,
  signals: CampaignSignals,
  opts: { contentFn?: SlotContentFn } = {},
): Promise<{ plan: CampaignPlan; drafts: CampaignDraftRef[] }> {
  const plan = planCampaign(spec, signals);
  const network = (spec.network as Platform | undefined) ?? 'facebook';
  const contentFn: SlotContentFn =
    opts.contentFn ??
    ((net, template) => generateAutoPilotPostForNetwork(env, ownerOrgId, net, template));

  const drafts: CampaignDraftRef[] = [];
  for (const slot of plan.slots) {
    const template = `${DEFAULT_AUTO_PILOT_PROMPT}\n\nThis specific post is a "${slot.post_type}" post.\nAngle: ${slot.angle}`;
    let text: string;
    try {
      const out = await contentFn(network, template);
      text = out.text;
    } catch (err) {
      // One bad slot never aborts the campaign — log + skip per fail-soft-prod.
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'social_campaign',
          message: 'slot generation failed',
          slot_index: slot.index,
          post_type: slot.post_type,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      continue;
    }

    const id = crypto.randomUUID();
    const { error } = await dbInsert(env.DB, 'pulse_posts', {
      id,
      org_id: ownerOrgId,
      site_id: spec.site_id ?? null,
      created_by: createdBy,
      status: 'draft',
      scheduled_at: `${slot.date}T15:00:00.000Z`,
      content: text,
      per_platform_overrides: null,
      media_keys: null,
      account_ids: JSON.stringify(spec.account_ids),
      hashtags: JSON.stringify(slot.hashtags),
      mentions: null,
      link: null,
      thread_id: null,
    });
    if (!error) drafts.push({ id, date: slot.date, post_type: slot.post_type });
  }

  return { plan, drafts };
}
