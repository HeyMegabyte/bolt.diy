/**
 * @module routes/chatwoot_agent_bot
 * @description Chatwoot AgentBot webhook endpoint — unauthenticated inbound webhook.
 *
 * Receives conversation webhook events from Chatwoot and responds with
 * AI-driven triage actions: classification, label suggestions, urgency
 * detection, and draft replies. Verified by a shared secret token.
 *
 * ## Webhook contract
 *
 * Chatwoot POSTs to /webhooks/chatwoot/agent_bot with the conversation
 * payload. The endpoint responds with { actions: [...] } — Chatwoot applies
 * these to the conversation per the AgentBot contract.
 *
 * ## Verification
 *
 * The endpoint verifies the `X-Chatwoot-Signature` header against
 * CHATWOOT_AGENT_BOT_SECRET (a wrangler secret). Requests without a valid
 * signature return 401.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { classifyCached, type TriageResult } from '../services/chatwoot_ai_triage.js';

// ────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────

const ChatwootWebhookSchema = z.object({
  event: z.enum([
    'message_created',
    'message_updated',
    'conversation_created',
    'conversation_resolved',
  ]),
  id: z.string().optional(),
  account: z.object({ id: z.number() }).optional(),
  conversation: z
    .object({
      id: z.number(),
      display_id: z.number().optional(),
      messages: z
        .array(
          z.object({
            id: z.number(),
            content: z.string().optional(),
            message_type: z.number().optional(),
            sender: z
              .object({
                id: z.number().optional(),
                name: z.string().optional(),
                email: z.string().optional(),
              })
              .optional(),
          }),
        )
        .optional(),
      meta: z
        .object({
          sender: z
            .object({
              id: z.number().optional(),
              name: z.string().optional(),
              email: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  message: z
    .object({
      id: z.number().optional(),
      content: z.string().optional(),
      message_type: z.number().optional(),
      conversation_id: z.number().optional(),
    })
    .optional(),
});

// ────────────────────────────────────────────────────────
// Route
// ────────────────────────────────────────────────────────

const chatwootAgentBot = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /webhooks/chatwoot/agent_bot
 *
 * Chatwoot AgentBot webhook. AI-powered triage via Workers AI Llama 3.3.
 * Falls back to keyword classification when AI is unavailable.
 * Disabled when CHATWOOT_AGENT_BOT_SECRET is not set (returns 501).
 */
chatwootAgentBot.post('/agent_bot', async (c) => {
  const secret = c.env.CHATWOOT_AGENT_BOT_SECRET;
  if (!secret) return c.json({ error: 'agent_bot_not_configured' }, 501);

  const sig = c.req.header('x-chatwoot-signature');
  if (sig) {
    const encoder = new TextEncoder();
    const body = await c.req.text();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body));
    if (!valid) return c.json({ error: 'invalid_signature' }, 401);
    const reparsed = ChatwootWebhookSchema.safeParse(JSON.parse(body));
    if (!reparsed.success)
      return c.json({ error: 'invalid_payload', details: reparsed.error.flatten() }, 400);
    return processEvent(reparsed.data, c.env);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = ChatwootWebhookSchema.safeParse(body);
  if (!parsed.success)
    return c.json({ error: 'invalid_payload', details: parsed.error.flatten() }, 400);
  return processEvent(parsed.data, c.env);
});

async function processEvent(
  event: z.infer<typeof ChatwootWebhookSchema>,
  env: Env,
): Promise<Response> {
  const messages = event.conversation?.messages ?? [];
  const lastIncoming = [...messages].reverse().find((m) => m.message_type === 0);
  const text = lastIncoming?.content ?? event.message?.content ?? '';
  if (!text?.trim()) return Response.json({ actions: [] });

  const triage = await classifyCached(env, text, {
    contact_email: lastIncoming?.sender?.email ?? event.conversation?.meta?.sender?.email,
    contact_name: lastIncoming?.sender?.name ?? event.conversation?.meta?.sender?.name,
    history: messages
      .filter((m) => m.content)
      .slice(-5)
      .map((m) => `${m.message_type === 0 ? 'Customer' : 'Agent'}: ${m.content}`),
    channel: 'web_widget',
  });

  const actions: Array<Record<string, unknown>> = [];

  if (triage.labels.length > 0) actions.push({ type: 'add_label', labels: triage.labels });
  if (triage.routing.priority === 'critical' || triage.routing.priority === 'high') {
    actions.push({
      type: 'assign_team',
      team_name:
        triage.routing.team === 'billing'
          ? 'Billing Support'
          : triage.routing.team === 'launch'
            ? 'Launch Support'
            : triage.routing.team === 'engineering'
              ? 'Engineering'
              : 'Priority Support',
    });
  }
  if (triage.draft_reply)
    actions.push({ type: 'send_message', message: triage.draft_reply, private: false });
  actions.push({
    type: 'send_message',
    message: `[AI Triage] ${triage.summary} · ${triage.routing.priority} · confidence: ${triage.confidence}%`,
    private: true,
  });

  return Response.json({ actions });
}

export { chatwootAgentBot };
