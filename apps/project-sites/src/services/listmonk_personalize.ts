/**
 * @module services/listmonk_personalize
 * @description LM17 — per-recipient email personalization. A safe `{{ key }}` /
 * `{{ key | fallback }}` merge for transactional + campaign emails, plus the
 * mapper from our user/site signals to the flat `attribs` record Listmonk stores
 * per subscriber (consumed by Listmonk's Go templates at send time). Pure +
 * zero-I/O + XSS-safe (plain string substitution — never `eval`/code exec), with
 * a fallback for every missing variable so an email never ships a raw `{{ }}`.
 * Never throws.
 *
 * @packageDocumentation
 */

/** A flat, JSON-serializable attribute bag for one subscriber. */
export type SubscriberAttribs = Readonly<Record<string, string | number | boolean | null>>;

/** Signals we map into Listmonk subscriber attribs. */
export interface PersonalizeSignals {
  readonly firstName?: string | null;
  readonly plan?: string | null;
  readonly siteCount?: number | null;
  readonly lastSiteName?: string | null;
  readonly cohort?: string | null;
}

/**
 * Map our signals to the flat `attribs` record Listmonk stores per subscriber.
 * Drops null/undefined so Listmonk templates can `{{ if }}` on presence.
 *
 * @param signals - {@link PersonalizeSignals}.
 * @returns A flat {@link SubscriberAttribs} bag.
 *
 * @example
 * toSubscriberAttribs({ firstName: 'Vito', plan: 'pro', siteCount: 3 })
 * // → { first_name: 'Vito', plan: 'pro', site_count: 3 }
 */
export function toSubscriberAttribs(signals: PersonalizeSignals): SubscriberAttribs {
  const out: Record<string, string | number | boolean> = {};
  const name = signals.firstName?.trim();
  if (name) out.first_name = name;
  const plan = signals.plan?.trim();
  if (plan) out.plan = plan;
  if (typeof signals.siteCount === 'number' && Number.isFinite(signals.siteCount)) {
    out.site_count = signals.siteCount;
  }
  const lastSite = signals.lastSiteName?.trim();
  if (lastSite) out.last_site_name = lastSite;
  const cohort = signals.cohort?.trim();
  if (cohort) out.cohort = cohort;
  return out;
}

/** Coerce an attrib value to a display string ('' for null/undefined). */
function asText(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** A token's parsed key + inline default (after a `|`). */
function parseToken(inner: string): { key: string; inlineDefault: string | null } {
  const pipe = inner.indexOf('|');
  if (pipe === -1) return { key: inner.trim(), inlineDefault: null };
  return { key: inner.slice(0, pipe).trim(), inlineDefault: inner.slice(pipe + 1).trim() };
}

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Render a personalized string by substituting `{{ key }}` /
 * `{{ key | fallback }}` tokens from `vars`. Missing keys resolve to the inline
 * default, else `opts.fallback`, else `''` — never a leftover `{{ }}`.
 *
 * @param template - The template string.
 * @param vars - Variable bag (e.g. {@link SubscriberAttribs}).
 * @param opts - `fallback` for any var with no value + no inline default.
 * @returns The rendered string. Non-string template → `''`.
 *
 * @example
 * renderPersonalized('Hi {{ first_name | there }}!', {}) // → 'Hi there!'
 * renderPersonalized('Hi {{ first_name }}!', { first_name: 'Vito' }) // → 'Hi Vito!'
 */
export function renderPersonalized(
  template: string,
  vars: SubscriberAttribs,
  opts: { fallback?: string } = {},
): string {
  if (typeof template !== 'string') return '';
  const bag = vars && typeof vars === 'object' ? vars : {};
  const globalFallback = typeof opts.fallback === 'string' ? opts.fallback : '';
  return template.replace(TOKEN, (_m, inner: string) => {
    const { key, inlineDefault } = parseToken(inner);
    const resolved = asText(bag[key]);
    if (resolved !== null && resolved !== '') return resolved;
    return inlineDefault !== null ? inlineDefault : globalFallback;
  });
}

/**
 * Unique variable keys referenced in a template.
 *
 * @param template - The template string.
 * @returns Sorted unique keys (empty for a non-string template).
 *
 * @example
 * extractVars('{{ a }} {{ b | x }} {{ a }}') // → ['a', 'b']
 */
export function extractVars(template: string): string[] {
  if (typeof template !== 'string') return [];
  const keys = new Set<string>();
  for (const m of template.matchAll(TOKEN)) {
    const { key } = parseToken(m[1]);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Keys referenced in the template that have no value in `vars` AND no inline
 * default — i.e. would fall through to the global fallback.
 *
 * @param template - The template string.
 * @param vars - Variable bag.
 * @returns Sorted unique unresolved keys.
 */
export function missingVars(template: string, vars: SubscriberAttribs): string[] {
  if (typeof template !== 'string') return [];
  const bag = vars && typeof vars === 'object' ? vars : {};
  const missing = new Set<string>();
  for (const m of template.matchAll(TOKEN)) {
    const { key, inlineDefault } = parseToken(m[1]);
    if (!key || inlineDefault !== null) continue;
    const resolved = asText(bag[key]);
    if (resolved === null || resolved === '') missing.add(key);
  }
  return [...missing].sort();
}
