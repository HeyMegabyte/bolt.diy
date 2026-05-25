/**
 * @module services/profile_context
 *
 * @description
 * Single-source-of-truth gatherer for everything the dashboard knows about a
 * site's business. The domain suggester, the AI chat panel, the CRO copy
 * generator, and the email composer all read the same `ProfileContext` so
 * we never reinvent the "what does this site actually do" lookup.
 *
 * @remarks
 * Pull order (cheapest → richest):
 * 1. `sites` row — business_name, business_email, business_phone, business_address,
 *    business_website, google_place_id, logo_url, current_build_version, slug.
 * 2. `confidence_attributes` rows — typed key/value pairs from the research
 *    pipeline (`category`, `target_audience`, `usp_*`, `service_*`, etc.).
 * 3. `research_data` rows — full JSON payload per research task
 *    (`research-profile`, `research-brand`, `research-selling-points`,
 *    `research-social`, `research-images`).
 * 4. `_build-context.json` in R2 (`sites/{slug}/assets/_build-context.json`) —
 *    the canonical brand/colors/fonts snapshot the build container reads.
 *
 * Cached 1h in `CACHE_KV` (`profile_ctx:{site_id}`) because this is the
 * slowest step in the suggest pipeline and the underlying signals only
 * change on a fresh build.
 *
 * @example
 * ```ts
 * import { gatherProfileContext } from './profile_context.js';
 * const ctx = await gatherProfileContext(env, siteId);
 * console.warn(ctx.business_name, ctx.category, ctx.recent_keywords);
 * ```
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQuery, dbQueryOne } from './db.js';

/** Cache TTL — 1h — research only changes on a fresh build. */
const PROFILE_CACHE_TTL_S = 3600;

/**
 * Everything the AI needs to write personalized domain/copy/CRO output for one site.
 *
 * @remarks
 * Every field is optional except `site_id` + `business_name` because the
 * underlying research pipeline is best-effort and free-tier sites may ship
 * with nothing more than a business name + slug.
 */
export interface ProfileContext {
  site_id: string;
  slug: string;
  business_name: string;
  business_type?: string;
  business_description?: string;
  category?: string;
  location?: string;
  business_email?: string;
  business_phone?: string;
  business_address?: string;
  business_website?: string;
  primary_hostname?: string;
  logo_url?: string;
  brand_colors?: string[];
  brand_fonts?: { heading?: string; body?: string };
  brand_tone?: string;
  target_audience?: string;
  usps?: string[];
  services?: string[];
  recent_keywords: string[];
  homepage_summary?: string;
  current_build_version?: string;
  generated_at: string;
}

interface SiteRow {
  id: string;
  slug: string;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  business_address: string | null;
  business_website: string | null;
  google_place_id: string | null;
  logo_url: string | null;
  current_build_version: string | null;
}

interface ConfidenceRow {
  attribute_name: string;
  attribute_value: string;
  confidence: number;
}

interface ResearchRow {
  task_name: string;
  parsed_output: string | null;
  raw_output: string;
}

interface BuildContextSnapshot {
  business?: {
    category?: string;
    address?: string;
    website?: string;
  };
  research?: {
    profile?: unknown;
    brand?: unknown;
    sellingPoints?: unknown;
    social?: unknown;
    images?: unknown;
  };
}

/**
 * Pull every relevant signal about a site into a typed `ProfileContext`.
 *
 * @param env - Worker env (DB + KV + R2 bindings).
 * @param siteId - UUID of the site to profile.
 * @returns A fully-populated context, or `null` if the site doesn't exist.
 *
 * @remarks
 * Best-effort across every source — a missing research row never throws,
 * just leaves the corresponding field undefined. The 1h KV cache key is
 * versioned by `current_build_version` so a fresh build invalidates the
 * snapshot automatically without an explicit purge call.
 */
