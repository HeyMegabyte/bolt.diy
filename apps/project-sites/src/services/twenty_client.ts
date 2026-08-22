/**
 * Twenty CRM typed client — Zod schemas only.
 *
 * @remarks
 * AGPL ISOLATION: Twenty is AGPL-licensed. Every schema and type is declared
 * LOCALLY here — no `@twenty/*` package, no shared SDK, no imported types.
 * HTTP-bound calls live in {@link ../services/crm_leads.ts}.
 *
 * Pure Zod, zero I/O, never throws. Use safeParse at every boundary per
 * {@link fail-fast-build-fail-soft-prod}.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

/**
 * Twenty composite address shape (standard field on Company, Person).
 *
 * @remarks
 * Twenty models address as an object with per-line fields rather than a flat
 * string. Only `addressStreet1` is required; the rest are optional.
 *
 * @example
 * ```ts
 * AddressSchema.parse({ addressStreet1: '123 Main St', addressCity: 'Newark', addressCountry: 'US' });
 * // => { addressStreet1: '123 Main St', addressCity: 'Newark', addressCountry: 'US' }
 * ```
 */
export const AddressSchema = z
  .object({
    addressCity: z.string().optional(),
    addressCountry: z.string().optional(),
    addressLat: z.number().optional(),
    addressLng: z.number().optional(),
    addressPostcode: z.string().optional(),
    addressState: z.string().optional(),
    addressStreet1: z.string().min(1, 'Street address is required'),
    addressStreet2: z.string().optional(),
  })
  .strict();

export type Address = z.infer<typeof AddressSchema>;

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

/**
 * Twenty Company entity schema.
 *
 * @remarks
 * Matches Twenty's standard Company REST shape. Custom fields (leadScore,
 * payTier, outreachChannel, etc.) are provisioned via the metadata API and
 * validated separately in {@link ../services/crm_leads.ts}.
 *
 * @example
 * ```ts
 * CompanySchema.parse({
 *   id: 'twenty-company-uuid',
 *   name: 'Acme Roofing',
 *   domain: 'acmeroofing.com',
 *   address: { addressStreet1: '1 Main St', addressCity: 'Newark' },
 *   employees: 12,
 *   annualRevenue: 1500000,
 *   createdAt: '2026-06-01T12:00:00Z',
 * });
 * ```
 */
export const CompanySchema = z
  .object({
    address: AddressSchema.optional(),
    annualRevenue: z.number().nonnegative().optional(),
    createdAt: z.string().datetime(),
    domain: z.string().max(255).optional(),
    employees: z.number().int().nonnegative().optional(),
    id: z.string().uuid(),
    name: z.string().min(1, 'Company name is required').max(255),
  })
  .strict();

export type Company = z.infer<typeof CompanySchema>;

/**
 * Twenty Company create-input schema (id and createdAt are server-generated).
 *
 * @example
 * ```ts
 * CompanyCreateSchema.parse({ name: 'Acme Roofing' });
 * // => { name: 'Acme Roofing' }
 * ```
 */
export const CompanyCreateSchema = CompanySchema.omit({ createdAt: true, id: true });

export type CompanyCreateInput = z.infer<typeof CompanyCreateSchema>;

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

/**
 * Twenty Person entity schema.
 *
 * @remarks
 * A Person belongs to exactly one Company (companyId is required). Email is
 * required; phone is optional.
 *
 * @example
 * ```ts
 * PersonSchema.parse({
 *   id: 'twenty-person-uuid',
 *   name: 'Jane Doe',
 *   email: 'jane@acmeroofing.com',
 *   phone: '+15551234567',
 *   companyId: 'twenty-company-uuid',
 *   createdAt: '2026-06-01T12:00:00Z',
 * });
 * ```
 */
export const PersonSchema = z
  .object({
    companyId: z.string().uuid('Company id must be a valid UUID'),
    createdAt: z.string().datetime(),
    email: z.string().email(),
    id: z.string().uuid(),
    name: z.string().min(1, 'Person name is required').max(255),
    phone: z.string().max(50).optional(),
  })
  .strict();

export type Person = z.infer<typeof PersonSchema>;

/**
 * Twenty Person create-input schema (id and createdAt are server-generated).
 */
export const PersonCreateSchema = PersonSchema.omit({ createdAt: true, id: true });

export type PersonCreateInput = z.infer<typeof PersonCreateSchema>;

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

