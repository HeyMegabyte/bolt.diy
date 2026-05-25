/**
 * @module routes/autofill
 * @description AI auto-fill for the create-site wizard.
 *
 * `POST /api/sites/autofill` — given a business name (e.g. "Apple iTunes
 * Store"), Workers AI infers every field on the create form (description,
 * category, primary URL, suggested subdomains, brand colors, tagline,
 * target audience, ...). Each field is nullable so the model can decline
 * rather than hallucinate.
 *
 * Auth: bearer-token required (returns 401 otherwise). Writes one row to
 * `audit_logs` per call. Per-user soft rate-limit of 1 call per 10s via KV.
 *
 * @example
 * ```
 * POST /api/sites/autofill
 * { "name": "Apple iTunes Store" }
 *
 * → {
 *   "data": {
 *     "name": "Apple iTunes Store",
 *     "description": "Digital storefront for music, movies, podcasts, and apps.",
 *     "category": "Technology / SaaS",
 *     "primary_url": "https://apple.com",
 *     "suggested_subdomains": ["itunes-apple", "apple-store", "apple-itunes"],
 *     "brand_colors": ["#000000", "#1d1d1f", "#0071e3"],
 *     "tagline": "Music, movies, and more — everything you love.",
 *     "target_audience": "Consumers worldwide buying digital media on Apple devices.",
 *     ...
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { unauthorized, badRequest } from '@project-sites/shared';
import { writeAuditLog } from '../services/audit.js';

export const autofill = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Workers-AI Llama 70B model id.
 *
 * @remarks
 * The bare `@cf/meta/llama-3.3-70b-instruct` alias is deprecated and returns
 * 400. Use the `-fp8-fast` variant, which is the currently deployed Llama
 * 3.3 70B model on Cloudflare's Workers AI catalog.
 */
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;

/** Allowed create-form categories — keep in lock-step with frontend list. */
const CATEGORIES = [
  'Restaurant / Café',
  'Salon / Barbershop',
  'Legal / Law Firm',
  'Medical / Healthcare',
  'Retail / Shop',
  'Technology / SaaS',
  'Construction / Home Services',
  'Fitness / Gym',
  'Real Estate',
  'Photography / Creative',
  'Automotive',
  'Education / Tutoring',
  'Financial / Accounting',
  'Music + Entertainment',
  'Other',
] as const;

/** Request body schema. */
const autofillRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

/**
 * Response shape — every field nullable so the model can decline rather
 * than hallucinate. The frontend treats `null` as "leave the form alone".
 */
export const autofillResponseSchema = z.object({
  name: z.string().nullable(),
  description: z.string().max(280).nullable(),
  category: z.string().nullable(),
  primary_url: z.string().nullable(),
  suggested_subdomains: z.array(z.string()).max(5).nullable(),
  brand_colors: z.array(z.string()).max(5).nullable(),
  tagline: z.string().max(120).nullable(),
  target_audience: z.string().max(280).nullable(),
  business_address: z.string().nullable(),
  phone: z.string().nullable(),
  additional_context: z.string().max(2000).nullable(),
});

export type AutofillResponse = z.infer<typeof autofillResponseSchema>;

/**
 * Build the system + user prompts for Workers AI.
 *
 * @remarks
 * The system prompt explicitly instructs the model to return `null` for
 * fields it can't confidently fill — "we'd rather show the user a blank
 * field than wrong data."
 */
