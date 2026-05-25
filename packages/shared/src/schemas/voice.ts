/**
 * @module schemas/voice
 * @description Zod schemas for the AI Voice + SMS Agent (Twilio-backed).
 *
 * | Schema                  | Use                                              |
 * | ----------------------- | ------------------------------------------------ |
 * | `voiceNumberSchema`     | A purchased Twilio phone number row              |
 * | `voiceCallSchema`       | A call record (inbound or outbound)              |
 * | `voiceMessageSchema`    | An SMS record (inbound or outbound)              |
 * | `voiceAgentSettingsSchema` | Per-site agent configuration                  |
 * | `vanitySuggestionSchema`  | A single AI-generated vanity word               |
 * | `numberSearchResultSchema` | One row in a Twilio AvailableNumbers response  |
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** E.164 phone string (e.g. `+18558225267`). */
export const e164Schema = z.string().regex(/^\+\d{8,15}$/, 'Must be E.164 (+12345678901)');

/** 3-7 letter vanity word (uppercased). */
export const vanityWordSchema = z
  .string()
  .regex(/^[A-Z]{3,7}$/, 'Vanity word must be 3-7 uppercase letters')
  .transform((s) => s.toUpperCase());

// ─── voice_numbers ──────────────────────────────────────────────

export const voiceNumberSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  phone_number: e164Schema,
  friendly_name: z.string().nullable().optional(),
  vanity_display: z.string().nullable().optional(),
  twilio_sid: z.string().nullable().optional(),
  capabilities: z
    .object({
      voice: z.boolean(),
      sms: z.boolean(),
      mms: z.boolean(),
      fax: z.boolean(),
    })
    .nullable()
    .optional(),
  voice_url: z.string().url().nullable().optional(),
  sms_url: z.string().url().nullable().optional(),
  monthly_cost_cents: z.number().int().nonnegative(),
  purchased_at: z.string().nullable().optional(),
  released_at: z.string().nullable().optional(),
  status: z.enum(['active', 'released', 'pending']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type VoiceNumber = z.infer<typeof voiceNumberSchema>;

// ─── voice_calls ────────────────────────────────────────────────

export const voiceCallSchema = z.object({
  id: z.string(),
  voice_number_id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  twilio_call_sid: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  from_number: e164Schema,
  to_number: e164Schema,
  status: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
  duration_seconds: z.number().int().nullable().optional(),
  recording_url: z.string().nullable().optional(),
  recording_sid: z.string().nullable().optional(),
  video_recording_url: z.string().nullable().optional(),
  transcript_json: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  sentiment: z
    .enum(['positive', 'neutral', 'negative', 'escalated_safety', 'flagged_scam'])
    .nullable()
    .optional(),
  cost_cents: z.number().int().nullable().optional(),
  hangup_reason: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type VoiceCall = z.infer<typeof voiceCallSchema>;

// ─── voice_messages ─────────────────────────────────────────────

export const voiceMessageSchema = z.object({
  id: z.string(),
  voice_number_id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  twilio_message_sid: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  from_number: e164Schema,
  to_number: e164Schema,
  body: z.string().nullable().optional(),
  media_urls: z.array(z.string().url()).nullable().optional(),
  status: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  ai_reply_id: z.string().nullable().optional(),
  cost_cents: z.number().int().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type VoiceMessage = z.infer<typeof voiceMessageSchema>;

// ─── voice_agent_settings ───────────────────────────────────────

export const voiceAgentSettingsSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  voice_system_prompt: z.string().nullable().optional(),
  sms_system_prompt: z.string().nullable().optional(),
  voice_provider: z.string().default('twilio-callgpt'),
  voice_voice_id: z.string().nullable().optional(),
  voice_model: z.string().nullable().optional(),
  sms_model: z.string().nullable().optional(),
  max_call_seconds: z.number().int().min(30).max(3600).default(600),
  recording_enabled: z.union([z.boolean(), z.number()]).default(1),
  video_browse_enabled: z.union([z.boolean(), z.number()]).default(1),
  mcp_connection_ids: z.array(z.string()).nullable().optional(),
  escalation_phone: e164Schema.nullable().optional(),
  business_hours_json: z.string().nullable().optional(),
  knowledge_base_urls: z.array(z.string().url()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type VoiceAgentSettings = z.infer<typeof voiceAgentSettingsSchema>;

export const updateVoiceAgentSettingsSchema = z.object({
  siteId: z.string().min(1),
  voice_system_prompt: z.string().max(8000).nullable().optional(),
  sms_system_prompt: z.string().max(8000).nullable().optional(),
  voice_voice_id: z.string().max(120).nullable().optional(),
  voice_model: z.string().max(120).nullable().optional(),
  sms_model: z.string().max(120).nullable().optional(),
  max_call_seconds: z.number().int().min(30).max(3600).optional(),
  recording_enabled: z.boolean().optional(),
  video_browse_enabled: z.boolean().optional(),
  mcp_connection_ids: z.array(z.string()).max(20).optional(),
  escalation_phone: e164Schema.nullable().optional(),
  business_hours_json: z.string().max(2000).nullable().optional(),
  knowledge_base_urls: z.array(z.string().url()).max(20).optional(),
});
export type UpdateVoiceAgentSettings = z.infer<typeof updateVoiceAgentSettingsSchema>;

// ─── vanity suggestion ─────────────────────────────────────────

export const vanitySuggestionSchema = z.object({
  word: vanityWordSchema,
  rationale: z.string().max(240),
  theme: z.enum(['name', 'service', 'location', 'usp', 'memorable']),
});
export type VanitySuggestion = z.infer<typeof vanitySuggestionSchema>;

// ─── number search result ──────────────────────────────────────

export const numberSearchResultSchema = z.object({
  phone_number: e164Schema,
  friendly_name: z.string(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  iso_country: z.string().length(2),
  capabilities: z.object({
    voice: z.boolean(),
    sms: z.boolean(),
    mms: z.boolean(),
    fax: z.boolean(),
  }),
  vanity_display: z.string().nullable().optional(),
  contains_digits: z.string().nullable().optional(),
});
export type NumberSearchResult = z.infer<typeof numberSearchResultSchema>;

// ─── purchase + release request bodies ─────────────────────────

export const purchaseNumberRequestSchema = z.object({
  siteId: z.string().min(1),
  phoneNumber: e164Schema,
  friendlyName: z.string().max(64).optional(),
  vanityWord: z
    .string()
    .regex(/^[A-Za-z]{3,7}$/)
    .transform((s) => s.toUpperCase())
    .optional(),
});
export type PurchaseNumberRequest = z.infer<typeof purchaseNumberRequestSchema>;
