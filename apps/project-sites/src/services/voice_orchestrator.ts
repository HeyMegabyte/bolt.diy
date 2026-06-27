/**
 * @module services/voice_orchestrator
 * @description Glue between Twilio SMS webhooks and the AI SMS agent.
 *
 * The inbound VOICE call path (AI receptionist) now runs on **LiveKit Cloud**
 * (Twilio number → SIP trunk → LiveKit → the `infra/voice-agent` worker) — see
 * `docs/decisions/voice-architecture.md`. The worker is no longer in the voice
 * audio path, so this module only handles inbound SMS.
 *
 * Public entry point:
 *  - {@link handleInboundSms} — returns TwiML for inbound SMS.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQueryOne } from './db.js';
import type { VoiceAgentBusinessProfile, VoiceAgentSiteSettings } from './voice_agent.js';
import { replyToInbound, type InboundSmsMessage } from './sms_agent.js';

// ─── Payload types ──────────────────────────────────────────────

export interface TwilioSmsWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body?: string;
  AccountSid?: string;
  NumMedia?: string;
}

// ─── Inbound SMS — return TwiML ─────────────────────────────────

/**
 * Handle an inbound SMS by running the AI agent and returning TwiML that
 * sends the reply in the same HTTP response (no extra Twilio API call).
 *
 * If the agent's reply is empty (e.g. honored STOP silently), returns an
 * empty `<Response/>`.
 */
export async function handleInboundSms(
  env: Env,
  payload: TwilioSmsWebhookPayload,
): Promise<string> {
  const numRow = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
  }>(
    env.DB,
    `SELECT id, site_id, org_id FROM voice_numbers
       WHERE phone_number = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
    [payload.To],
  );
  if (!numRow) return wrapTwiml('');

  const settings = await loadAgentSettings(env, numRow.site_id);
  const profile = await loadBusinessProfile(env, numRow.site_id);

  const msg: InboundSmsMessage = {
    siteId: numRow.site_id,
    orgId: numRow.org_id,
    voiceNumberId: numRow.id,
    fromNumber: payload.From,
    toNumber: payload.To,
    body: payload.Body ?? '',
    twilioMessageSid: payload.MessageSid,
  };

  const result = await replyToInbound(env, msg, profile, settings);
  if (!result.replyText) return wrapTwiml('');
  return wrapTwiml(`<Message>${escapeXml(result.replyText)}</Message>`);
}

// ─── helpers ────────────────────────────────────────────────────

async function loadAgentSettings(env: Env, siteId: string): Promise<VoiceAgentSiteSettings> {
  const row = await dbQueryOne<VoiceAgentSiteSettings>(
    env.DB,
    `SELECT voice_system_prompt, sms_system_prompt, voice_model, sms_model,
            voice_voice_id, escalation_phone, business_hours_json,
            knowledge_base_urls, max_call_seconds, recording_enabled,
            video_browse_enabled, mcp_connection_ids
       FROM voice_agent_settings
       WHERE site_id = ? AND deleted_at IS NULL LIMIT 1`,
    [siteId],
  );
  return row ?? {};
}

async function loadBusinessProfile(env: Env, siteId: string): Promise<VoiceAgentBusinessProfile> {
  const site = await dbQueryOne<{
    business_name: string | null;
    business_address: string | null;
  }>(env.DB, `SELECT business_name, business_address FROM sites WHERE id = ? LIMIT 1`, [siteId]);
  return {
    businessName: site?.business_name ?? 'this business',
    businessLocation: site?.business_address ?? undefined,
  };
}

function wrapTwiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
