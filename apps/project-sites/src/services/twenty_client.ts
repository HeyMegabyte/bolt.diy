/**
 * Twenty CRM typed client — Zod schemas only.
 *
 * @remarks
 * AGPL ISOLATION: Twenty is AGPL-licensed. Every schema and type is declared
 * LOCALLY here — no `@twenty/*` package, no shared SDK, no imported types.
 * HTTP-bound calls live in {@link ../services/crm_leads.ts}.
 *
 * Six core entity schemas (Company, Person, Opportunity) plus create-input
 * variants and a stage enum — pure Zod, zero I/O, never throws. Use safeParse
 * at every boundary per {@link fail-fast-build-fail-soft-prod}.
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

/** Inferred type for a Twenty composite address. */
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

/** Inferred type for a full Twenty Company record. */
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

/** Inferred type for creating a Twenty Company. */
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

/** Inferred type for a full Twenty Person record. */
export type Person = z.infer<typeof PersonSchema>;

/**
 * Twenty Person create-input schema (id and createdAt are server-generated).
 */
export const PersonCreateSchema = PersonSchema.omit({ createdAt: true, id: true });

/** Inferred type for creating a Twenty Person. */
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

/** One of the standard Twenty opportunity stages. */
export type TwentyStage = (typeof TWENTY_STAGES)[number];

/** Zod enum for Twenty opportunity stages. */
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

/** Inferred type for a full Twenty Opportunity record. */
export type Opportunity = z.infer<typeof OpportunitySchema>;

/**
 * Twenty Opportunity create-input schema (id and createdAt are server-generated).
 */
export const OpportunityCreateSchema = OpportunitySchema.omit({ createdAt: true, id: true });

/** Inferred type for creating a Twenty Opportunity. */
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

/** Inferred type for a Twenty single-record REST response. */
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

/** Inferred type for a Twenty list REST response. */
export type ListResponse = z.infer<typeof ListResponseSchema>;
