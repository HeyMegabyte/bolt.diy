/**
 * @module libs/features/credit_wallet_rollover/schemas
 * @description Zod schemas for the Credit Wallet Rollover feature module.
 * All request/response shapes are defined here and inferred for TypeScript types.
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

/** Credit transaction kinds stored in the ledger. */
export const CreditKindSchema = z.enum([
  'earned',   // credits granted at billing cycle start or manually
  'rollover', // unused credits carried from prior month
  'applied',  // credits consumed by a feature (negative value)
  'expired',  // credits that exceeded the rollover cap and were dropped
]);

export type CreditKind = z.infer<typeof CreditKindSchema>;

/** A single ledger row in `credit_wallet_ledger`. */
export const CreditLedgerRowSchema = z
  .object({
    id: z.string().min(1),
    org_id: z.string().min(1),
    kind: CreditKindSchema,
    amount: z.number().int(), // positive for earned/rollover, negative for applied
    balance_after: z.number().int().min(0),
    description: z.string().max(500).optional(),
    idempotency_key: z.string().max(128).optional().nullable(),
    created_at: z.string().optional(),
  })
  .strict();

export type CreditLedgerRow = z.infer<typeof CreditLedgerRowSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Body for POST /api/credits/apply */
export const ApplyCreditsBodySchema = z
  .object({
    amount: z.number().int().positive(),
    description: z.string().max(500).optional(),
    idempotency_key: z.string().max(128).optional(),
  })
  .strict();

export type ApplyCreditsBody = z.infer<typeof ApplyCreditsBodySchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/** GET /api/credits/balance */
export const CreditBalanceResponseSchema = z
  .object({
    org_id: z.string().min(1),
    balance: z.number().int().min(0),
    monthly_allowance: z.number().int().min(0),
    rollover_cap: z.number().int().min(0), // = 3 × monthly_allowance
  })
  .strict();

export type CreditBalanceResponse = z.infer<typeof CreditBalanceResponseSchema>;

/** POST /api/credits/apply */
export const ApplyCreditsResponseSchema = z
  .object({
    applied: z.number().int().min(0),
    balance: z.number().int().min(0),
    ledger_id: z.string().min(1),
  })
  .strict();

export type ApplyCreditsResponse = z.infer<typeof ApplyCreditsResponseSchema>;

/** GET /api/credits/history */
export const CreditHistoryResponseSchema = z
  .object({
    org_id: z.string().min(1),
    rows: z.array(CreditLedgerRowSchema),
    count: z.number().int().min(0),
  })
  .strict();

export type CreditHistoryResponse = z.infer<typeof CreditHistoryResponseSchema>;