function buildPrompt(name: string): { system: string; user: string } {
  const system = [
    'You are a business-research assistant. Given a business name, infer the',
    'fields a website builder needs to pre-fill a "create site" form.',
    '',
    'STRICT RULES:',
    '1. Return ONLY a JSON object. No prose, no markdown fences, no comments.',
    '2. If you do not know a field with reasonable confidence, return null',
    '   for that field. DO NOT hallucinate. A blank field is better than',
    '   wrong data.',
    '3. Echo the input name verbatim as `name`.',
    '4. `category` must be EXACTLY one of:',
    `   ${CATEGORIES.join(' | ')}`,
    '5. `primary_url` must be a real hostname you are highly confident about',
    '   (e.g. apple.com, mcdonalds.com). Include the https:// scheme. If',
    '   unsure, return null.',
    '6. `suggested_subdomains` are short lowercase slugs the user might pick',
    "   for their site (kebab-case, no dots, 3-30 chars). Max 5 items.",
    '7. `brand_colors` are 1-5 hex colors (`#RRGGBB`) representing the',
    '   brand identity. If you do not know, return null.',
    '8. `description` is one tight sentence, max 160 chars.',
    '9. `tagline` is 3-8 words, evocative, no slop ("revolutionize",',
    '   "leverage", "cutting-edge", "world-class" are BANNED).',
    '10. `target_audience` is one sentence describing the primary customer.',
    '11. `business_address`, `phone`, `additional_context` should usually be',
    '    null unless you have very high confidence.',
    '',
    'Schema:',
    '{',
    '  "name": string,',
    '  "description": string | null,',
    '  "category": string | null,',
    '  "primary_url": string | null,',
    '  "suggested_subdomains": string[] | null,',
    '  "brand_colors": string[] | null,',
    '  "tagline": string | null,',
    '  "target_audience": string | null,',
    '  "business_address": string | null,',
    '  "phone": string | null,',
    '  "additional_context": string | null',
    '}',
  ].join('\n');

  const user = `Business name: "${name}"\n\nReturn the JSON object now.`;
  return { system, user };
}

/**
 * Extract the JSON object from a model response. Tolerates accidental
 * markdown fences, leading commentary, or trailing junk.
 */
function parseJsonResponse(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip markdown fences first
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Try to find the first { ... } block
    const match = unfenced.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Normalize a category response into the allowed list. Tolerates case +
 * whitespace + slash variations.
 */
function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const r = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const cat of CATEGORIES) {
    if (r === cat.toLowerCase()) return cat;
  }
  for (const cat of CATEGORIES) {
    const head = cat.toLowerCase().split(' / ')[0].split(' + ')[0];
    if (r.includes(head)) return cat;
  }
  return null;
}

/**
 * Clean and validate a URL. Returns null if it cannot be normalized into
 * a real https URL.
 */
function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    // Reject placeholder hosts the model might invent
    if (/example\.|placeholder|your-?domain/i.test(u.hostname)) return null;
    if (!u.hostname.includes('.')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Normalize a hex color string. */
function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  return `#${m[1].toLowerCase()}`;
}

/** Normalize a subdomain slug. */
function normalizeSubdomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length < 3 || s.length > 30) return null;
  return s;
}

/**
 * Build a safe empty response (used on AI failure so the frontend can
 * unblock instead of crashing).
 */
function emptyResponse(name: string): AutofillResponse {
  return {
    name,
    description: null,
    category: null,
    primary_url: null,
    suggested_subdomains: null,
    brand_colors: null,
    tagline: null,
    target_audience: null,
    business_address: null,
    phone: null,
    additional_context: null,
  };
}

/**
 * Coerce + sanitize the raw model output into a typed `AutofillResponse`.
 * Drops anything the model produced that fails validation — null > wrong.
 */
