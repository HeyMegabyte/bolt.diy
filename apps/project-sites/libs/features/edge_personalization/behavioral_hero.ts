/**
 * @module libs/features/edge_personalization/behavioral_hero
 *
 * Behavioral Hero — visitor-aware hero content personalization.
 *
 * Detects visitor context from request signals and maps to hero variants.
 * Pure signal extraction + content mapping — zero I/O, deterministic.
 * The edge injection layer (site_serving.ts) calls this to resolve which
 * hero to serve, then injects the appropriate content before the CDN cache.
 *
 * Visitor contexts detected:
 * - first_visit  → welcoming overview, business introduction
 * - returning    → what's new, latest offers
 * - search       → reinforces the search intent (product/service match)
 * - social       → social-proof-heavy, testimonials
 * - local        → location-specific, "serving {city}"
 * - direct       → brand-focused, trust signals
 */
import type { PersonalizationSignals } from './schemas.js';

// ── Visitor context detection ───────────────────────────────────────────────

export type VisitorContext =
  | 'first_visit'
  | 'returning'
  | 'search'
  | 'social'
  | 'local'
  | 'direct';

const SEARCH_ENGINES = [
  'google.',
  'bing.',
  'duckduckgo.',
  'yahoo.',
  'baidu.',
  'yandex.',
];

const SOCIAL_PLATFORMS = [
  'facebook.',
  'instagram.',
  'twitter.',
  'x.com',
  'linkedin.',
  'pinterest.',
  'tiktok.',
  'reddit.',
  'threads.',
];

/**
 * Detects the visitor context from request signals.
 *
 * Priority: search > social > returning > local > first_visit > direct.
 * The first matching signal wins.
 */
export function detectVisitorContext(signals: PersonalizationSignals): VisitorContext {
  // 1. Search engine referrer → reinforce search intent
  if (signals.referrer && SEARCH_ENGINES.some((e) => signals.referrer!.includes(e))) {
    return 'search';
  }

  // 2. Social media referrer → social-proof hero
  if (signals.referrer && SOCIAL_PLATFORMS.some((p) => signals.referrer!.includes(p))) {
    return 'social';
  }

  // 3. Returning visitor (has cookie or visited before)
  if (signals.isReturn) {
    return 'returning';
  }

  // 4. Geo-targeted (has location)
  if (signals.geo) {
    return 'local';
  }

  // 5. First visit (no cookie, no referrer hints)
  if (!signals.isReturn && !signals.referrer) {
    return 'first_visit';
  }

  // 6. Direct (has referrer but not search/social)
  return 'direct';
}

// ── Hero variant content ────────────────────────────────────────────────────

export interface HeroVariant {
  context: VisitorContext;
  headline: string;
  subheadline: string;
  cta: string;
  ctaUrl: string;
  imageHint: string;
  trustBadge: string | null;
}

/**
 * Maps a visitor context + business info to a hero variant.
 *
 * Each variant has a distinct psychological frame:
 * - first_visit: "Who are these people?" — establish identity + trust
 * - returning: "What's new?" — freshness, recency
 * - search: "Is this what I'm looking for?" — relevance confirmation
 * - social: "Do others trust them?" — social proof
 * - local: "Are they near me?" — proximity
 * - direct: "Are they legit?" — brand authority
 */
export function resolveHeroVariant(
  context: VisitorContext,
  business: { name: string; tagline: string; city?: string; reviewCount?: number; rating?: number },
): HeroVariant {
  const { name, tagline, city, reviewCount, rating } = business;

  switch (context) {
    case 'search':
      return {
        context: 'search',
        headline: `${name} — ${tagline}`,
        subheadline: `Looking for ${tagline.toLowerCase()}? You are in the right place. Explore our services, read reviews, and see why customers choose ${name}.`,
        cta: 'See Our Services',
        ctaUrl: '#services',
        imageHint: `${name} service showcase, clean professional lighting`,
        trustBadge: rating ? `${rating} ★ (${reviewCount ?? 'many'} reviews)` : null,
      };

    case 'social':
      return {
        context: 'social',
        headline: `Join Thousands Who Love ${name}`,
        subheadline: rating
          ? `Rated ${rating} stars by ${reviewCount ?? 'our'} customers. See what everyone is talking about.`
          : `Discover why customers rave about ${name}. Real stories, real satisfaction.`,
        cta: 'Read Our Reviews',
        ctaUrl: '#reviews',
        imageHint: `${name} happy customers, candid authentic moments, warm tones`,
        trustBadge: rating ? `${rating} ★ (${reviewCount ?? 'many'} reviews)` : 'Trusted by the community',
      };

    case 'returning':
      return {
        context: 'returning',
        headline: `Welcome Back to ${name}`,
        subheadline: 'See what is new since your last visit. New services, seasonal specials, and fresh content — all here for you.',
        cta: "What's New",
        ctaUrl: '#latest',
        imageHint: `${name} latest offerings, fresh and modern presentation`,
        trustBadge: null,
      };

    case 'local':
      return {
        context: 'local',
        headline: `${name} — Proudly Serving ${city || 'Your Community'}`,
        subheadline: city
          ? `Located right here in ${city}. Stop by today or call us — we would love to meet our neighbors.`
          : `Your neighborhood ${name}. Local, trusted, and here when you need us.`,
        cta: 'Get Directions',
        ctaUrl: '#location',
        imageHint: `${name} storefront exterior, ${city || 'local neighborhood'} setting, welcoming entrance`,
        trustBadge: city ? `📍 ${city}` : null,
      };

    case 'first_visit':
      return {
        context: 'first_visit',
        headline: `${name} — ${tagline}`,
        subheadline: `Welcome! We are ${name}, ${tagline.toLowerCase()}. Explore what we offer, meet our team, and see why we are the trusted choice.`,
        cta: 'Learn More',
        ctaUrl: '#about',
        imageHint: `${name} hero shot, warm and inviting, professional quality`,
        trustBadge: rating ? `${rating} ★ Rated` : 'Established & Trusted',
      };

    case 'direct':
    default:
      return {
        context: 'direct',
        headline: `${name}`,
        subheadline: tagline,
        cta: 'Get Started',
        ctaUrl: '#services',
        imageHint: `${name} brand hero, bold and confident`,
        trustBadge: null,
      };
  }
}

// ── Full hero resolution (detect + map) ─────────────────────────────────────

export interface ResolvedHero {
  variant: HeroVariant;
  context: VisitorContext;
}

/**
 * Full behavioral hero resolution: detect visitor context → map to hero variant.
 * Called by the edge injection layer on every page request.
 */
export function resolveHero(
  signals: PersonalizationSignals,
  business: { name: string; tagline: string; city?: string; reviewCount?: number; rating?: number },
): ResolvedHero {
  const context = detectVisitorContext(signals);
  const variant = resolveHeroVariant(context, business);
  return { variant, context };
}
