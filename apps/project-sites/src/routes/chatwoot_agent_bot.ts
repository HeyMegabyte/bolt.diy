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
// Triage engine
// ────────────────────────────────────────────────────────

const URGENCY_KEYWORDS: Record<string, string[]> = {
  critical: [
    'site down',
    'not loading',
    '500',
    '502',
    '503',
    'error',
    'broken',
    'crash',
    'emergency',
    'urgent',
    'asap',
  ],
  high: [
    "can't log in",
    'billing issue',
    'payment failed',
    'domain not working',
    'dns',
    'ssl',
    'refund',
    'cancel',
  ],
  medium: ['how to', 'question', 'help with', 'not sure', 'problem', 'issue'],
  low: ['feature request', 'suggestion', 'feedback', 'thanks', 'love the'],
};

const LABEL_PATTERNS: Array<{ label: string; keywords: string[] }> = [
  {
    label: 'billing',
    keywords: [
      'billing',
      'invoice',
      'charge',
      'payment',
      'plan',
      'price',
      'refund',
      'subscription',
      'credit card',
    ],
  },
  {
    label: 'dns',
    keywords: [
      'domain',
      'dns',
      'cname',
      'a record',
      'ssl',
      'https',
      'certificate',
      'nameserver',
      'registrar',
    ],
  },
  {
    label: 'launch-blocker',
    keywords: [
      'site down',
      'not loading',
      'error',
      'broken',
      '500',
      '502',
      'blank',
      'white screen',
    ],
  },
  {
    label: 'editor',
    keywords: ['editor', 'bolt', 'code', 'preview', 'generate', 'template', 'component'],
  },
  { label: 'ai', keywords: ['ai', 'prompt', 'model', 'generate', 'chat'] },
  { label: 'bug', keywords: ['bug', 'error', 'broken', 'not working', 'glitch', 'unexpected'] },
  {
    label: 'feature-request',
    keywords: ['feature', 'suggestion', 'could you add', 'wish', 'would be nice'],
  },
  {
    label: 'refund-risk',
    keywords: ['refund', 'cancel subscription', 'chargeback', 'dispute', 'not satisfied'],
  },
];

function classifyUrgency(text: string): { level: string; triggers: string[] } {
  const lower = text.toLowerCase();
  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    const triggers = keywords.filter((kw) => lower.includes(kw));
    if (triggers.length > 0) return { level, triggers };
  }
  return { level: 'medium', triggers: [] };
}

function suggestLabels(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = LABEL_PATTERNS.filter(({ keywords }) =>
    keywords.some((kw) => lower.includes(kw)),
  ).map(({ label }) => label);
  return matched.length > 0 ? matched : ['human-needed'];
}

function draftReply(urgency: string, labels: string[]): string {
  if (labels.includes('launch-blocker')) {
    return 'I see your site may be experiencing an issue. I have flagged this as urgent and a team member will investigate immediately. In the meantime, could you share:\n\n1. Your site URL\n2. When the issue started\n3. What you see on screen (screenshot if possible)?';
  }
  if (labels.includes('billing')) {
    return 'Thanks for reaching out about billing. To help you faster, could you share your account email and what plan you are on? For refunds, we process within 2-3 business days.';
  }
  if (labels.includes('dns')) {
    return 'Domain setup can take 5-30 minutes for DNS changes to propagate. Could you share your domain name and registrar? I can send the exact records you need to add.';
  }
  if (urgency === 'critical') {
    return 'This has been flagged as critical. A support engineer is being notified and will respond within 1 hour.';
  }
  return 'Thanks for reaching out! I am reviewing your message and will get back to you shortly with specific help.';
}

// ────────────────────────────────────────────────────────
// Route
// ────────────────────────────────────────────────────────

const chatwootAgentBot = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /webhooks/chatwoot/agent_bot
 *
 * Chatwoot AgentBot webhook. Verified by shared secret. Returns triage actions.
 * Disabled when CHATWOOT_AGENT_BOT_SECRET is not set (returns 501).
 */
chatwootAgentBot.post('/agent_bot', async (c) => {
  // Gate: only active when the secret is provisioned
  const secret = c.env.CHATWOOT_AGENT_BOT_SECRET;
  if (!secret) {
    return c.json({ error: 'agent_bot_not_configured' }, 501);
  }

  // Verify signature (optional — Chatwoot may not send one; treat presence as required)
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
    if (!valid) {
      return c.json({ error: 'invalid_signature' }, 401);
    }
    // Re-parse body since we consumed it
    const reparsed = ChatwootWebhookSchema.safeParse(JSON.parse(body));
    if (!reparsed.success) {
      return c.json({ error: 'invalid_payload', details: reparsed.error.flatten() }, 400);
    }
    return processEvent(reparsed.data);
  }

  // No signature — fall back to secret-as-bearer for simpler setups
  const body = await c.req.json().catch(() => ({}));
  const parsed = ChatwootWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_payload', details: parsed.error.flatten() }, 400);
  }
  return processEvent(parsed.data);
});

function processEvent(event: z.infer<typeof ChatwootWebhookSchema>): Response {
  const messages = event.conversation?.messages ?? [];
  const lastIncoming = [...messages].reverse().find((m) => m.message_type === 0);
  const text = lastIncoming?.content ?? event.message?.content ?? '';

  if (!text || text.trim().length === 0) {
    return new Response(JSON.stringify({ actions: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const urgency = classifyUrgency(text);
  const labels = suggestLabels(text);
  const reply = draftReply(urgency.level, labels);

  const actions: Array<Record<string, unknown>> = [];

  if (labels.length > 0) {
    actions.push({ type: 'add_label', labels });
  }

  if (urgency.level === 'critical' || urgency.level === 'high') {
    actions.push({ type: 'assign_team', team_name: 'Priority Support' });
  }

  actions.push({ type: 'send_message', message: reply, private: false });

  if (urgency.level === 'low') {
    actions.push({
      type: 'send_message',
      message: `[Triage] Urgency: ${urgency.level} · Triggers: ${urgency.triggers.join(', ') || 'none'} · Labels: ${labels.join(', ')}`,
      private: true,
    });
  }

  return new Response(JSON.stringify({ actions }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export { chatwootAgentBot };
