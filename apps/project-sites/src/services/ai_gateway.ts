/**
 * @module services/ai_gateway
 * @description Cloudflare AI Gateway routing for external LLM providers.
 *
 * Gateway is the DEFAULT path (caching is infrastructure, on by default with a
 * safe direct-vendor fallback on gateway 5xx so generation never breaks). Gives
 * universal response caching, rate-limiting, request logs, cost attribution, and
 * metadata-tagged traces for free. Callers get cache-TTL injection, per-call
 * skip-cache, and metadata tagging.
 *
 * URL shape: `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayName}/{provider}{pathSuffix}`
 *
 * Cache + metadata headers (AI Gateway native):
 * - `cf-aig-cache-ttl: <seconds>` — cache the response for N seconds.
 * - `cf-aig-skip-cache: true` — bypass the cache (non-deterministic / per-user calls).
 * - `cf-aig-metadata: <json>` — tags (orgId, promptId, traceId) surfaced in the dashboard.
 *
 * @see https://developers.cloudflare.com/ai-gateway/configuration/caching/
 * @see https://developers.cloudflare.com/ai-gateway/configuration/custom-metadata/
 * @packageDocumentation
 */

import { z } from 'zod';
import type { Env } from '../types/env.js';
import { log } from '../lib/log.js';

const gatewayLog = log.child('ai_gateway');

export type GatewayProvider = 'fable' | 'openai' | 'kimi' | 'anthropic' | 'deepseek';

export const DEFAULT_GATEWAY_NAME = 'projectsites';

/** Default cache TTL (seconds) applied when a caller does not pass `cacheTtl`. */
export const DEFAULT_CACHE_TTL_SECONDS = 3600;

/** Direct vendor base URLs — the fallback target when the gateway errors. */
const DIRECT_BASE_URLS: Record<GatewayProvider, string> = {
  fable: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  kimi: 'https://api.moonshot.ai',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
};

/** Exported for unit tests that need to assert DeepSeek's base URL. */
export const DIRECT_BASE_URLS_EXPORT: Record<GatewayProvider, string> = DIRECT_BASE_URLS;

/**
 * @remarks
 * Validated at the boundary so a malformed `cacheTtl` (negative, NaN, absurdly
 * large) can never reach the wire as a bogus `cf-aig-cache-ttl` header. Unknown
 * keys are stripped to keep the metadata surface tight.
 */