function coerceResponse(name: string, raw: unknown): AutofillResponse {
  if (!raw || typeof raw !== 'object') return emptyResponse(name);
  const r = raw as Record<string, unknown>;

  const description =
    typeof r['description'] === 'string' && r['description'].trim()
      ? r['description'].trim().slice(0, 280)
      : null;
  const tagline =
    typeof r['tagline'] === 'string' && r['tagline'].trim()
      ? r['tagline'].trim().slice(0, 120)
      : null;
  const targetAudience =
    typeof r['target_audience'] === 'string' && r['target_audience'].trim()
      ? r['target_audience'].trim().slice(0, 280)
      : null;
  const additionalContext =
    typeof r['additional_context'] === 'string' && r['additional_context'].trim()
      ? r['additional_context'].trim().slice(0, 2000)
      : null;
  const businessAddress =
    typeof r['business_address'] === 'string' && r['business_address'].trim()
      ? r['business_address'].trim().slice(0, 300)
      : null;
  const phone =
    typeof r['phone'] === 'string' && r['phone'].trim() ? r['phone'].trim().slice(0, 40) : null;

  const subdomains = Array.isArray(r['suggested_subdomains'])
    ? Array.from(
        new Set(
          (r['suggested_subdomains'] as unknown[])
            .map(normalizeSubdomain)
            .filter((s): s is string => !!s),
        ),
      ).slice(0, 5)
    : null;

  const brandColors = Array.isArray(r['brand_colors'])
    ? Array.from(
        new Set(
          (r['brand_colors'] as unknown[])
            .map(normalizeHex)
            .filter((s): s is string => !!s),
        ),
      ).slice(0, 5)
    : null;

  return {
    name,
    description,
    category: normalizeCategory(r['category']),
    primary_url: normalizeUrl(r['primary_url']),
    suggested_subdomains: subdomains && subdomains.length ? subdomains : null,
    brand_colors: brandColors && brandColors.length ? brandColors : null,
    tagline,
    target_audience: targetAudience,
    business_address: businessAddress,
    phone,
    additional_context: additionalContext,
  };
}

/**
 * Soft per-user rate limit: 1 call per 10s. Uses KV so it shares state
 * across edge POPs. Returns `true` when the call is allowed.
 */
async function checkSessionRateLimit(env: Env, userId: string): Promise<boolean> {
  const key = `rl:autofill:${userId}`;
  try {
    const existing = await env.CACHE_KV.get(key);
    if (existing) return false;
    await env.CACHE_KV.put(key, '1', { expirationTtl: 10 });
    return true;
  } catch {
    // KV unavailable — fail open
    return true;
  }
}

/**
 * Main handler.
 *
 * @throws 401 when bearer token is missing/invalid (set by upstream auth).
 * @throws 400 when body fails Zod validation.
 * @throws 429 when the per-session rate limit fires.
 */
autofill.post('/api/sites/autofill', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) throw unauthorized('Must be authenticated to use AI autofill');

  // Validate body
  const rawBody = await c.req.json().catch(() => null);
  const parsed = autofillRequestSchema.safeParse(rawBody);
  if (!parsed.success) throw badRequest('Body must be { name: string }');
  const { name } = parsed.data;

  // Per-session rate limit (1 call / 10s per user)
  const allowed = await checkSessionRateLimit(c.env, userId);
  if (!allowed) {
    return c.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'AI autofill is limited to 1 call per 10 seconds. Try again shortly.',
          retry_after: 10,
        },
      },
      429,
      { 'Retry-After': '10' },
    );
  }

  const started = Date.now();
  const { system, user } = buildPrompt(name);

  let outputText = '';
  let response: AutofillResponse = emptyResponse(name);
  let status: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;

  try {
    const ai = (await c.env.AI.run(MODEL as Parameters<typeof c.env.AI.run>[0], {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 600,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    } as Parameters<typeof c.env.AI.run>[1])) as { response?: string };

    outputText = (ai.response ?? '').trim();
    const parsedJson = parseJsonResponse(outputText);
    response = coerceResponse(name, parsedJson);
  } catch (err) {
    status = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[sites/autofill] AI call failed:', errorMessage);
  }

  // Audit (fire-and-forget so latency isn't tied to D1)
  c.executionCtx.waitUntil(
    writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'site.autofill.requested',
      message: `AI autofill for "${name}"`,
      target_type: 'site',
      metadata_json: {
        name,
        model: MODEL,
        status,
        latency_ms: Date.now() - started,
        fields_returned: Object.entries(response).filter(
          ([k, v]) => k !== 'name' && v !== null,
        ).length,
        error: errorMessage,
      },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({
    data: response,
    meta: {
      model: MODEL,
      latency_ms: Date.now() - started,
      status,
    },
  });
});
