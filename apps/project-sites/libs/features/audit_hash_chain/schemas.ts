/**
 * @module libs/features/audit_hash_chain/schemas
 * @description Zod schemas for the Hash-Chained Audit Log (idea #46).
 *
 * The chain lives in a parallel ledger (`audit_log_chain`) keyed by
 * `audit_logs.id`. We never mutate `audit_logs` itself — preserving
 * its append-only contract and existing query patterns.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Hex SHA-256 digest — 64 lowercase hex chars. */
export const HashHexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Hash must be 64 lowercase hex chars (SHA-256)');
export type HashHex = z.infer<typeof HashHexSchema>;

/** All-zeros genesis hash used when an org has zero prior entries. */
export const GENESIS_HASH: HashHex = '0'.repeat(64) as HashHex;

export const ChainEntrySchema = z.object({
  audit_id: z.string(),
  org_id: z.string(),
  sequence: z.number().int().nonnegative(),
  prev_hash: HashHexSchema,
  entry_hash: HashHexSchema,
  payload_canonical: z.string(),
  created_at: z.string(),
});
export type ChainEntry = z.infer<typeof ChainEntrySchema>;

/** Payload shape we canonicalise + hash. */
export const HashablePayloadSchema = z.object({
  audit_id: z.string(),
  org_id: z.string(),
  actor_id: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  message: z.string(),
  metadata: z.unknown().nullable(),
  ts: z.string(),
});
export type HashablePayload = z.infer<typeof HashablePayloadSchema>;

export const VerificationResultSchema = z.object({
  ok: z.boolean(),
  entries_checked: z.number().int().nonnegative(),
  break_at_sequence: z.number().int().nonnegative().nullable(),
  break_reason: z
    .enum([
      'prev_hash_mismatch',
      'entry_hash_mismatch',
      'payload_corrupt',
      'missing_audit_row',
      'sequence_gap',
    ])
    .nullable(),
  last_hash: HashHexSchema.nullable(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
