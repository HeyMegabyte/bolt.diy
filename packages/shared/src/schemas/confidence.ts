/**
 * @module schemas/confidence
 * @description Confidence-weighted data model for Small Business Seed V3.
 * Every leaf value is wrapped in Conf<T> with source attribution, confidence score,
 * and rationale. Aggregation, merge, and UI prominence utilities included.
 */

import { z } from 'zod';

// ── Source Attribution ────────────────────────────────────────

export const SOURCE_KINDS = [
  'business_owner',
  'user_provided',
  'google_places',
  'osm',
  'review_platform',
  'domain_whois',
  'street_view',
  'social_profile',
  'llm_generated',
  'internal_inference',
  'stock_photo',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const sourceRefSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  id: z.string().optional(),
  url: z.string().optional(),
  retrievedAt: z.string(),
  notes: z.string().optional(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

// ── Base Confidence by Source ─────────────────────────────────

export const BASE_CONFIDENCE: Record<SourceKind, number> = {
  business_owner: 0.95,
  user_provided: 0.90,
  google_places: 0.90,
  osm: 0.80,
  review_platform: 0.80,
  domain_whois: 0.70,
  street_view: 0.70,
  social_profile: 0.70,
  llm_generated: 0.60,
  internal_inference: 0.55,
  stock_photo: 0.40,
};

// ── Confidence Wrapper ───────────────────────────────────────

export const confSchema = <T extends z.ZodType>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    sources: z.array(sourceRefSchema).min(1),
    rationale: z.string().optional(),
    lastVerifiedAt: z.string().optional(),
    isPlaceholder: z.boolean().optional().default(false),
  });

export type Conf<T> = {
  value: T;
  confidence: number;
  sources: SourceRef[];
  rationale?: string;
  lastVerifiedAt?: string;
  isPlaceholder?: boolean;
};

// ── UI Prominence Policy ─────────────────────────────────────

export type ProminenceLevel = 'prominent' | 'standard' | 'deemphasize' | 'hide_or_placeholder';

export const PROMINENCE_THRESHOLDS: Record<ProminenceLevel, number> = {
  prominent: 0.85,
  standard: 0.70,
  deemphasize: 0.50,
  hide_or_placeholder: 0.0,
};

export const UI_COMPONENT_MIN_CONFIDENCE: Record<string, number> = {
  'hero.title': 0.80,
  'hero.tagline': 0.80,
  'contact.phone': 0.85,
  'contact.booking_cta': 0.85,
  'contact.address': 0.85,
  'contact.map': 0.85,
  'hours.display': 0.80,
  'reviews.aggregate': 0.80,
  'services.pricing': 0.75,
  'team.bios': 0.70,
  'brand.colors': 0.70,
  'brand.fonts': 0.70,
  'marketing.copy': 0.60,
  'images.hero': 0.50,
  'images.gallery': 0.40,
};

export function getProminenceLevel(confidence: number): ProminenceLevel {
  if (confidence >= PROMINENCE_THRESHOLDS.prominent) return 'prominent';
  if (confidence >= PROMINENCE_THRESHOLDS.standard) return 'standard';
  if (confidence >= PROMINENCE_THRESHOLDS.deemphasize) return 'deemphasize';
  return 'hide_or_placeholder';
}

export function shouldShowComponent(component: string, confidence: number): boolean {
  const min = UI_COMPONENT_MIN_CONFIDENCE[component] ?? 0.50;
  return confidence >= min;
}

// ── Utility Functions ────────────────────────────────────────

/** Create a Conf wrapper for a value with a single source. */
export function wrapConf<T>(
  value: T,
  sourceKind: SourceKind,
  options?: {
    rationale?: string;
    isPlaceholder?: boolean;
    sourceId?: string;
    sourceUrl?: string;
    notes?: string;
    confidenceOverride?: number;
  },
): Conf<T> {
  const now = new Date().toISOString();
  let confidence = options?.confidenceOverride ?? BASE_CONFIDENCE[sourceKind];

  // Apply penalties
  if (value === null || value === undefined || value === '') {
    confidence = Math.max(0, confidence - 0.15);
  }
  if (options?.isPlaceholder) {
    confidence = Math.max(0, confidence - 0.10);
  }

  return {
    value,
    confidence: Math.round(confidence * 100) / 100,
    sources: [{
      kind: sourceKind,
      id: options?.sourceId,
      url: options?.sourceUrl,
      retrievedAt: now,
      notes: options?.notes,
    }],
    rationale: options?.rationale,
    lastVerifiedAt: now,
    isPlaceholder: options?.isPlaceholder ?? false,
  };
}

