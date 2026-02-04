/**
 * Base schemas and common patterns for Project Sites
 */
import { z } from 'zod';

// ============================================================================
// PRIMITIVE PATTERNS
// ============================================================================

/** UUID v4 pattern */
export const uuidSchema = z.string().uuid();

/** Email pattern with length constraints */
export const emailSchema = z
  .string()
  .email('Invalid email format')
  .min(5, 'Email too short')
  .max(254, 'Email too long')
  .toLowerCase()
  .trim();

/** Phone number (E.164 format) */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number (E.164 format required)')
  .max(16);

/** URL (https only) */
export const httpsUrlSchema = z
  .string()
  .url('Invalid URL')
  .regex(/^https:\/\//, 'Only HTTPS URLs allowed')
  .max(2048, 'URL too long');

/** Safe slug pattern (lowercase, alphanumeric, hyphens) */
export const slugSchema = z
  .string()
  .min(3, 'Slug too short (min 3 characters)')
  .max(63, 'Slug too long (max 63 characters)')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Slug must be lowercase, alphanumeric, may contain hyphens, cannot start/end with hyphen'
  );

/** Hostname pattern (valid domain) */
export const hostnameSchema = z
  .string()
  .min(4, 'Hostname too short')
  .max(253, 'Hostname too long')
  .regex(
    /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    'Invalid hostname format'
  )
  .toLowerCase()
  .trim();

/** Confidence score (0-100) */
export const confidenceSchema = z.number().int().min(0).max(100);

/** Timestamp (ISO 8601 string or Date) */
export const timestampSchema = z.union([z.string().datetime(), z.date()]);

/** Positive integer */
export const positiveIntSchema = z.number().int().positive();

/** Non-negative integer */
export const nonNegativeIntSchema = z.number().int().nonnegative();

/** Safe text (no HTML/script injection) */
export const safeTextSchema = z
  .string()
  .max(10000, 'Text too long')
  .transform((val) =>
    val
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim()
  );

/** Short text (for names, titles) */
export const shortTextSchema = z
  .string()
  .min(1, 'Text required')
  .max(255, 'Text too long')
  .trim();

/** Business name */
export const businessNameSchema = z
  .string()
  .min(2, 'Business name too short')
  .max(200, 'Business name too long')
  .trim();

/** Currency amount in cents */
export const centsSchema = z.number().int().nonnegative();

// ============================================================================
// COMMON OBJECT PATTERNS
// ============================================================================

/** Standard timestamps for all records */
export const timestampsSchema = z.object({
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

/** Pagination input */
export const paginationInputSchema = z.object({
  page: positiveIntSchema.default(1),
  limit: positiveIntSchema.max(100).default(20),
});

/** Pagination output metadata */
export const paginationMetaSchema = z.object({
  page: positiveIntSchema,
  limit: positiveIntSchema,
  total: nonNegativeIntSchema,
  totalPages: nonNegativeIntSchema,
  hasMore: z.boolean(),
});

/** Standard API response wrapper */
export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.unknown()).optional(),
      })
      .optional(),
    meta: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  });

/** Standard error response */
export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  request_id: z.string().optional(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type UUID = z.infer<typeof uuidSchema>;
export type Email = z.infer<typeof emailSchema>;
export type Phone = z.infer<typeof phoneSchema>;
export type HttpsUrl = z.infer<typeof httpsUrlSchema>;
export type Slug = z.infer<typeof slugSchema>;
export type Hostname = z.infer<typeof hostnameSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type Timestamps = z.infer<typeof timestampsSchema>;
export type PaginationInput = z.infer<typeof paginationInputSchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
