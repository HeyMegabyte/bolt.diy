/**
 * Email enrichment for the automatic Lead Scanner — derive a likely contact
 * email + a confidence-bearing {@link EmailSource} for a discovered business.
 * Feeds `lead_propensity.contactConfidence`. See top-14 #6.
 *
 * @remarks
 * `emailCandidatesForDomain`, `extractEmailDomain`, and `classifyEmailSource`
 * are PURE. `enrichEmail` is a thin, never-throw wrapper that reuses
 * `hasDeliverableMx` (DoH MX lookup) to upgrade a guessed candidate to
 * `guessed_mx` when the domain actually accepts mail.
 *
 * @packageDocumentation
 */

import type { EmailSource } from './lead_propensity.js';

/**
 * Strict MX check (fail-CLOSED) — a DNS error or empty answer returns false so a
 * guessed email is never over-credited to `guessed_mx`. (Distinct from
 * `email_deliverability.hasDeliverableMx`, which fails OPEN to avoid dropping
 * legitimate receipts — the opposite bias from what lead confidence wants.)
 */
async function domainAcceptsMail(fetchImpl: typeof fetch, domain: string): Promise<boolean> {
  try {
    const res = await fetchImpl(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: 'application/dns-json' } },
    );
    if (!res.ok) return false;
    const json = (await res.json().catch(() => ({}))) as { Status?: number; Answer?: unknown[] };
    if (json.Status === 3) return false; // NXDOMAIN
    return (json.Answer ?? []).length > 0;
  } catch {
    return false;
  }
}

/** Common business local-parts, best-first. */
const LOCAL_PARTS: readonly string[] = ['info', 'contact', 'hello', 'office', 'admin'];

/** Extract the domain from an email, or null if malformed. */
export function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return (
    email
      .slice(at + 1)
      .toLowerCase()
      .trim() || null
  );
}

/**
 * Generate ranked candidate emails for a known domain.
 *
 * @param domain - The business domain (no scheme), e.g. "joesplumbing.com".
 * @returns Candidate addresses, best-first; empty when domain is blank.
 *
 * @example
 * ```ts
 * emailCandidatesForDomain('acme.com'); // ['info@acme.com', 'contact@acme.com', ...]
 * ```
 */
export function emailCandidatesForDomain(domain: string | null | undefined): string[] {
  const d = domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!d || !d.includes('.')) return [];
  return LOCAL_PARTS.map((lp) => `${lp}@${d}`);
}

/**
 * Classify the provenance of an email into an {@link EmailSource}.
 *
 * @param opts - `fromListing` (email came from a directory listing),
 *   `mxValid` (the domain accepts mail), `guessed` (we synthesized it).
 * @returns The strongest applicable {@link EmailSource}.
 */
export function classifyEmailSource(opts: {
  fromListing?: boolean;
  mxValid?: boolean;
  guessed?: boolean;
}): EmailSource {
  if (opts.fromListing) return 'listing';
  if (opts.guessed) return opts.mxValid ? 'guessed_mx' : 'guessed';
  return null;
}

/** Result of an email enrichment attempt. */
export interface EmailEnrichment {
  email: string | null;
  source: EmailSource;
}

/**
 * Enrich a business with a likely email + confidence source. Never throws.
 *
 * @remarks
 * - A `listingEmail` (already known from a directory) wins → `listing`.
 * - Else, if a `domain` is known, synthesize `info@domain` and MX-verify it →
 *   `guessed_mx` (deliverable) or `guessed`.
 * - Else → `{ email: null, source: null }` (no reliable email).
 *
 * @param opts - `{ listingEmail?, domain? }`.
 * @param fetchImpl - Injectable fetch (tests pass a stub).
 * @returns An {@link EmailEnrichment}.
 */
export async function enrichEmail(
  opts: { listingEmail?: string | null; domain?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<EmailEnrichment> {
  if (opts.listingEmail && extractEmailDomain(opts.listingEmail)) {
    return { email: opts.listingEmail, source: 'listing' };
  }
  const candidates = emailCandidatesForDomain(opts.domain);
  if (candidates.length === 0) return { email: null, source: null };

  const domain = extractEmailDomain(candidates[0]);
  const mxValid = domain ? await domainAcceptsMail(fetchImpl, domain) : false;
  return { email: candidates[0], source: classifyEmailSource({ guessed: true, mxValid }) };
}
