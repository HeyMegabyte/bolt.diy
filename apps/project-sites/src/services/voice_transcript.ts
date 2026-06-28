/**
 * @module services/voice_transcript
 * @description Persist a completed LiveKit voice call (transcript + metadata) into
 * the `voice_calls` table so it surfaces in the admin Conversations view. Called
 * by the LiveKit agent at call end over the HMAC-signed `/internal/voice/transcript`
 * endpoint (the agent runs on LiveKit Cloud, separate from this worker). Completes
 * the recording/transcript slice of `docs/decisions/voice-architecture.md`.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

import type { Env } from '../types/env.js';

import { dbInsert, dbQueryOne } from './db.js';

/** A single transcript turn. Matches `voice_calls.transcript_json` ([{role,text,ts_ms}]). */
const TranscriptTurnSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string().max(8000),
  ts_ms: z.number().optional(),
});

/** Request body for `/internal/voice/transcript`. */
export const TranscriptRequestSchema = z.object({
  /** The caller's number, when available. */
  callerNumber: z.string().max(32).optional(),
  /** Unique per-call id (the LiveKit room name) — dedupes via voice_calls UNIQUE. */
  callId: z.string().min(1).max(128),
  /** The dialed DID → maps to a site. */
  dialedNumber: z.string().min(3).max(32),
  durationSeconds: z.number().int().nonnegative().optional(),
  endedAtMs: z.number().optional(),
  startedAtMs: z.number().optional(),
  transcript: z.array(TranscriptTurnSchema).max(1000),
});
export type TranscriptRequest = z.infer<typeof TranscriptRequestSchema>;

/** Result of a transcript-persistence attempt — carries the attribution + sizing a
 * caller needs to emit a per-call analytics event without re-querying. */
export interface RecordVoiceTranscriptResult {
  stored: boolean;
  callId: string;
  /** Present only when `stored` — the call's owning site/org + sizing for metrics. */
  siteId?: string;
  orgId?: string;
  durationSeconds?: number;
  turnCount?: number;
}

/**
 * Store a completed call. Idempotent on `callId` (voice_calls.twilio_call_sid is
 * UNIQUE) — a retried POST is a no-op. Returns `{ stored:false }` when the dialed
 * number isn't mapped to an active site (nothing to attach the call to). When
 * stored, also returns the owning `siteId`/`orgId` + `durationSeconds`/`turnCount`
 * so the route can emit a `voice_call_completed` PostHog event (rec #42).
 */
export async function recordVoiceTranscript(
  env: Env,
  req: TranscriptRequest,
): Promise<RecordVoiceTranscriptResult> {
  const num = await dbQueryOne<{ id: string; site_id: string; org_id: string }>(
    env.DB,
    `SELECT id, site_id, org_id FROM voice_numbers
       WHERE phone_number = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
    [req.dialedNumber],
  );
  if (!num) return { callId: req.callId, stored: false };

  // Summary = the first few caller utterances, for the Conversations list preview.
  const summary =
    req.transcript
      .filter((t) => t.role === 'user')
      .map((t) => t.text)
      .join(' • ')
      .slice(0, 400) || null;

  const startedAt = req.startedAtMs ? new Date(req.startedAtMs).toISOString() : null;
  const endedAt = req.endedAtMs ? new Date(req.endedAtMs).toISOString() : new Date().toISOString();
  const duration =
    req.durationSeconds ??
    (req.startedAtMs && req.endedAtMs
      ? Math.max(0, Math.round((req.endedAtMs - req.startedAtMs) / 1000))
      : null);

  await dbInsert(env.DB, 'voice_calls', {
    direction: 'inbound',
    duration_seconds: duration,
    ended_at: endedAt,
    from_number: req.callerNumber ?? 'unknown',
    id: crypto.randomUUID(),
    org_id: num.org_id,
    site_id: num.site_id,
    started_at: startedAt,
    status: 'completed',
    summary,
    to_number: req.dialedNumber,
    transcript_json: JSON.stringify(req.transcript),
    twilio_call_sid: req.callId,
    voice_number_id: num.id,
  }).catch(() => {
    /* duplicate callId (retry) — idempotent, fine */
  });

  return {
    callId: req.callId,
    durationSeconds: duration ?? undefined,
    orgId: num.org_id,
    siteId: num.site_id,
    stored: true,
    turnCount: req.transcript.length,
  };
}
