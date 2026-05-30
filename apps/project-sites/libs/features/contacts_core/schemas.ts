/**
 * @module libs/features/contacts_core/schemas
 * @description Zod schemas for the Contacts Core (CRM) feature module — the
 * single source of truth for the shared `contacts` person/lead entity.
 *
 * Consumed by every module that captures a person: unified_inbox, gbp_assist,
 * review_synthesis, reputation, donations_engine, referral_loop,
 * affiliate_program. They call `recordContact()` (service.ts) with an input
 * validated against {@link UpsertContactSchema} instead of forking their own
 * table.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Where a contact entered the system. Extend as new capture surfaces ship. */
export const ContactSourceSchema = z.enum([
  'inbox',
  'gbp',
  'donation',
  'referral',
  'affiliate',
  'review',
  'booking',
  'newsletter',
  'manual',
]);
export type ContactSource = z.infer<typeof ContactSourceSchema>;

/** Loose E.164-ish phone guard — digits + optional leading `+`, 7-15 digits. */
const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'phone must be 7-15 digits, optional leading +');

/** A fully-materialized contact row (post-parse from D1, JSON columns expanded). */
export const ContactSchema = z
  .object({
    id: z.string().min(1),
    orgId: z.string().min(1),
    siteId: z.string().min(1).nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    name: z.string().nullable(),
    source: ContactSourceSchema,
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    consentEmail: z.boolean().default(false),
    consentSms: z.boolean().default(false),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Contact = z.infer<typeof ContactSchema>;

/**
 * Input to `recordContact()` — the cross-module write contract. At least one of
 * `email` / `phone` is required so the row is dedupe-able.
 */
export const UpsertContactSchema = z
  .object({
    orgId: z.string().min(1),
    siteId: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: PhoneSchema.optional(),
    name: z.string().min(1).max(200).optional(),
    source: ContactSourceSchema.default('manual'),
    tags: z.array(z.string().min(1).max(64)).max(50).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    consentEmail: z.boolean().optional(),
    consentSms: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email ?? v.phone), {
    message: 'a contact needs at least one of email or phone to be dedupe-able',
    path: ['email'],
  });
export type UpsertContactInput = z.infer<typeof UpsertContactSchema>;

/** Query params for `GET /api/contacts`. */
export const ListContactsQuerySchema = z
  .object({
    siteId: z.string().min(1).optional(),
    source: ContactSourceSchema.optional(),
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListContactsQuery = z.infer<typeof ListContactsQuerySchema>;

/** Response envelope for the list endpoint. */
export const ListContactsResponseSchema = z
  .object({
    contacts: z.array(ContactSchema),
    total: z.number().int().min(0),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();
export type ListContactsResponse = z.infer<typeof ListContactsResponseSchema>;
