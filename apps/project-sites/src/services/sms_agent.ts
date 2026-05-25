/**
 * @module services/sms_agent
 * @description Inbound SMS reply pipeline.
 *
 * Wraps {@link voice_agent.runTurn} for text-only conversations. Maintains
 * multi-turn context via the `voice_sessions` table keyed on
 * `(site_id, from_number)`. Honors STOP/UNSUBSCRIBE instantly and prepends
 * "Reply STOP to opt out." on the first reply per conversation.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbInsert, dbQueryOne, dbUpdate, dbExecute } from './db.js';
import {
  composeSystemPrompt,
  runTurn,
  type VoiceAgentBusinessProfile,
  type VoiceAgentSiteSettings,
} from './voice_agent.js';
import { sendSms } from './twilio.js';

export interface InboundSmsMessage {
  siteId: string;
  orgId: string;
  voiceNumberId: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  twilioMessageSid: string;
}

export interface InboundSmsResult {
  replyText: string;
  signal: 'ok' | 'opted_out_sms' | 'escalated_safety' | 'flagged_scam' | 'human_handoff';
  sent: boolean;
  ai_reply_id?: string;
  ai_reply_sid?: string;
}

interface SessionRow {
  id: string;
  context_json: string | null;
}

interface SessionContext {
  turns: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
  facts: Record<string, unknown>;
  opted_out_sms?: boolean;
  recording_opt_out?: boolean;
  first_reply_sent?: boolean;
}

const MAX_TURNS = 30;

/**
 * Reply to an inbound SMS:
 *   1. Persist the inbound message (idempotent via Twilio SID UNIQUE).
 *   2. Load/initialize the conversation session.
 *   3. Detect STOP → suppress reply, mark opt-out.
 *   4. Compose system prompt, run an LLM turn.
 *   5. Prepend "Reply STOP to opt out." on first reply.
 *   6. Send via Twilio, persist outbound row, advance session.
 */
export async function replyToInbound(
  env: Env,
  msg: InboundSmsMessage,
  profile: VoiceAgentBusinessProfile,
  settings: VoiceAgentSiteSettings,
): Promise<InboundSmsResult> {
  // 1. Persist inbound (idempotent — UNIQUE on twilio_message_sid)
  const inboundId = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbInsert(env.DB, 'voice_messages', {
    id: inboundId,
    voice_number_id: msg.voiceNumberId,
    site_id: msg.siteId,
    org_id: msg.orgId,
    twilio_message_sid: msg.twilioMessageSid,
    direction: 'inbound',
    from_number: msg.fromNumber,
    to_number: msg.toNumber,
    body: msg.body,
    media_urls: null,
    status: 'received',
    sent_at: now,
  }).catch(() => {
    /* duplicate Twilio retry — fine */
  });

  // 2. Session load/init
  const session = await loadOrCreateSession(env, msg.siteId, msg.fromNumber);
  const ctx = parseContext(session.context_json);

  // 3. Hard STOP path
  const lower = msg.body.trim().toLowerCase();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit)$/.test(lower)) {
    ctx.opted_out_sms = true;
    await persistSession(env, session.id, ctx);
    const confirmText =
      'You are unsubscribed. You will not receive further messages. Reply START to re-subscribe.';
    const sent = await safeSendSms(env, msg.toNumber, msg.fromNumber, confirmText);
    if (sent) {
      await persistOutbound(env, msg, sent.sid, confirmText, inboundId);
    }
    return {
      replyText: confirmText,
      signal: 'opted_out_sms',
      sent: !!sent,
      ai_reply_sid: sent?.sid,
    };
  }

  // 3b. Honor existing opt-out — drop silently per CAN-SPAM/TCPA
  if (ctx.opted_out_sms && !/^start$/.test(lower)) {
    return { replyText: '', signal: 'opted_out_sms', sent: false };
  }
  if (/^start$/.test(lower)) {
    ctx.opted_out_sms = false;
    ctx.first_reply_sent = false; // ensure re-disclosure on first message back
  }

  // 4. Compose prompt + run turn
  const systemPrompt = composeSystemPrompt(settings, profile, 'sms');
  const turn = await runTurn(env, {
    sessionId: session.id,
    siteId: msg.siteId,
    orgId: msg.orgId,
    systemPrompt,
    userTranscript: msg.body,
    history: ctx.turns.slice(-20).map((t) => ({ role: t.role, content: t.content })),
    mode: 'sms',
    model: settings.sms_model ?? undefined,
  });

  // 5. Prepend opt-out disclosure on first reply
  let replyText = turn.text || 'Got it — let me check on that and get back to you.';
  if (!ctx.first_reply_sent) {
    replyText = `${replyText}\n\nReply STOP to opt out.`;
    ctx.first_reply_sent = true;
  }
  // Twilio per-segment ~160 char limit; trim well-formed
  if (replyText.length > 1500) replyText = replyText.slice(0, 1480) + '…';

  // 6. Send + persist outbound
  const sent = await safeSendSms(env, msg.toNumber, msg.fromNumber, replyText);
  const outboundId = sent ? await persistOutbound(env, msg, sent.sid, replyText, inboundId) : undefined;

  // 7. Advance session
  ctx.turns.push({ role: 'user', content: msg.body, ts: Date.now() });
  ctx.turns.push({ role: 'assistant', content: replyText, ts: Date.now() });
  if (ctx.turns.length > MAX_TURNS) ctx.turns = ctx.turns.slice(-MAX_TURNS);
  await persistSession(env, session.id, ctx);

  return {
    replyText,
    signal: turn.signal === 'opted_out_sms' ? 'opted_out_sms' : turn.signal,
    sent: !!sent,
    ai_reply_id: outboundId,
    ai_reply_sid: sent?.sid,
  };
}