/**
 * Apply deterministic boosts and penalties to a confidence score.
 * +0.05 if corroborated by 2+ sources (cap at 0.98)
 * -0.15 if value is empty/missing
 * -0.10 if isPlaceholder
 * -0.10 if format validation fails
 */
export function applyBoostPenalties(conf: Conf<unknown>, options?: {
  isEmpty?: boolean;
  isStale?: boolean;
  formatValid?: boolean;
}): number {
  let score = conf.confidence;

  // Corroboration boost: 2+ distinct source kinds
  const uniqueKinds = new Set(conf.sources.map((s) => s.kind));
  if (uniqueKinds.size >= 2) {
    score = Math.min(0.98, score + 0.05);
  }

  // Penalties
  if (options?.isEmpty || conf.value === null || conf.value === undefined || conf.value === '') {
    score = Math.max(0, score - 0.15);
  }
  if (conf.isPlaceholder) {
    score = Math.max(0, score - 0.10);
  }
  if (options?.isStale) {
    score = Math.max(0, score - 0.10);
  }
  if (options?.formatValid === false) {
    score = Math.max(0, score - 0.10);
  }

  return Math.round(score * 100) / 100;
}

/**
 * Merge two Conf wrappers for the same field.
 * Higher confidence wins; sources are combined; corroboration boost applies.
 */
export function mergeConf<T>(a: Conf<T>, b: Conf<T>): Conf<T> {
  const primary = a.confidence >= b.confidence ? a : b;
  const allSources = [...a.sources, ...b.sources];

  // Deduplicate by kind+id
  const seen = new Set<string>();
  const uniqueSources = allSources.filter((s) => {
    const key = s.kind + ':' + (s.id ?? s.url ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Corroboration boost
  const uniqueKinds = new Set(uniqueSources.map((s) => s.kind));
  let confidence = primary.confidence;
  if (uniqueKinds.size >= 2) {
    confidence = Math.min(0.98, confidence + 0.05);
  }

  return {
    value: primary.value,
    confidence: Math.round(confidence * 100) / 100,
    sources: uniqueSources,
    rationale: primary.rationale ?? a.rationale ?? b.rationale,
    lastVerifiedAt: primary.lastVerifiedAt,
    isPlaceholder: primary.isPlaceholder && (a.confidence >= b.confidence ? b.isPlaceholder : a.isPlaceholder),
  };
}

/**
 * Compute aggregate confidence for an object with Conf-wrapped leaves.
 * Uses weighted mean of all leaf confidence values.
 */
export function computeAggregateConfidence(
  obj: Record<string, unknown>,
  weights?: Record<string, number>,
): number {
  const entries: Array<{ key: string; confidence: number }> = [];

  function walk(current: unknown, path: string): void {
    if (current && typeof current === 'object') {
      if ('confidence' in current && 'value' in current && 'sources' in current) {
        entries.push({ key: path, confidence: (current as Conf<unknown>).confidence });
        return;
      }
      if (Array.isArray(current)) {
        current.forEach((item, i) => walk(item, path + '[' + i + ']'));
        return;
      }
      for (const [k, v] of Object.entries(current)) {
        walk(v, path ? path + '.' + k : k);
      }
    }
  }

  walk(obj, '');

  if (entries.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const entry of entries) {
    const section = entry.key.split('.')[0];
    const w = weights?.[section] ?? 1;
    totalWeight += w;
    weightedSum += entry.confidence * w;
  }

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;
}

/** Default section weights for aggregate confidence. */
export const SECTION_WEIGHTS: Record<string, number> = {
  identity: 5,
  operations: 4,
  offerings: 3,
  trust: 3,
  brand: 2,
  marketing: 2,
  media: 1,
  seo: 2,
};