export async function gatherProfileContext(
  env: Env,
  siteId: string,
): Promise<ProfileContext | null> {
  // Cheap base lookup first — bail early if the site doesn't exist.
  const site = await dbQueryOne<SiteRow>(
    env.DB,
    `SELECT id, slug, business_name, business_email, business_phone, business_address,
            business_website, google_place_id, logo_url, current_build_version
       FROM sites WHERE id = ? AND deleted_at IS NULL`,
    [siteId],
  );
  if (!site) return null;

  // Versioned cache key — a fresh build (new current_build_version) invalidates
  // the snapshot automatically. Null version falls back to a static suffix.
  const cacheKey = `profile_ctx:${siteId}:${site.current_build_version || 'unbuilt'}`;
  try {
    const cached = await env.CACHE_KV.get(cacheKey, 'json');
    if (cached && typeof cached === 'object' && 'business_name' in (cached as object)) {
      return cached as ProfileContext;
    }
  } catch {
    // KV miss is non-fatal — fall through to the live gather.
  }

  // Parallel fan-out — none of these depend on each other.
  const [confidenceRes, researchRes, buildSnapshot] = await Promise.all([
    dbQuery<ConfidenceRow>(
      env.DB,
      `SELECT attribute_name, attribute_value, confidence
         FROM confidence_attributes
        WHERE site_id = ? AND deleted_at IS NULL
        ORDER BY confidence DESC`,
      [siteId],
    ),
    dbQuery<ResearchRow>(
      env.DB,
      `SELECT task_name, parsed_output, raw_output
         FROM research_data
        WHERE site_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [siteId],
    ),
    fetchBuildSnapshot(env, site.slug).catch(() => null),
  ]);

  const confidence = new Map<string, string>();
  for (const row of confidenceRes.data) {
    // First-write-wins so the highest-confidence row sticks (ORDER BY above).
    if (!confidence.has(row.attribute_name)) {
      confidence.set(row.attribute_name, row.attribute_value);
    }
  }

  const researchByTask = new Map<string, unknown>();
  for (const row of researchRes.data) {
    if (researchByTask.has(row.task_name)) continue;
    const raw = row.parsed_output || row.raw_output;
    try {
      researchByTask.set(row.task_name, JSON.parse(raw));
    } catch {
      researchByTask.set(row.task_name, raw);
    }
  }

  const profile = (researchByTask.get('research-profile') ||
    researchByTask.get('research_profile') ||
    {}) as Record<string, unknown>;
  const brand = (researchByTask.get('research-brand') ||
    researchByTask.get('research_brand') ||
    {}) as Record<string, unknown>;
  const usps = (researchByTask.get('research-selling-points') ||
    researchByTask.get('research_selling_points') ||
    {}) as Record<string, unknown>;

  const buildBrand =
    (buildSnapshot?.research?.brand as Record<string, unknown> | undefined) || {};
  const buildProfile =
    (buildSnapshot?.research?.profile as Record<string, unknown> | undefined) || {};
  const buildSelling =
    (buildSnapshot?.research?.sellingPoints as Record<string, unknown> | undefined) || {};

  const category =
    confidence.get('category') ||
    (profile.category as string | undefined) ||
    (buildProfile.category as string | undefined) ||
    buildSnapshot?.business?.category;

  const businessType =
    confidence.get('business_type') ||
    (profile.business_type as string | undefined) ||
    category;

  const businessDescription =
    confidence.get('business_description') ||
    (profile.description as string | undefined) ||
    (profile.summary as string | undefined) ||
    (buildProfile.description as string | undefined);

  const targetAudience =
    confidence.get('target_audience') ||
    (profile.target_audience as string | undefined) ||
    (usps.target_audience as string | undefined);

  const brandColors = extractStringArray(
    (brand.colors as unknown) ?? (buildBrand.colors as unknown) ?? confidence.get('brand_colors'),
  );

  const brandFonts = extractFonts(brand.fonts ?? buildBrand.fonts);
  const brandTone =
    confidence.get('brand_tone') ||
    (brand.tone as string | undefined) ||
    (brand.personality as string | undefined) ||
    (buildBrand.tone as string | undefined);

  const uspList = extractStringArray(
    (usps.usps as unknown) ??
      (usps.selling_points as unknown) ??
      (buildSelling.usps as unknown),
  );

  const services = extractStringArray(
    (profile.services as unknown) ?? (buildProfile.services as unknown) ?? confidence.get('services'),
  );

  const recentKeywords = deriveKeywords({
    businessName: site.business_name,
    businessType,
    category,
    services,
    usps: uspList,
    description: businessDescription,
  });

  // Primary hostname — prefer the custom hostname row if one is live; fall
  // back to the default `{slug}.projectsites.dev` we always serve.
  let primaryHostname: string | undefined;
  try {
    const hostnameRow = await dbQueryOne<{ hostname: string }>(
      env.DB,
      `SELECT hostname
         FROM hostnames
        WHERE site_id = ? AND status = 'active' AND deleted_at IS NULL
        ORDER BY type DESC, created_at ASC LIMIT 1`,
      [siteId],
    );
    primaryHostname = hostnameRow?.hostname || `${site.slug}.projectsites.dev`;
  } catch {
    primaryHostname = `${site.slug}.projectsites.dev`;
  }

  const ctx: ProfileContext = {
    site_id: site.id,
    slug: site.slug,
    business_name: site.business_name,
    business_type: businessType,
    business_description: businessDescription,
    category,
    location: site.business_address || undefined,
    business_email: site.business_email || undefined,
    business_phone: site.business_phone || undefined,
    business_address: site.business_address || undefined,
    business_website: site.business_website || (buildSnapshot?.business?.website as string | undefined),
    primary_hostname: primaryHostname,
    logo_url: site.logo_url || undefined,
    brand_colors: brandColors.length ? brandColors : undefined,
    brand_fonts: brandFonts,
    brand_tone: brandTone,
    target_audience: targetAudience,
    usps: uspList.length ? uspList : undefined,
    services: services.length ? services : undefined,
    recent_keywords: recentKeywords,
    current_build_version: site.current_build_version || undefined,
    generated_at: new Date().toISOString(),
  };

  // Best-effort cache write — KV failure must not block the response.
  try {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(ctx), {
      expirationTtl: PROFILE_CACHE_TTL_S,
    });
  } catch {
    // non-fatal
  }

  return ctx;
}

/**
 * Pull the canonical `_build-context.json` snapshot the container wrote at
 * build time. Returns null if the site has never built or R2 read fails.
 */
async function fetchBuildSnapshot(env: Env, slug: string): Promise<BuildContextSnapshot | null> {
  try {
    const obj = await env.SITES_BUCKET.get(`sites/${slug}/assets/_build-context.json`);
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as BuildContextSnapshot;
  } catch {
    return null;
  }
}

/**
 * Coerce a heterogeneous research payload into a clean string[] of ≤8 entries.
 * Handles JSON arrays, comma-separated strings, and single scalar values.
 */
function extractStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v ? JSON.stringify(v) : ''))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return extractStringArray(parsed);
    } catch {
      // fall through to comma split
    }
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

/**
 * Extract a `{heading, body}` font pair from a brand research payload.
 * Returns undefined when neither slot is populated.
 */
function extractFonts(value: unknown): { heading?: string; body?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const heading =
    (typeof obj.heading === 'string' && obj.heading) ||
    (typeof obj.display === 'string' && obj.display) ||
    (typeof obj.primary === 'string' && obj.primary) ||
    undefined;
  const body =
    (typeof obj.body === 'string' && obj.body) ||
    (typeof obj.secondary === 'string' && obj.secondary) ||
    undefined;
  if (!heading && !body) return undefined;
  return { heading: heading || undefined, body: body || undefined };
}

/**
 * Derive up to 12 short, domain-friendly keywords from the gathered signals.
 *
 * @remarks
 * Output drives the AI candidate-generation prompt — short, lowercase, no
 * filler stopwords. The list is deduped and capped so the prompt stays
 * within budget and the AI doesn't drown in noise.
 */
function deriveKeywords(input: {
  businessName: string;
  businessType?: string;
  category?: string;
  services?: string[];
  usps?: string[];
  description?: string;
}): string[] {
  const STOP = new Set([
    'the', 'and', 'for', 'with', 'from', 'your', 'our', 'this', 'that',
    'are', 'was', 'were', 'have', 'has', 'a', 'an', 'in', 'on', 'of', 'to',
    'by', 'at', 'is', 'be', 'will', 'us', 'we', 'i', 'you', 'they',
  ]);
  const bag = new Set<string>();
  const push = (s: string | undefined): void => {
    if (!s) return;
    for (const tok of s.toLowerCase().split(/[^a-z0-9]+/)) {
      const t = tok.trim();
      if (t.length >= 3 && t.length <= 18 && !STOP.has(t) && !/^\d+$/.test(t)) {
        bag.add(t);
      }
    }
  };
  push(input.businessName);
  push(input.businessType);
  push(input.category);
  for (const s of input.services || []) push(s);
  for (const u of input.usps || []) push(u);
  if (input.description) push(input.description.slice(0, 240));
  return Array.from(bag).slice(0, 12);
}
