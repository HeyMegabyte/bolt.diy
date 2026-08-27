/**
 * Signed per-site capability manifest (Cloudflare-first doctrine §3).
 *
 * @remarks
 * The manifest declares what a site is allowed to use — its DB tier, storage,
 * analytics/observability tiers, browser-automation backend, AI budget, and
 * feature flags. Canonical data lives in D1; the active signed copy is cached in
 * KV (hot-path lookup) and the full bundle in R2. This module owns the contract,
 * the plan→capability defaults, and the HMAC signing/verification. The hot path
 * reads the KV copy and verifies the signature before trusting it — never an
 * unsigned manifest.
 *
 * @see docs/architecture/cloudflare-first.md §3
 */
import { z } from 'zod';
import { timingSafeEqual } from '../lib/timing_safe_equal.js';
import type { Env } from '../types/env.js';

export const PLANS = ['free', 'paid', 'pro', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];

/** The capability manifest contract — Zod is the source of truth. */
export const SiteCapabilityManifestSchema = z
  .object({
    tenantId: z.string().min(1),
    siteId: z.string().min(1),
    hostname: z.string().min(1),
    plan: z.enum(PLANS),
    staticServing: z.boolean(),
    db: z.enum(['none', 'd1_tenant_db', 'neon_shared_shard', 'neon_dedicated_project']),
    storage: z.literal('r2'),
    analytics: z.enum(['included', 'growth', 'developer']),
    sentry: z.enum(['virtual', 'dedicated']),
    posthog: z.enum(['none', 'sampled', 'full_paid']),
    browserAutomation: z.enum(['cloudflare', 'browserbase_fallback', 'internal_skyvern']),
    aiGatewayBudgetMonthlyCents: z.number().int().min(0),
    vectorizeNamespace: z.string().optional(),
    featureFlags: z.record(z.union([z.boolean(), z.string(), z.number()])),
    manifestVersion: z.string(),
    release: z.string(),
  })
  .strict();

export type SiteCapabilityManifest = z.infer<typeof SiteCapabilityManifestSchema>;

/** A manifest plus its detached HMAC signature. */
export interface SignedManifest {
  readonly manifest: SiteCapabilityManifest;
  readonly sig: string;
  readonly alg: 'HMAC-SHA256';
}

/** Per-plan capability defaults — the doctrine's tiering, in one place. */
const PLAN_DEFAULTS: Record<
  Plan,
  Pick<
    SiteCapabilityManifest,
    'db' | 'analytics' | 'sentry' | 'posthog' | 'aiGatewayBudgetMonthlyCents'
  >
> = {
  free: {
    db: 'none',
    analytics: 'included',
    sentry: 'virtual',
    posthog: 'none',
    aiGatewayBudgetMonthlyCents: 0,
  },
  paid: {
    db: 'd1_tenant_db',
    analytics: 'included',
    sentry: 'virtual',
    posthog: 'sampled',
    aiGatewayBudgetMonthlyCents: 500,
  },
  pro: {
    db: 'neon_shared_shard',
    analytics: 'growth',
    sentry: 'dedicated',
    posthog: 'sampled',
    aiGatewayBudgetMonthlyCents: 5_000,
  },
  enterprise: {
    db: 'neon_dedicated_project',
    analytics: 'developer',
    sentry: 'dedicated',
    posthog: 'full_paid',
    aiGatewayBudgetMonthlyCents: 50_000,
  },
};

export interface BuildManifestInput {
  readonly tenantId: string;
  readonly siteId: string;
  readonly hostname: string;
  readonly plan: Plan;
  readonly release: string;
  /** Override any plan default (e.g. promote db to a dedicated Neon project). */
  readonly overrides?: Partial<SiteCapabilityManifest>;
  readonly featureFlags?: Record<string, boolean | string | number>;
  readonly vectorizeNamespace?: string;
}

/**
 * Build a manifest from a site + plan, applying the doctrine's plan defaults.
 * Browser automation defaults to `cloudflare` for every plan (the LAW); only an
 * explicit override moves it to a fallback/internal backend.
 *
 * @example
 * buildManifest({ tenantId:'t', siteId:'s', hostname:'h', plan:'pro', release:'r' })
 */
