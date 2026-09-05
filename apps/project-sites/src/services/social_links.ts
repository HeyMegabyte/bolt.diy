/**
 * Social + contact link discovery — the single source of truth for the Lead
 * Scanner's "capture website / phone / email / socials" enrichment (#9).
 *
 * @remarks
 * PURE module: no network, no D1, no clock — every function is a deterministic
 * transform over strings/tags, so the whole file is unit-testable with zero
 * mocks. The three inputs a lead's contact data can come from each get an
 * extractor here:
 *   - OSM `contact:*` / bare tags → {@link extractSocialsFromOsmTags}
 *   - a fetched homepage's HTML   → {@link extractSocialsFromHtml} / {@link extractContactFromHtml}
 *   - an arbitrary URL            → {@link detectNetworkFromUrl}
 *
 * `SOCIAL_NETWORKS` is the ordered canonical set (8) the UI renders icons for;
 * add a network here and both the backend extractors AND the admin table pick it
 * up (the frontend imports the same key list).
 *
 * @packageDocumentation
 */

/** A social/contact network the scanner captures + the admin table renders. */
export interface SocialNetwork {
  /** Stable key — the object key in a lead's `socials` map + the FE icon id. */
  key: string;
  /** Human label (aria-label / tooltip). */
  label: string;
  /** Hostname fragments that identify a URL as this network (lowercased). */
  domains: readonly string[];
  /** OSM tag keys that carry this network's handle/URL (priority order). */
  osmTags: readonly string[];
  /** Base URL used to expand a bare `@handle` into a full profile URL. */
  handleBase?: string;
}

/**
 * The canonical 8 networks, in render order. Facebook/Instagram/X first (the
 * core small-business set), then LinkedIn/YouTube/TikTok, then the
 * review/listing platforms Yelp + Google Business (strong local-lead signals).
 */
export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  {
    key: 'facebook',
    label: 'Facebook',
    domains: ['facebook.com', 'fb.com', 'fb.me'],
    osmTags: ['contact:facebook', 'facebook'],
    handleBase: 'https://facebook.com/',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    domains: ['instagram.com', 'instagr.am'],
    osmTags: ['contact:instagram', 'instagram'],
    handleBase: 'https://instagram.com/',
  },
  {
    key: 'x',
    label: 'X (Twitter)',
    domains: ['x.com', 'twitter.com'],
    osmTags: ['contact:x', 'contact:twitter', 'twitter'],
    handleBase: 'https://x.com/',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    domains: ['linkedin.com', 'lnkd.in'],
    osmTags: ['contact:linkedin', 'linkedin'],
  },
  {
    key: 'youtube',
    label: 'YouTube',
    domains: ['youtube.com', 'youtu.be'],
    osmTags: ['contact:youtube', 'youtube'],
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    domains: ['tiktok.com'],
    osmTags: ['contact:tiktok', 'tiktok'],
    handleBase: 'https://tiktok.com/@',
  },
  {
    key: 'yelp',
    label: 'Yelp',
    domains: ['yelp.com', 'yelp.to'],
    osmTags: ['contact:yelp', 'yelp'],
  },
  {
    key: 'google',
    label: 'Google Business',
    domains: ['business.google.com', 'g.page', 'maps.google.com', 'goo.gl/maps'],
    osmTags: ['contact:google_plus', 'contact:google'],
  },
];

/** The ordered network keys — imported by the admin table for its icon columns. */
export const SOCIAL_NETWORK_KEYS: readonly string[] = SOCIAL_NETWORKS.map((n) => n.key);

/** A captured contact bundle for a lead. All fields optional (best-effort). */
export interface ContactBundle {
  website?: string;
  phone?: string;
  email?: string;
  /** network-key → profile URL. */
  socials?: Record<string, string>;
}

/** True when the string looks like an http(s) URL. */
function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Lowercased hostname of a URL, or '' when unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(isHttpUrl(url) ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Identify which {@link SOCIAL_NETWORKS} network a URL belongs to, by hostname.
 *
 * @param url - Any URL or bare host.
 * @returns The network key (e.g. `'instagram'`), or null when it matches none.
 * @example
 * detectNetworkFromUrl('https://www.instagram.com/vitos'); // 'instagram'
 * detectNetworkFromUrl('https://vitos.com');               // null
 */
export function detectNetworkFromUrl(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const net of SOCIAL_NETWORKS) {
    if (net.domains.some((d) => host === d || host.endsWith(`.${d}`))) return net.key;
  }
  return null;
}

