/**
 * @module libs/features/visitor_events_core/enrich
 * @description Pure, dependency-free visitor enrichment for the ingest path
 * (AN1). Parses a User-Agent into device/browser/OS, parses UTM params from the
 * event URL, and derives a marketing channel from referrer + UTM. The result is
 * folded into the event's `metadata` JSON (no schema migration) so the owner
 * dashboard can later split traffic by device/browser/channel (AN10/AN13).
 *
 * Deliberately lightweight heuristics — good enough for a small-business owner
 * dashboard, never a fingerprinting surface. All functions are pure.
 *
 * @packageDocumentation
 */

export type Device = 'mobile' | 'tablet' | 'desktop';
export type Channel = 'direct' | 'organic' | 'social' | 'paid' | 'email' | 'referral';

export interface VisitorEnrichment {
  device: Device;
  browser: string;
  os: string;
  channel: Channel;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/** Hosts (substring match on the referrer hostname) that count as organic search. */
const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.', 'baidu.', 'yandex.'];
/** Hosts that count as social. `t.co` = Twitter/X link wrapper; `lnkd.in` = LinkedIn. */
const SOCIAL_HOSTS = [
  'instagram.',
  'facebook.',
  'fb.',
  'twitter.',
  'x.com',
  't.co',
  'linkedin.',
  'lnkd.in',
  'tiktok.',
  'youtube.',
  'youtu.be',
  'pinterest.',
  'reddit.',
  'threads.',
];

/**
 * Classify a User-Agent into device / browser / OS via ordered heuristics.
 *
 * @param ua - the raw `User-Agent` header (empty string tolerated).
 * @returns `{ device, browser, os }` — each defaults to `'unknown'`/`'desktop'`.
 * @example parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_2…) Safari') // → { device:'mobile', browser:'Safari', os:'iOS' }
 */
export function parseUserAgent(ua: string): { device: Device; browser: string; os: string } {
  const s = ua || '';

  // OS — order matters (iOS/Android before generic Mac/Linux).
  let os = 'unknown';
  if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';

  // Device — tablet before mobile (iPad reports no "Mobile"); Android w/o "Mobile" = tablet.
  let device: Device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk/.test(s) || (/Android/.test(s) && !/Mobile/.test(s)))
    device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/.test(s)) device = 'mobile';

  // Browser — order matters (Edge/Opera ship "Chrome" in their UA; Safari only if not Chrome).
  let browser = 'unknown';
  if (/Edg[A-Z/]/.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  return { device, browser, os };
}

/**
 * Pull `utm_source` / `utm_medium` / `utm_campaign` from a full event URL.
 *
 * @param url - the page URL (may include a query string) or just `?a=b`.
 * @returns lowercased, length-capped UTM fields (absent keys omitted).
 * @example parseUtm('https://x.com/?utm_source=Instagram&utm_medium=cpc') // → { utmSource:'instagram', utmMedium:'cpc' }
 */
export function parseUtm(url: string): {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
} {
  const q = (url || '').split('?')[1];
  if (!q) return {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(q);
  } catch {
    return {};
  }
  const pick = (k: string): string | undefined => {
    const v = params.get(k);
    return v ? v.toLowerCase().slice(0, 120) : undefined;
  };
  const out: { utmSource?: string; utmMedium?: string; utmCampaign?: string } = {};
  const source = pick('utm_source');
  const medium = pick('utm_medium');
  const campaign = pick('utm_campaign');
  if (source) out.utmSource = source;
  if (medium) out.utmMedium = medium;
  if (campaign) out.utmCampaign = campaign;
  return out;
}

/**
 * Derive the marketing channel from UTM medium + referrer. UTM wins when present.
 *
 * @param referrer - the `Referer` header (may be empty/undefined).
 * @param utmMedium - a parsed `utm_medium`, if any.
 * @returns one of {@link Channel}.
 * @example deriveChannel('https://www.google.com/search?q=x') // → 'organic'
 * @example deriveChannel('', 'cpc') // → 'paid'
 */
export function deriveChannel(referrer?: string, utmMedium?: string): Channel {
  if (utmMedium) {
    const m = utmMedium.toLowerCase();
    if (/cpc|ppc|paid|cpm|display|paidsearch|paid-search/.test(m)) return 'paid';
    if (/social|social-network|sm/.test(m)) return 'social';
    if (/email|newsletter|e-mail/.test(m)) return 'email';
    if (/referral/.test(m)) return 'referral';
    if (/organic/.test(m)) return 'organic';
  }
  if (!referrer) return 'direct';
  let host = '';
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'referral';
  }
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return 'organic';
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return 'social';
  return 'referral';
}

/**
 * Full enrichment for one visitor event — folded into the event `metadata` JSON.
 *
 * @param ua - User-Agent header.
 * @param referrer - Referer header.
 * @param url - the full event URL (for UTM extraction); pass the path+query.
 * @returns a {@link VisitorEnrichment} (UTM fields omitted when absent).
 * @example enrichVisitor('…iPhone… Safari', 'https://instagram.com/', '/?utm_medium=social')
 *   // → { device:'mobile', browser:'Safari', os:'iOS', channel:'social', utmMedium:'social' }
 */
export function enrichVisitor(ua: string, referrer?: string, url?: string): VisitorEnrichment {
  const { device, browser, os } = parseUserAgent(ua);
  const utm = parseUtm(url ?? '');
  const channel = deriveChannel(referrer, utm.utmMedium);
  return { device, browser, os, channel, ...utm };
}
