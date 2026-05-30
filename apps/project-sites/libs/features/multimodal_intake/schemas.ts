/**
 * @module libs/features/multimodal_intake/schemas
 * @description Zod schemas for Multimodal Intake (idea #18) — the single source
 * of truth for the intake API boundary per [[zod-everywhere]]. Types are
 * inferred via `z.infer` and never hand-duplicated.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * One field the AI suggests prefilling on the booking/quote form. `confidence`
 * is a 0-1 best-effort score the UI can use to dim low-confidence prefills.
 */
export const SuggestedFieldSchema = z
  .object({
    /** Form field name (e.g. `service`, `description`, `name`). */
    name: z.string().min(1).max(64),
    /** Suggested value to prefill. */
    value: z.string().max(2000),
    /** 0-1 model confidence in the suggestion. */
    confidence: z.number().min(0).max(1).default(0.5),
  })
  .strict();

export type SuggestedField = z.infer<typeof SuggestedFieldSchema>;

/**
 * Structured intent merged from the photo description + voice transcript and
 * everything downstream needs to prefill + propose a booking.
 */
export const IntakeSubmissionSchema = z
  .object({
    /** Site the intake belongs to. */
    siteId: z.string().min(1),
    /** Public URL / R2 key of the uploaded problem photo, when present. */
    photoUrl: z.string().max(2048).optional(),
    /** Whisper transcript of the voice note, when present. */
    voiceTranscript: z.string().max(8000).optional(),
    /** One-paragraph natural-language summary of what the visitor needs. */
    extractedIntent: z.string().min(1).max(4000),
    /** Form fields the AI suggests prefilling. */
    suggestedFields: z.array(SuggestedFieldSchema).default([]),
    /** Recommended service type, when the AI could infer one. */
    suggestedService: z.string().max(120).optional(),
    /** Urgency 0 (routine) → 100 (emergency). */
    urgency: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export type IntakeSubmission = z.infer<typeof IntakeSubmissionSchema>;

/**
 * Input to the intent-extraction step. At least one of `photoR2Key` /
 * `audioR2Key` should be present, but both-empty is tolerated (returns an
 * empty intent rather than throwing) so a partial upload still records a lead.
 */
export const ExtractIntentInputSchema = z
  .object({
    /** Site the intake belongs to. */
    siteId: z.string().min(1),
    /** R2 key of the uploaded photo (under the org media prefix). */
    photoR2Key: z.string().max(2048).optional(),
    /** R2 key of the uploaded audio note (under the org media prefix). */
    audioR2Key: z.string().max(2048).optional(),
    /** Optional free-text the visitor typed alongside the uploads. */
    note: z.string().max(4000).optional(),
  })
  .strict();

export type ExtractIntentInput = z.infer<typeof ExtractIntentInputSchema>;

/** Envelope returned by `POST /api/sites/:id/intake`. */
export const IntakeResponseSchema = z
  .object({
    ok: z.literal(true),
    submission: IntakeSubmissionSchema,
    /** Recorded lead row id. */
    leadId: z.string().min(1),
    /** Proposed booking id when `native_booking_engine` is on, else null. */
    bookingId: z.string().min(1).nullable(),
  })
  .strict();

export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;

/** Shape the vision/transcription LLM is asked to return (structured output). */
export const IntentExtractionResultSchema = z
  .object({
    extractedIntent: z.string().default(''),
    suggestedService: z.string().optional(),
    urgency: z.number().int().min(0).max(100).default(0),
    suggestedFields: z.array(SuggestedFieldSchema).default([]),
  })
  .strict();

export type IntentExtractionResult = z.infer<typeof IntentExtractionResultSchema>;