/**
 * Normalize an OSM tag value (may be a bare `@handle`, a `handle`, or a full URL)
 * into a full profile URL for the given network.
 *
 * @param net - The target network.
 * @param raw - The tag value.
 * @returns A full https URL, or undefined when the value is empty.
 * @example
 * normalizeSocialValue(SOCIAL_NETWORKS[0], 'vitossalon'); // 'https://facebook.com/vitossalon'
 * normalizeSocialValue(SOCIAL_NETWORKS[0], 'https://facebook.com/x'); // unchanged
 */
export function normalizeSocialValue(net: SocialNetwork, raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (isHttpUrl(v)) return v;
  // Bare host without scheme (e.g. "facebook.com/x") → add https.
  if (net.domains.some((d) => v.toLowerCase().startsWith(d))) return `https://${v}`;
  // Bare handle → expand against the network's base when we have one.
  if (net.handleBase) return net.handleBase + v.replace(/^@/, '');
  return `https://${net.domains[0]}/${v.replace(/^@/, '')}`;
}

/**
 * Extract every social profile a set of OSM tags advertises.
 *
 * @param tags - The raw OSM `tags` object (may be undefined).
 * @returns network-key → full URL (empty object when none present).
 * @example
 * extractSocialsFromOsmTags({ 'contact:facebook': 'vitos' });
 * // { facebook: 'https://facebook.com/vitos' }
 */
export function extractSocialsFromOsmTags(
  tags: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tags) return out;
  for (const net of SOCIAL_NETWORKS) {
    if (out[net.key]) continue;
    for (const tagKey of net.osmTags) {
      const raw = tags[tagKey];
      if (raw && raw.trim()) {
        const url = normalizeSocialValue(net, raw);
        if (url) {
          out[net.key] = url;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Scan a homepage's HTML for outbound social profile links.
 *
 * @param html - Raw HTML (any length; only href attributes are read).
 * @returns network-key → first matching URL found (empty object when none).
 * @example
 * extractSocialsFromHtml('<a href="https://instagram.com/vitos">IG</a>');
 * // { instagram: 'https://instagram.com/vitos' }
 */
export function extractSocialsFromHtml(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!html) return out;
  const hrefs = html.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
  for (const href of hrefs) {
    const net = detectNetworkFromUrl(href);
    if (net && !out[net]) {
      // Trim trailing punctuation that regexes commonly capture.
      out[net] = href.replace(/[)"'.,]+$/, '');
    }
  }
  return out;
}

/**
 * Extract the first `mailto:` email + `tel:` phone from a homepage's HTML.
 *
 * @param html - Raw HTML.
 * @returns `{ email?, phone? }` (best-effort; either may be absent).
 * @example
 * extractContactFromHtml('<a href="mailto:hi@x.com">'); // { email: 'hi@x.com' }
 */
export function extractContactFromHtml(html: string): { email?: string; phone?: string } {
  const out: { email?: string; phone?: string } = {};
  if (!html) return out;
  const mail = html.match(/mailto:([^"'?\s<>]+@[^"'?\s<>]+)/i);
  if (mail?.[1]) out.email = mail[1].trim();
  else {
    const bare = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (bare?.[0]) out.email = bare[0].trim();
  }
  const tel = html.match(/tel:([+0-9().\s-]{7,})/i);
  if (tel?.[1]) out.phone = tel[1].trim();
  return out;
}

/**
 * Merge several {@link ContactBundle}s, first-non-empty wins per field (earlier
 * sources are higher-confidence). Socials union across all sources.
 *
 * @param bundles - Bundles in priority order (highest first).
 * @returns One merged bundle.
 */
export function mergeContactBundles(...bundles: (ContactBundle | undefined)[]): ContactBundle {
  const out: ContactBundle = {};
  const socials: Record<string, string> = {};
  for (const b of bundles) {
    if (!b) continue;
    if (!out.website && b.website) out.website = b.website;
    if (!out.phone && b.phone) out.phone = b.phone;
    if (!out.email && b.email) out.email = b.email;
    for (const [k, v] of Object.entries(b.socials ?? {})) {
      if (!socials[k] && v) socials[k] = v;
    }
  }
  if (Object.keys(socials).length > 0) out.socials = socials;
  return out;
}
