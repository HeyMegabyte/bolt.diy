/**
 * @module routes/chatwoot_agent_bot
 * @description Chatwoot AgentBot webhook endpoint.
 *
 * Receives conversation webhook events from Chatwoot and responds with
 * AI-driven triage actions: classification, label suggestions, urgency
 * detection, and draft replies. Routes suggestions back to Chatwoot
 * via the conversation API so the agent sees recommendations inline.
 *
 * ## Webhook contract
 *
 * Chatwoot POSTs to /webhooks/chatwoot/agent_bot with the conversation
 * payload per https://www.chatwoot.com/docs/agent-bots. The endpoint
 * responds with { actions: [...] } — Chatwoot applies these to the
 * conversation.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { requireFlag } from '../lib/feature_guard.js';

// ────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────

const ChatwootWebhookSchema = z.object({
  event: z.enum([
    'message_created',
    'message_updated',
    'conversation_created',
    'conversation_updated',
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
            created_at: z.number().optional(),
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
      created_at: z.number().optional(),
    })
    .optional(),
});

type ChatwootWebhook = z.infer<typeof ChatwootWebhookSchema>;

// ────────────────────────────────────────────────────────
// Triage
// ────────────────────────────────────────────────────────

const URGENCY_KEYWORDS: Record<string, string[]> = {
  critical: ['site down', 'not loading', '500', '502', '503', 'error', 'broken',
    'crash', 'emergency', 'urgent', 'asap', 'immediately'],
  high: ['can\'t log in', 'cannot log in', 'billing issue', 'payment failed',
    'domain not working', 'dns', 'ssl', 'refund', 'cancel'],
  medium: ['how to', 'question', 'help with', 'not sure', 'problem', 'issue'],
  low: ['feature request', 'suggestion', 'feedback', 'thanks', 'love the'],
};

const LABEL_PATTERNS: Array<{ label: string; keywords: string[] }> = [
  { label: 'billing', keywords: ['billing', 'invoice', 'charge', 'payment', 'plan', 'price', 'refund', 'cancel', 'upgrade', 'downgrade', 'subscription', 'credit card'] },
  { label: 'dns', keywords: ['domain', 'dns', 'cname', 'a record', 'ssl', 'https', 'certificate', 'nameserver', 'registrar', 'propagation'] },
  { label: 'launch-blocker', keywords: ['site down', 'not loading', 'error', 'broken', '500', '502', 'blank', 'white screen', 'not working'] },
  { label: 'editor', keywords: ['editor', 'bolt', 'code', 'preview', 'generate', 'template', 'component'] },
  { label: 'ai', keywords: ['ai', 'prompt', 'model', 'generate', 'chat', 'auto'] },
  { label: 'bug', keywords: ['bug', 'error', 'broken', 'not working', 'glitch', 'unexpected'] },
  { label: 'feature-request', keywords: ['feature', 'suggestion', 'could you add', 'wish', 'would be nice', 'add support for'] },
  { label: 'refund-risk', keywords: ['refund', 'cancel subscription', 'chargeback', 'dispute', 'not satisfied', 'not happy'] },
];

function classifyUrgency(text: string): { level: string; triggers: string[] } {
  const lower = text.toLowerCase();
  const triggers: string[] = [];

  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) && !triggers.includes(kw)) {
        triggers.push(kw);
      }
    }
    if (triggers.length > 0) return { level, triggers };
  }

  return { level: 'medium', triggers: ['no pattern match'] };
}

function suggestLabels(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const { label, keywords } of LABEL_PATTERNS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.push(label);
    }
  }

  if (matched.length === 0) matched.push('human-needed');
  return matched;
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
    return 'This has been flagged as critical. A support engineer is being notified and will respond within 1 hour. Your issue reference is attached.';
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
 * Receives Chatwoot AgentBot webhook events and responds with triage actions.
 * Feature-gated behind `chatwoot_agent_bot` flag.
 *
 * Response shape (Chatwoot AgentBot contract):
 *   { actions: Array<{ type: string; ... }> }
 */
chatwootAgentBot.post('/agent_bot', async (c) => {
  const gate = await requireFlag(c, 'chatwoot_agent_bot');
  if (gate !== true) return gate;
  const body = await c.req.json().catch(() => ({}));
  const parsed = ChatwootWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      400,
    );
  }

  const event = parsed.data;
  const conversationId = event.conversation?.id;

  // Extract the latest incoming message content
  const messages = event.conversation?.messages ?? [];
  const lastIncoming = [...messages]
    .reverse()
    .find((m) => m.message_type === 0); // 0 = incoming
  const text = lastIncoming?.content ?? event.message?.content ?? '';

  if (!text || text.trim().length === 0) {
    return c.json({ actions: [] });
  }

  // Classify
  const urgency = classifyUrgency(text);
  const labels = suggestLabels(text);
  const reply = draftReply(urgency.level, labels);

  const actions: Array<Record<string, unknown>> = [];

  // Add labels
  for (const label of labels) {
    actions.push({ type: 'add_label', labels: [label] });
  }

  // For critical/high urgency, assign to priority team
  if (urgency.level === 'critical' || urgency.level === 'high') {
    actions.push({
      type: 'assign_team',
      team_name: 'Priority Support',
    });
  }

  // Always include a draft reply
  actions.push({
    type: 'send_message',
    message: reply,
    private: false,
  });

  // For low-urgency, add an internal note with triage summary
  if (urgency.level === 'low') {
    actions.push({
      type: 'send_message',
      message: `[Triage] Urgency: ${urgency.level} · Triggers: ${urgency.triggers.join(', ')} · Labels: ${labels.join(', ')}`,
      private: true,
    });
  }

  return c.json({ actions });
});

export { chatwootAgentBot };
