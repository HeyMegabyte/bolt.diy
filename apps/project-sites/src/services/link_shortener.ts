/**
 * @module services/link_shortener
 * @description Automatic UTM tagging + link shortening for social posts.
 *
 * At publish time every outbound URL in a post is, in the background:
 *   1. UTM-tagged (`utm_source` / `utm_medium=social` / `utm_campaign=<post_id>`)
 *      so clicks attribute back to the post in the customer site's analytics, and
 *   2. shortened to a `linkbl.ink/<slug>` link via the self-hosted Dub instance
 *      (`app.claimyour.site`) so the link is clean AND click-trackable.
 *
 * The user never sees or sets any of this — it happens automatically. Everything
 * is FAIL-SOFT: if `DUB_API_KEY` is unset or Dub errors, the (UTM-tagged) long
 * URL is used unchanged, so posting never breaks waiting on the shortener.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

/** Default Dub API base (self-hosted instance at app.claimyour.site). */
const DEFAULT_DUB_API_BASE = 'https://app.claimyour.site/api';

/** Default short-link domain registered in the Dub instance. */
const DEFAULT_LINKBL_DOMAIN = 'linkbl.ink';

/** Realistic browser UA per fetch-defaults (Dub sits behind Cloudflare). */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

/** UTM parameters appended to a tracked link. */
export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
}

/**
 * Append UTM parameters to a URL without clobbering existing query params or an
 * already-present `utm_*` key. PURE + deterministic.
 *
 * @param url - the raw URL (must be http/https; anything else is returned as-is)
 * @param utm - {@link UtmParams}
 * @returns the URL with utm_source/medium/campaign added (existing utm_* kept)
 *
 * @example
 * addUtm('https://shop.example.com/x?a=1', { source: 'facebook', medium: 'social', campaign: 'p1' })
 * // → 'https://shop.example.com/x?a=1&utm_source=facebook&utm_medium=social&utm_campaign=p1'
 */
export function addUtm(url: string, utm: UtmParams): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url; // not an absolute URL — leave it alone
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  const set = (k: string, v: string): void => {
    if (!u.searchParams.has(k) && v) u.searchParams.set(k, v);
  };
  set('utm_source', utm.source);
  set('utm_medium', utm.medium);
  set('utm_campaign', utm.campaign);
  return u.toString();
}

/** Match http/https URLs in free text (no trailing punctuation). */
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/**
 * Extract distinct http/https URLs from a string. PURE.
 *
 * @param text - free-form post text
 * @returns the unique URLs found, in first-seen order
 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,!?]+$/, ''); // strip trailing sentence punctuation
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * Shorten one long URL via the Dub API on the `linkbl.ink` domain. FAIL-SOFT:
 * returns `longUrl` unchanged when `DUB_API_KEY` is unset or Dub errors.
 *
 * @param env - Worker env (reads DUB_API_KEY, optional DUB_API_BASE, LINKBL_DOMAIN)
 * @param longUrl - the (already UTM-tagged) destination URL
 * @returns the `linkbl.ink/<slug>` short link, or `longUrl` on any failure
 *
 * @remarks Impure — calls the Dub HTTP API. Never throws.
 */
export async function shortenViaDub(env: Env, longUrl: string): Promise<string> {
  const key = env.DUB_API_KEY;
  if (!key) return longUrl; // not configured → fail-soft
  const base = (env.DUB_API_BASE ?? DEFAULT_DUB_API_BASE).replace(/\/$/, '');
  const domain = env.LINKBL_DOMAIN ?? DEFAULT_LINKBL_DOMAIN;
  try {
    const res = await fetch(`${base}/links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({ url: longUrl, domain }),
    });
    if (!res.ok) return longUrl;
    const data = (await res.json().catch(() => null)) as { shortLink?: string } | null;
    return typeof data?.shortLink === 'string' && data.shortLink.length > 0 ? data.shortLink : longUrl;
  } catch {
    return longUrl;
  }
}

/** A post's text + link fields after UTM tagging + shortening. */
export interface ProcessedPostLinks {
  content: string;
  link: string | null;
  /** How many distinct URLs were shortened (0 when fail-soft / no links). */
  shortened: number;
}

/**
 * Apply UTM tags + linkbl.ink shortening to every URL in a post's content and
 * its `link` field. Background step at publish time — fail-soft throughout.
 *
 * @param env - Worker env
 * @param input - `{ content, link, postId, platform }`
 * @returns {@link ProcessedPostLinks} with rewritten content/link + a count
 *
 * @remarks Impure — calls {@link shortenViaDub} per URL. Never throws.
 */
export async function processPostLinks(
  env: Env,
  input: { content: string; link: string | null; postId: string; platform: string },
): Promise<ProcessedPostLinks> {
  const utm: UtmParams = {
    source: input.platform || 'social',
    medium: 'social',
    campaign: input.postId,
  };

  // Build a map of original-URL → shortened(UTM-tagged) for content URLs + link.
  const originals = new Set(extractUrls(input.content));
  if (input.link) originals.add(input.link);

  const replacements = new Map<string, string>();
  let shortened = 0;
  for (const orig of originals) {
    const tagged = addUtm(orig, utm);
    const short = await shortenViaDub(env, tagged);
    if (short !== tagged || tagged !== orig) {
      // Count only when Dub actually shortened (short differs from the tagged URL).
      if (short !== tagged) shortened++;
    }
    replacements.set(orig, short);
  }

  let content = input.content;
  for (const [orig, short] of replacements) {
    content = content.split(orig).join(short);
  }
  const link = input.link ? (replacements.get(input.link) ?? input.link) : null;

  return { content, link, shortened };
}