export const GatewayCallOptionsSchema = z
  .object({
    /**
     * `cf-aig-cache-ttl` seconds. `0` disables caching for the call without
     * skipping a cache READ; prefer `skipCache` to bypass entirely. Capped at
     * 31 days (Cloudflare's documented max).
     */
    cacheTtl: z.number().int().min(0).max(2_678_400).optional(),
    /** When `true`, send `cf-aig-skip-cache: true` so the call bypasses the cache. */
    skipCache: z.boolean().optional(),
    /**
     * Dashboard metadata tags. String / number / boolean values only
     * (Cloudflare flattens richer shapes).
     */
    metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

export type GatewayCallOptions = z.infer<typeof GatewayCallOptionsSchema>;

/**
 * @remarks
 * Gateway is the DEFAULT path: active whenever `CF_ACCOUNT_ID` is present AND
 * `AI_GATEWAY_ENABLED` is not the string `"false"`. This inverts the legacy
 * opt-in (`=== "true"`) so caching is on by default; set `AI_GATEWAY_ENABLED =
 * "false"` to bypass during incident response. No account id → routing inactive,
 * callers fall back to the direct vendor URL, generation never breaks.
 */
export function isGatewayActive(env: Env): boolean {
  return !!env.CF_ACCOUNT_ID && env.AI_GATEWAY_ENABLED !== 'false';
}

export function gatewayName(env: Env): string {
  const name = env.AI_GATEWAY_NAME?.trim();
  return name && name.length > 0 ? name : DEFAULT_GATEWAY_NAME;
}

/**
 * Base URL for a provider — gateway URL when active, else the direct vendor base.
 * Returns a URL WITHOUT trailing slash and WITHOUT the vendor path suffix.
 */
export function gatewayBaseUrl(env: Env, provider: GatewayProvider): string {
  if (isGatewayActive(env)) {
    return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${gatewayName(env)}/${provider}`;
  }
  return DIRECT_BASE_URLS[provider];
}

export function gatewayUrl(env: Env, provider: GatewayProvider, pathSuffix: string): string {
  return `${gatewayBaseUrl(env, provider)}${pathSuffix}`;
}

/**
 * Merge AI Gateway cache + metadata headers onto a base header set.
 *
 * @remarks
 * Headers are ONLY added when the gateway is active. `cacheTtl` defaults to
 * {@link DEFAULT_CACHE_TTL_SECONDS} when neither `cacheTtl` nor `skipCache` is
 * supplied, so caching is on by default. `skipCache` wins over `cacheTtl`.
 */
export function buildGatewayHeaders(
  env: Env,
  baseHeaders: Record<string, string>,
  options: GatewayCallOptions = {},
): Headers {
  const headers = new Headers(baseHeaders);
  if (!isGatewayActive(env)) return headers;

  if (options.skipCache) {
    headers.set('cf-aig-skip-cache', 'true');
  } else {
    const ttl = options.cacheTtl ?? DEFAULT_CACHE_TTL_SECONDS;
    headers.set('cf-aig-cache-ttl', String(ttl));
  }

  if (options.metadata && Object.keys(options.metadata).length > 0) {
    headers.set('cf-aig-metadata', JSON.stringify(options.metadata));
  }

  return headers;
}

export interface GatewayFetchResult {
  response: Response;
  /** `true` when the successful response came through the gateway, not the direct fallback. */
  gatewayUsed: boolean;
}

/**
 * Fetch a provider endpoint through the AI Gateway with cache headers + a
 * direct-vendor fallback on gateway 5xx.
 *
 * @remarks
 * On a 5xx from the gateway (its OWN error, not a vendor 4xx passed through), retry
 * ONCE against the direct vendor URL with `X-PS-Gateway-Fallback: true` for log
 * filtering, stripping the `cf-aig-*` headers. The vendor auth headers in
 * `init.headers` are reused for the fallback — valid against the direct URL because
 * the gateway proxies them verbatim.
 *
 * @throws ZodError when `options` fails validation.
 */
export async function gatewayFetch(
  env: Env,
  provider: GatewayProvider,
  pathSuffix: string,
  init: RequestInit,
  options: GatewayCallOptions = {},
): Promise<GatewayFetchResult> {
  const opts = GatewayCallOptionsSchema.parse(options);
  const active = isGatewayActive(env);

  const baseHeaders = headersToRecord(init.headers);
  const mergedHeaders = buildGatewayHeaders(env, baseHeaders, opts);

  const primaryUrl = gatewayUrl(env, provider, pathSuffix);
  const response = await fetch(primaryUrl, { ...init, headers: mergedHeaders });

  // Only fall back when the gateway ITSELF 5xx'd. A 4xx is a real vendor error
  // (bad key, malformed body) that the direct URL would also reject — surface it.
  if (active && response.status >= 500 && response.status < 600) {
    gatewayLog.warn('gateway_5xx_fallback', { provider, status: response.status });
    const directUrl = `${DIRECT_BASE_URLS[provider]}${pathSuffix}`;
    const fallbackHeaders = new Headers(baseHeaders);
    fallbackHeaders.set('X-PS-Gateway-Fallback', 'true');
    const fallbackRes = await fetch(directUrl, { ...init, headers: fallbackHeaders });
    return { response: fallbackRes, gatewayUsed: false };
  }

  return { response, gatewayUsed: active };
}

/** Normalize a `HeadersInit` (Headers | Record | tuple array) into a plain record. */
function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const record: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) record[key] = value;
  } else {
    Object.assign(record, headers);
  }
  return record;
}

/**
 * Build the `cf-aig-metadata` tag object from a trace context. Drops `undefined`
 * values so the metadata header stays compact.
 */
export function gatewayMetadata(ctx?: {
  orgId?: string;
  userId?: string;
  traceId?: string;
  promptId?: string;
}): Record<string, string> {
  const meta: Record<string, string> = {};
  if (!ctx) return meta;
  if (ctx.orgId) meta.orgId = ctx.orgId;
  if (ctx.userId) meta.userId = ctx.userId;
  if (ctx.traceId) meta.traceId = ctx.traceId;
  if (ctx.promptId) meta.promptId = ctx.promptId;
  return meta;
}