/**
 * Twenty Opportunity stages.
 *
 * @remarks
 * Maps Twenty's default deal pipeline stages. Custom stages can be added as
 * a Zod union extension. Matches standard Twenty REST enum values.
 */
export const TWENTY_STAGES = [
  'NEW',
  'SCREENING',
  'QUALIFIED',
  'CONTACTED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;

export type TwentyStage = (typeof TWENTY_STAGES)[number];

export const TwentyStageSchema = z.enum(TWENTY_STAGES);

/**
 * Twenty Opportunity entity schema.
 *
 * @remarks
 * An Opportunity belongs to exactly one Company and optionally one Person.
 * `amount` is in minor currency units (cents) matching Stripe convention.
 *
 * @example
 * ```ts
 * OpportunitySchema.parse({
 *   id: 'twenty-opp-uuid',
 *   name: 'Q3 Roofing Contract',
 *   amount: 5000000,
 *   stage: 'NEGOTIATION',
 *   closeDate: '2026-09-30',
 *   companyId: 'twenty-company-uuid',
 *   personId: 'twenty-person-uuid',
 *   createdAt: '2026-06-15T08:00:00Z',
 * });
 * ```
 */
export const OpportunitySchema = z
  .object({
    amount: z.number().int().nonnegative('Amount must be non-negative').default(0),
    closeDate: z.string().optional(),
    companyId: z.string().uuid(),
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
    name: z.string().min(1, 'Opportunity name is required').max(255),
    personId: z.string().uuid().optional(),
    stage: TwentyStageSchema,
  })
  .strict();

export type Opportunity = z.infer<typeof OpportunitySchema>;

/**
 * Twenty Opportunity create-input schema (id and createdAt are server-generated).
 */
export const OpportunityCreateSchema = OpportunitySchema.omit({ createdAt: true, id: true });

export type OpportunityCreateInput = z.infer<typeof OpportunityCreateSchema>;

// ---------------------------------------------------------------------------
// Response wrappers
// ---------------------------------------------------------------------------

/**
 * Twenty REST create response envelope.
 *
 * @remarks
 * Twenty's GraphQL-backed REST API wraps create mutations in a
 * `{ data: { create<Entity>: { id } } }` envelope.
 *
 * @example
 * ```ts
 * SingleRecordResponseSchema.parse({ data: { id: 'uuid-here' } });
 * // => { data: { id: 'uuid-here' } }
 * ```
 */
export const SingleRecordResponseSchema = z
  .object({
    data: z.object({
      id: z.string().uuid(),
    }),
  })
  .strict();

export type SingleRecordResponse = z.infer<typeof SingleRecordResponseSchema>;

/**
 * Twenty REST list response envelope.
 *
 * @remarks
 * Twenty's list endpoints return `{ data: { <entityName>: [ … ] } }`. The
 * entity name is not standardised — accept any key in `data`.
 *
 * @example
 * ```ts
 * ListResponseSchema.parse({ data: { companies: [{ id: '…', name: 'Acme' }] } });
 * ```
 */
export const ListResponseSchema = z
  .object({
    data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  })
  .strict();

export type ListResponse = z.infer<typeof ListResponseSchema>;

// ---------------------------------------------------------------------------
// Config + result types for REST calls
// ---------------------------------------------------------------------------

/** Twenty CRM connection config. All three fields required for any network operation. */
export interface TwentyConfig {
  /** Base URL of the Twenty instance, e.g. `https://crm.projectsites.dev`. */
  baseUrl: string;
  /** Bearer token (JWT API key). */
  apiKey: string;
}

export type TwentyFindCompanyResult =
  | { ok: true; company: Company | null }
  | { ok: false; reason: string };

export type TwentyCreateContactResult = { ok: true; id: string } | { ok: false; reason: string };

export interface TwentyUpsertLeadInput {
  name: string;
  amount?: number;
  stage?: TwentyStage;
  closeDate?: string;
  personId?: string;
}

export type TwentyUpsertLeadResult = { ok: true; id: string } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function isConfigured(cfg: TwentyConfig): boolean {
  return Boolean(cfg.baseUrl && cfg.apiKey);
}

// ---------------------------------------------------------------------------
// Exported REST functions
// ---------------------------------------------------------------------------

/**
 * Find a company by domain name (`GET /rest/companies?filter=domain[eq]:...&limit=1`).
 *
 * @remarks
 * Never throws. Returns `{ ok: true, company: null }` when no match exists —
 * the lookup succeeded, the company just isn't in the CRM yet.
 *
 * @param cfg - Twenty connection config.
 * @param domain - Domain to search (e.g. `acmeroofing.com`).
 * @param fetchImpl - Injected fetch; defaults to global `fetch`.
 * @returns A {@link TwentyFindCompanyResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const r = await twentyFindCompany(cfg, 'acme.com');
 * if (r.ok && r.company) console.warn('found', r.company.id);
 * ```
 */
export async function twentyFindCompany(
  cfg: TwentyConfig,
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TwentyFindCompanyResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const url = `${cfg.baseUrl}/rest/companies?filter=domain[eq]:${encodeURIComponent(domain)}&limit=1`;
    const res = await fetchImpl(url, { headers: authHeaders(cfg.apiKey) });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.json()) as {
      data?: {
        companies?: Array<{
          id: string;
          name: string;
          domain?: string;
          address?: Address;
          employees?: number;
          annualRevenue?: number;
          createdAt: string;
        }>;
      };
    };
    const results = body?.data?.companies ?? [];
    if (results.length === 0) return { ok: true, company: null };
    const raw = results[0];
    const parsed = CompanySchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: `schema_mismatch: ${parsed.error.message}` };
    return { ok: true, company: parsed.data };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Create a contact/person in Twenty CRM (`POST /rest/people`).
 *
 * @remarks
 * Never throws. Validates input with {@link PersonCreateSchema} before sending.
 * The `companyId` is required per Twenty's data model; pass the result of
 * {@link twentyFindCompany} first.
 *
 * @param cfg - Twenty connection config.
 * @param email - Contact email (required).
 * @param name - Contact full name (required).
 * @param companyId - UUID of the company to associate this person with.
 * @param phone - Optional phone number.
 * @param fetchImpl - Injected fetch; defaults to global `fetch`.
 * @returns A {@link TwentyCreateContactResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const r = await twentyCreateContact(cfg, 'jane@acme.com', 'Jane Doe', companyId);
 * if (r.ok) console.warn('created person', r.id);
 * ```
 */
export async function twentyCreateContact(
  cfg: TwentyConfig,
  email: string,
  name: string,
  companyId: string,
  phone?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TwentyCreateContactResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  const input = PersonCreateSchema.safeParse({
    email,
    name,
    companyId,
    ...(phone ? { phone } : {}),
  });
  if (!input.success) return { ok: false, reason: `validation: ${input.error.message}` };
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/rest/people`, {
      method: 'POST',
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify(input.data),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.json()) as { data?: { id?: string } };
    return { ok: true, id: body?.data?.id ?? '' };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Create an opportunity/lead in Twenty CRM (`POST /rest/opportunities`).
 *
 * @remarks
 * Never throws. Validates input with {@link OpportunityCreateSchema}. The caller
 * should call {@link twentyFindCompany} first to resolve the company UUID, as
 * `companyId` is required per Twenty's data model.
 *
 * @param cfg - Twenty connection config.
 * @param companyId - UUID of the owning company.
 * @param input - Opportunity fields.
 * @param fetchImpl - Injected fetch; defaults to global `fetch`.
 * @returns A {@link TwentyUpsertLeadResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const r = await twentyUpsertLead(cfg, companyId, {
 *   name: 'Q3 Roofing Contract',
 *   amount: 5000000,
 *   stage: 'QUALIFIED',
 * });
 * if (r.ok) console.warn('created opportunity', r.id);
 * ```
 */
export async function twentyUpsertLead(
  cfg: TwentyConfig,
  companyId: string,
  input: TwentyUpsertLeadInput,
  fetchImpl: typeof fetch = fetch,
): Promise<TwentyUpsertLeadResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  const parsed = OpportunityCreateSchema.safeParse({
    companyId,
    name: input.name,
    amount: input.amount,
    stage: input.stage ?? 'NEW',
    closeDate: input.closeDate,
    personId: input.personId,
  });
  if (!parsed.success) return { ok: false, reason: `validation: ${parsed.error.message}` };
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/rest/opportunities`, {
      method: 'POST',
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.json()) as { data?: { id?: string } };
    return { ok: true, id: body?.data?.id ?? '' };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
