/**
 * @module libs/features/multimodal_intake/service
 * @description Core logic for Multimodal Intake (idea #18).
 *
 * `processIntake` orchestrates: read R2 uploads → (audio) transcribe via the
 * Whisper/Deepgram path in {@link voice_agent} → (photo) describe via the
 * vision path in {@link external_llm} → merge into a structured intent +
 * urgency + prefilled fields → record a lead row in `intake_submissions` →
 * best-effort `recordSpend` (token_burn_meter) → propose a booking when
 * `native_booking_engine` is on.
 *
 * AI is foundational here but every external call is best-effort: a missing
 * key or a transient failure degrades to an empty/partial intent rather than
 * failing the request, so a visitor's upload still records a lead.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbInsert } from '../../../src/services/db.js';
import { transcribeAudioChunk } from '../../../src/services/voice_agent.js';
import { callExternalLLMWithVision } from '../../../src/services/external_llm.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  IntakeSubmissionSchema,
  IntentExtractionResultSchema,
  type IntakeSubmission,
  type IntentExtractionResult,
} from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'multimodal_intake';

/** Flag key for the booking backend this intake feeds. */
const BOOKING_FLAG_KEY = 'native_booking_engine';

/** Structured-output JSON schema the vision LLM is asked to return. */
const INTENT_SCHEMA = {
  type: 'object',
  required: ['extractedIntent', 'urgency', 'suggestedFields'],
  properties: {
    extractedIntent: { type: 'string' },
    suggestedService: { type: 'string' },
    urgency: { type: 'number' },
    suggestedFields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'value'],
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

/** Arguments for {@link processIntake}. */
export interface ProcessIntakeArgs {
  /** Site the intake belongs to. */
  siteId: string;
  /** R2 key of the uploaded problem photo (org media prefix). */
  photoR2Key?: string;
  /** R2 key of the uploaded voice note (org media prefix). */
  audioR2Key?: string;
  /** Optional public URL for the photo, stored on the submission. */
  photoUrl?: string;
  /** Optional free text the visitor typed alongside the uploads. */
  note?: string;
}

/** Result of {@link processIntake}. */
export interface ProcessIntakeResult {
  submission: IntakeSubmission;
  leadId: string;
  bookingId: string | null;
}

/**
 * Run the full intake pipeline for one visitor submission.
 *
 * @param env  - Worker env (R2, AI, DB, LLM keys).
 * @param args - Site + R2 keys for the uploaded photo/audio.
 * @returns The structured submission, the recorded lead id, and a proposed
 *          booking id (or null when the booking backend is off).
 *
 * @example
 * ```ts
 * const { submission, leadId } = await processIntake(env, {
 *   siteId, photoR2Key: 'media/o1/a1/pipe.jpg', audioR2Key: 'media/o1/a2/note.webm',
 * });
 * ```
 */
export async function processIntake(env: Env, args: ProcessIntakeArgs): Promise<ProcessIntakeResult> {
  // 1. Transcribe the voice note (best-effort).
  let voiceTranscript: string | undefined;
  if (args.audioR2Key) {
    const bytes = await readR2(env, args.audioR2Key);
    if (bytes) {
      const t = await transcribeAudioChunk(env, bytes).catch(() => null);
      voiceTranscript = t?.text?.trim() || undefined;
    }
  }

  // 2. Describe the photo + merge with transcript into a structured intent.
  const extraction = await extractIntent(env, {
    photoR2Key: args.photoR2Key,
    voiceTranscript,
    note: args.note,
  });

  // 3. Build + validate the submission contract.
  const submission = IntakeSubmissionSchema.parse({
    siteId: args.siteId,
    photoUrl: args.photoUrl,
    voiceTranscript,
    extractedIntent: extraction.extractedIntent || fallbackIntent(voiceTranscript, args.note),
    suggestedFields: extraction.suggestedFields,
    suggestedService: extraction.suggestedService,
    urgency: extraction.urgency,
  });

  // 4. Best-effort spend recording when token_burn_meter is present.
  await recordSpendIfMetered(env, args.siteId);

  // 5. Record the lead, then propose a booking when the booking backend is on.
  const leadId = await recordLead(env, submission);
  const bookingId = await proposeBookingIfEnabled(env, submission, leadId);

  return { submission, leadId, bookingId };
}

/**
 * Describe the photo (vision LLM) + merge the voice transcript into a single
 * structured intent. Best-effort: returns an empty result on any failure so
 * the caller still records a lead.
 */
export async function extractIntent(
  env: Env,
  input: { photoR2Key?: string; voiceTranscript?: string; note?: string },
): Promise<IntentExtractionResult> {
  const empty = IntentExtractionResultSchema.parse({});
  if (!input.photoR2Key && !input.voiceTranscript && !input.note) return empty;

  const userParts: string[] = [];
  if (input.voiceTranscript) userParts.push(`Voice note transcript: "${input.voiceTranscript}"`);
  if (input.note) userParts.push(`Typed note: "${input.note}"`);
  userParts.push(
    'Return strict JSON: { extractedIntent (one paragraph), suggestedService (string), ' +
      'urgency (integer 0-100, 100 = emergency), suggestedFields (array of {name,value,confidence 0-1}). ' +
      'Suggest values for form fields: service, description, urgency, name, contact.',
  );

  let imageBase64: string | undefined;
  if (input.photoR2Key) {
    const bytes = await readR2(env, input.photoR2Key);
    if (bytes) imageBase64 = toBase64(bytes);
  }

  try {
    const res = await callExternalLLMWithVision(env, {
      system:
        'You are an intake assistant for a local service business. A visitor uploaded a photo of their ' +
        'problem and/or a voice note. Identify the service they need, how urgent it is, and prefill the ' +
        'booking form. Be concrete. If you cannot tell, say so plainly and set urgency low.',
      user: userParts.join('\n'),
      imageBase64,
      jsonMode: true,
      jsonSchema: { name: 'intake_intent', schema: INTENT_SCHEMA as unknown as Record<string, unknown> },
      maxTokens: 1200,
      temperature: 0.2,
    });
    return parseIntent(res.output);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'multimodal_intake',
        feature_slug: FLAG_KEY,
        message: 'intent_extraction_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return empty;
  }
}

// ─── Helpers ───────────────────────────────────────────────

/** Read an R2 object's bytes; returns null on miss or error. */
async function readR2(env: Env, key: string): Promise<ArrayBuffer | null> {
  try {
    const obj = await env.SITES_BUCKET.get(key);
    if (!obj) return null;
    return await obj.arrayBuffer();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'multimodal_intake',
        feature_slug: FLAG_KEY,
        message: 'r2_read_failed',
        key,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

/** Base64-encode bytes for the vision LLM (chunked to avoid call-stack limits). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Parse + validate the LLM's JSON output, tolerating prose-wrapped JSON. */
function parseIntent(output: string): IntentExtractionResult {
  const empty = IntentExtractionResultSchema.parse({});
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end <= start) return empty;
  try {
    const raw = JSON.parse(output.slice(start, end + 1));
    if (typeof raw.urgency === 'number') raw.urgency = Math.round(Math.max(0, Math.min(100, raw.urgency)));
    const parsed = IntentExtractionResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

/** Last-resort intent when the LLM gave nothing usable. */
function fallbackIntent(transcript?: string, note?: string): string {
  const text = [transcript, note].filter(Boolean).join(' ').trim();
  return text || 'Visitor submitted an intake request without a parsable description.';
}

/**
 * Best-effort spend recording. Dynamically imports the token_burn_meter
 * service so this module has no hard dependency on it — if the budget module
 * is absent, intake still works.
 */
async function recordSpendIfMetered(env: Env, siteId: string): Promise<void> {
  try {
    const { recordSpend } = await import('../../../src/services/build_budget.js');
    const orgId = await orgIdForSite(env, siteId);
    if (!orgId) return;
    await recordSpend(env, orgId, {
      tokensIn: 0,
      tokensOut: 0,
      model: 'multimodal-intake/vision+whisper',
      usd: 0.01,
      siteId,
    });
  } catch {
    /* token_burn_meter not present — ignore */
  }
}

/** Resolve the owning org id for a site (null when not found). */
async function orgIdForSite(env: Env, siteId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(siteId)
    .first<{ org_id: string }>()
    .catch(() => null);
  return row?.org_id ?? null;
}

/** Insert the intake submission as a lead row; returns the new id. */
async function recordLead(env: Env, submission: IntakeSubmission): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await dbInsert(env.DB, 'intake_submissions', {
    id,
    site_id: submission.siteId,
    photo_url: submission.photoUrl ?? null,
    voice_transcript: submission.voiceTranscript ?? null,
    extracted_intent: JSON.stringify({
      intent: submission.extractedIntent,
      suggestedService: submission.suggestedService ?? null,
      suggestedFields: submission.suggestedFields,
    }),
    urgency: submission.urgency,
    booking_id: null,
    deleted_at: null,
  });
  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'multimodal_intake',
        feature_slug: FLAG_KEY,
        message: 'lead_insert_failed',
        site_id: submission.siteId,
        error,
      }),
    );
  }
  return id;
}

/**
 * Propose a booking when `native_booking_engine` is on for the site. We record
 * a proposed booking id on the lead row; the booking backend owns confirmation
 * + payment. Returns null when the booking backend is off or unavailable.
 */
async function proposeBookingIfEnabled(
  env: Env,
  submission: IntakeSubmission,
  leadId: string,
): Promise<string | null> {
  const on = await isFlagOn(env, BOOKING_FLAG_KEY, { siteId: submission.siteId }).catch(() => false);
  if (!on) return null;

  const bookingId = crypto.randomUUID();
  await env.DB.prepare(
    'UPDATE intake_submissions SET booking_id = ?, updated_at = ? WHERE id = ?',
  )
    .bind(bookingId, new Date().toISOString(), leadId)
    .run()
    .catch((err) => {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'multimodal_intake',
          feature_slug: FLAG_KEY,
          message: 'booking_link_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  return bookingId;
}