export function buildManifest(input: BuildManifestInput): SiteCapabilityManifest {
  const d = PLAN_DEFAULTS[input.plan];
  const manifest: SiteCapabilityManifest = {
    tenantId: input.tenantId,
    siteId: input.siteId,
    hostname: input.hostname,
    plan: input.plan,
    staticServing: true,
    db: d.db,
    storage: 'r2',
    analytics: d.analytics,
    sentry: d.sentry,
    posthog: d.posthog,
    browserAutomation: 'cloudflare',
    aiGatewayBudgetMonthlyCents: d.aiGatewayBudgetMonthlyCents,
    ...(input.vectorizeNamespace ? { vectorizeNamespace: input.vectorizeNamespace } : {}),
    featureFlags: input.featureFlags ?? {},
    manifestVersion: '1',
    release: input.release,
    ...input.overrides,
  };
  // Validate after merge so an override can't produce an invalid manifest.
  return SiteCapabilityManifestSchema.parse(manifest);
}

/** Stable, key-sorted JSON so the signature is deterministic. */
export function canonicalManifestJson(m: SiteCapabilityManifest): string {
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortValue((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortValue(m));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sign a manifest with HMAC-SHA256 over its canonical JSON. */
export async function signManifest(
  m: SiteCapabilityManifest,
  secret: string,
): Promise<SignedManifest> {
  if (!secret) throw new ManifestError('A signing secret is required.');
  const sig = await hmacHex(secret, canonicalManifestJson(m));
  return { manifest: m, sig, alg: 'HMAC-SHA256' };
}

/**
 * Verify a signed manifest. Returns the manifest only if the signature matches
 * AND the shape is valid; otherwise `null` (never trust an unverified manifest).
 */
export async function verifyManifest(
  signed: SignedManifest,
  secret: string,
): Promise<SiteCapabilityManifest | null> {
  if (!secret || !signed?.sig) return null;
  const parsed = SiteCapabilityManifestSchema.safeParse(signed.manifest);
  if (!parsed.success) return null;
  const expected = await hmacHex(secret, canonicalManifestJson(parsed.data));
  return timingSafeEqual(expected, signed.sig) ? parsed.data : null;
}

/** Resolve the signing secret from env (dedicated → AES key fallback). */
export function manifestSecret(
  env: Pick<Env, 'MANIFEST_SIGNING_SECRET' | 'MCP_ENCRYPTION_KEY'>,
): string {
  return env.MANIFEST_SIGNING_SECRET ?? env.MCP_ENCRYPTION_KEY ?? '';
}

const kvSiteKey = (siteId: string) => `manifest:${siteId}`;
const kvHostKey = (hostname: string) => `host-manifest:${hostname.toLowerCase()}`;
const r2Key = (siteId: string) => `manifests/${siteId}.json`;

/** Typed error for manifest failures. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/**
 * Cache a signed manifest in KV (by site id + hostname, 5-min TTL for the hot
 * path) and persist the full bundle to R2.
 */
export async function cacheManifest(
  env: Pick<Env, 'CACHE_KV' | 'SITES_BUCKET'>,
  signed: SignedManifest,
): Promise<void> {
  const body = JSON.stringify(signed);
  await Promise.all([
    env.CACHE_KV.put(kvSiteKey(signed.manifest.siteId), body, { expirationTtl: 300 }),
    env.CACHE_KV.put(kvHostKey(signed.manifest.hostname), body, { expirationTtl: 300 }),
    env.SITES_BUCKET.put(r2Key(signed.manifest.siteId), body, {
      httpMetadata: { contentType: 'application/json' },
    }),
  ]);
}

/**
 * Resolve a verified manifest from the KV hot-path cache by site id or hostname.
 * Returns `null` when absent or when the signature fails — callers must treat
 * `null` as "no capability" and never fall back to an unsigned default.
 */
export async function resolveManifest(
  env: Pick<Env, 'CACHE_KV' | 'MANIFEST_SIGNING_SECRET' | 'MCP_ENCRYPTION_KEY'>,
  by: { siteId?: string; hostname?: string },
): Promise<SiteCapabilityManifest | null> {
  const key = by.siteId ? kvSiteKey(by.siteId) : by.hostname ? kvHostKey(by.hostname) : null;
  if (!key) return null;
  const raw = await env.CACHE_KV.get(key);
  if (!raw) return null;
  let signed: SignedManifest;
  try {
    signed = JSON.parse(raw) as SignedManifest;
  } catch {
    return null;
  }
  return verifyManifest(signed, manifestSecret(env));
}
