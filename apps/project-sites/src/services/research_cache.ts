/**
 * @module services/research_cache
 * @description Per-business research/brand/asset cache (#19c margin lever).
 *
 * Re-researching the same business on every rebuild burns LLM + external-API
 * spend and ~10 min of wall time. Keying research output by stable business
 * identity lets a rebuild SKIP re-research (~15→5 min). This module owns the
 * pure cache-KEY derivation (the tricky part — it must be stable + collision-free
 * across rebuilds of the same business) plus a thin KV get/set. The research
 * orchestration calls `getCachedResearch` before researching and
 * `putCachedResearch` after — that wiring is the integration step.
 */
import type { Env } from '../types/env.js';

/** Stable identity inputs for a business (most-authoritative first). */
export interface BusinessIdentity {
  /** Google Place ID — the most stable identity when present. */
  placeId?: string | null;
  /** Business website — domain is a strong stable key. */
  website?: string | null;
  /** Business name (always present). */
  name: string;
  /** Postal address — disambiguates same-named businesses. */
  address?: string | null;
}

/** Default cache TTL — 30 days (re-research monthly to catch real-world drift). */
export const RESEARCH_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Extract a bare hostname (no scheme, no `www.`, lowercased) from a URL-ish string. */
export function extractDomain(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, '');
  return host || null;
}

/**
 * Derive the stable per-business research cache key. Pure + synchronous.
 *
 * @remarks Precedence: Place ID → website domain → normalized name+address. The
 * same business resolves to the same key across rebuilds; two different businesses
 * never collide (different identity → different key).
 * @example
 * researchCacheKey({ placeId: 'ChIJ…', name: 'X' }); // 'research:v1:place:ChIJ…'
 */
export function researchCacheKey(input: BusinessIdentity): string {
  const placeId = input.placeId?.trim();
  if (placeId) return `research:v1:place:${placeId}`;

  const domain = input.website ? extractDomain(input.website) : null;
  if (domain) return `research:v1:domain:${domain}`;

  // Normalize each part independently (trim + collapse + lowercase) BEFORE joining,
  // so a stray trailing space on `name` can't leak a space before the `|` separator
  // and produce a different key for the same business.
  const normPart = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const norm = `${normPart(input.name)}|${normPart(input.address ?? '')}`;
  return `research:v1:name:${encodeURIComponent(norm)}`;
}

/**
 * Read cached research for a business. Returns `null` on miss or any KV error
 * (a cache miss must never break a build).
 */
export async function getCachedResearch<T = unknown>(
  env: Env,
  key: string,
): Promise<T | null> {
  try {
    return (await env.CACHE_KV.get(key, 'json')) as T | null;
  } catch {
    return null;
  }
}

/**
 * Write research to the cache (best-effort — a failed write never breaks a build).
 *
 * @param ttlSeconds - Override the default 30-day TTL.
 */
export async function putCachedResearch(
  env: Env,
  key: string,
  data: unknown,
  ttlSeconds: number = RESEARCH_CACHE_TTL_SECONDS,
): Promise<void> {
  try {
    await env.CACHE_KV.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
  } catch {
    // best-effort cache write
  }
}