// ─── internal helpers ───────────────────────────────────────────

async function loadOrCreateSession(
  env: Env,
  siteId: string,
  fromNumber: string,
): Promise<SessionRow> {
  const existing = await dbQueryOne<SessionRow>(
    env.DB,
    `SELECT id, context_json FROM voice_sessions
       WHERE site_id = ? AND from_number = ? AND deleted_at IS NULL LIMIT 1`,
    [siteId, fromNumber],
  );
  if (existing) return existing;
  const id = crypto.randomUUID();
  await dbInsert(env.DB, 'voice_sessions', {
    id,
    site_id: siteId,
    from_number: fromNumber,
    last_active_at: new Date().toISOString(),
    context_json: JSON.stringify({ turns: [], facts: {} } satisfies SessionContext),
  });
  return { id, context_json: JSON.stringify({ turns: [], facts: {} }) };
}

function parseContext(raw: string | null): SessionContext {
  if (!raw) return { turns: [], facts: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<SessionContext>;
    return {
      turns: Array.isArray(parsed.turns) ? parsed.turns : [],
      facts: parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : {},
      opted_out_sms: !!parsed.opted_out_sms,
      recording_opt_out: !!parsed.recording_opt_out,
      first_reply_sent: !!parsed.first_reply_sent,
    };
  } catch {
    return { turns: [], facts: {} };
  }
}

async function persistSession(env: Env, sessionId: string, ctx: SessionContext): Promise<void> {
  await dbUpdate(
    env.DB,
    'voice_sessions',
    {
      context_json: JSON.stringify(ctx),
      last_active_at: new Date().toISOString(),
    },
    'id = ?',
    [sessionId],
  );
}

async function safeSendSms(
  env: Env,
  from: string,
  to: string,
  body: string,
): Promise<{ sid: string } | null> {
  try {
    const res = await sendSms(env, { from, to, body });
    return { sid: res.sid };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'sms_agent',
        message: 'twilio_send_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

async function persistOutbound(
  env: Env,
  msg: InboundSmsMessage,
  twilioSid: string,
  body: string,
  inReplyToId: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await dbInsert(env.DB, 'voice_messages', {
    id,
    voice_number_id: msg.voiceNumberId,
    site_id: msg.siteId,
    org_id: msg.orgId,
    twilio_message_sid: twilioSid,
    direction: 'outbound',
    from_number: msg.toNumber, // our number is the From for the reply
    to_number: msg.fromNumber,
    body,
    media_urls: null,
    status: 'queued',
    sent_at: new Date().toISOString(),
    ai_reply_id: inReplyToId,
  });
  // Back-link the inbound row to its AI reply id for easy timeline rendering.
  await dbExecute(
    env.DB,
    `UPDATE voice_messages SET ai_reply_id = ? WHERE id = ?`,
    [id, inReplyToId],
  ).catch(() => undefined);
  return id;
}

/**
 * Simulate an inbound SMS without going through Twilio (used by
 * `POST /api/voice/test/sms`). Persists nothing — pure dry run.
 */
export async function simulateInbound(
  env: Env,
  args: {
    siteId: string;
    orgId: string;
    body: string;
    profile: VoiceAgentBusinessProfile;
    settings: VoiceAgentSiteSettings;
  },
): Promise<{ replyText: string; signal: InboundSmsResult['signal']; model_used: string }> {
  const systemPrompt = composeSystemPrompt(args.settings, args.profile, 'sms');
  const turn = await runTurn(env, {
    sessionId: `sim-${Date.now()}`,
    siteId: args.siteId,
    orgId: args.orgId,
    systemPrompt,
    userTranscript: args.body,
    mode: 'sms',
    model: args.settings.sms_model ?? undefined,
  });
  return {
    replyText: `${turn.text}\n\nReply STOP to opt out.`,
    signal: turn.signal,
    model_used: turn.model_used,
  };
}
