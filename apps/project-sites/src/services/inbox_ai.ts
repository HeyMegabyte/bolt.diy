/**
 * @module services/inbox_ai
 *
 * @description
 * AI surface for Pulse Inbox. Sentiment + intent classifiers, multi-tone
 * reply drafter, conversation summarizer, next-action suggester, and a
 * contact-data extractor that auto-fills `chat_contacts.custom_attrs` from
 * inbound message content.
 *
 * @remarks
 * All Workers AI calls pin `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and
 * inherit the dashboard's HBO-tier executive voice. Outputs that need to
 * be machine-parsed request `response_format: json_object` and run through
 * a tolerant JSON extractor so a single malformed token never kills the
 * webhook path.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { DASHBOARD_PERSONA_SYSTEM_PROMPT } from '../prompts/dashboard_persona.js';
import { dbQuery, dbQueryOne } from './db.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export type Sentiment = 'positive' | 'neutral' | 'negative';
export type Intent = 'sales' | 'support' | 'billing' | 'complaint' | 'other';

interface AiRunResponse {
  response?: string;
}

async function callAi(
  env: Env,
  systemExtra: string,
  user: string,
  options: { json?: boolean; maxTokens?: number } = {},
): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content: [DASHBOARD_PERSONA_SYSTEM_PROMPT, systemExtra].join('\n\n'),
    },
    { role: 'user' as const, content: user },
  ];
  const params: Record<string, unknown> = {
    messages,
    stream: false,
    max_tokens: options.maxTokens ?? 500,
  };
  if (options.json) {
    params['response_format'] = { type: 'json_object' };
  }
  const result = (await env.AI.run(
    MODEL as Parameters<typeof env.AI.run>[0],
    params as never,
  )) as AiRunResponse;
  return (result.response ?? '').trim();
}

function parseJson<T>(raw: string, fallback: T): T {
  const stripped = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
  const objMatch = stripped.match(/[{[][\s\S]*[}\]]/);
  const body = objMatch ? objMatch[0] : stripped;
  try {
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

// ─── Classification ─────────────────────────────────────────────────────

const SENTIMENT_SYS = `# TASK — Sentiment classifier
Return STRICT JSON: { "sentiment": "positive" | "neutral" | "negative" }
- positive = happy, grateful, enthusiastic
- negative = angry, frustrated, disappointed
- neutral = informational, transactional, ambiguous
Never invent any other label.`;

/**
 * Classify the emotional tone of a single message. Used by the inbox
 * webhook handler to tag every inbound message in real time.
 */
export async function classifySentiment(
  env: Env,
  input: { content: string },
): Promise<Sentiment> {
  if (!input.content || input.content.trim().length < 2) return 'neutral';
  const raw = await callAi(env, SENTIMENT_SYS, input.content, { json: true, maxTokens: 60 });
  const parsed = parseJson<{ sentiment?: string }>(raw, { sentiment: 'neutral' });
  const label = (parsed.sentiment ?? 'neutral').toLowerCase();
  if (label === 'positive' || label === 'negative') return label;
  return 'neutral';
}

const INTENT_SYS = `# TASK — Intent classifier
Return STRICT JSON: { "intent": "sales" | "support" | "billing" | "complaint" | "other" }
- sales = pre-purchase questions, pricing curiosity, demo asks
- support = how-do-I, broken-thing, integration questions
- billing = invoice, refund, subscription, payment-failed
- complaint = explicit dissatisfaction, escalation, churn risk
- other = greeting, off-topic, spam
Never invent any other label.`;

export interface ClassifyIntentInput {
  content: string;
  history?: { role: 'contact' | 'agent'; content: string }[];
}

/**
 * Classify the operational intent of a message in the context of its
 * conversation history. History is capped to last 6 turns to stay under
 * the model's 4K-token budget.
 */
export async function classifyIntent(
  env: Env,
  input: ClassifyIntentInput,
): Promise<Intent> {
  if (!input.content || input.content.trim().length < 2) return 'other';
  const history = (input.history ?? []).slice(-6);
  const historyLine = history.length
    ? `\n\nCONVERSATION HISTORY:\n${history.map((h) => `${h.role}: ${h.content.slice(0, 400)}`).join('\n')}`
    : '';
  const user = `${input.content}${historyLine}`;
  const raw = await callAi(env, INTENT_SYS, user, { json: true, maxTokens: 60 });
  const parsed = parseJson<{ intent?: string }>(raw, { intent: 'other' });
  const label = (parsed.intent ?? 'other').toLowerCase();
  if (label === 'sales' || label === 'support' || label === 'billing' || label === 'complaint') {
    return label;
  }
  return 'other';
}

// ─── Reply drafting ─────────────────────────────────────────────────────

export interface DraftReplyInput {
  conversation_id: string;
  instruction?: string;
  context_messages: { role: 'contact' | 'agent' | 'system'; content: string }[];
}

export interface ReplyDraft {
  content: string;
  tone: 'concise' | 'warm' | 'formal';
  confidence: number;
}

const DRAFT_SYS = `# TASK — Reply drafter
You return THREE drafts for the same agent reply: concise / warm / formal.
- concise: 1-2 sentences. Answer, then a single action.
- warm: 2-3 sentences. Acknowledge feeling, then answer, then next step.
- formal: 2-3 sentences. Professional, no contractions, business letter cadence.
Each draft must be answerable, never a stall. No "I'll get back to you" prose.

Return STRICT JSON:
{
  "drafts": [
    { "tone": "concise", "content": "...", "confidence": 0.0-1.0 },
    { "tone": "warm",    "content": "...", "confidence": 0.0-1.0 },
    { "tone": "formal",  "content": "...", "confidence": 0.0-1.0 }
  ]
}
Confidence reflects how grounded the draft is in the conversation context.
A reply that requires customer-record lookup we don't have should score <0.6.`;

/**
 * Draft three reply variants for an agent — concise / warm / formal.
 * Confidence scores let the auto-reply gate decide whether to ship without
 * human review (threshold lives in inbox config, default 0.85).
 */
export async function draftReply(
  env: Env,
  input: DraftReplyInput,
): Promise<{ drafts: ReplyDraft[] }> {
  const ctxBody = input.context_messages
    .slice(-12)
    .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
    .join('\n');
  const user = [
    input.instruction ? `INSTRUCTION: ${input.instruction}` : '',
    'CONVERSATION:',
    ctxBody,
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await callAi(env, DRAFT_SYS, user, { json: true, maxTokens: 900 });
  const parsed = parseJson<{ drafts?: ReplyDraft[] }>(raw, { drafts: [] });
  const drafts = (parsed.drafts ?? [])
    .filter((d) => d && typeof d.content === 'string' && d.content.length > 0)
    .map((d) => ({
      content: d.content,
      tone: (['concise', 'warm', 'formal'] as const).includes(d.tone) ? d.tone : 'concise',
      confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0.7)),
    }));

  // Always return 3 — fill missing tones from the first draft so callers
  // can rely on the shape.
  while (drafts.length < 3) {
    const fallback = drafts[0] ?? { content: '', tone: 'concise' as const, confidence: 0.5 };
    const tones: ReplyDraft['tone'][] = ['concise', 'warm', 'formal'];
    drafts.push({
      content: fallback.content,
      tone: tones[drafts.length] ?? 'concise',
      confidence: fallback.confidence,
    });
  }

  return { drafts: drafts.slice(0, 3) };
}

// ─── Summarize ──────────────────────────────────────────────────────────

const SUMMARIZE_SYS = `# TASK — Conversation summarizer
Output ONE paragraph of 2-4 sentences. Capture: who, asking what, current
state, blockers/next-step. No bullets. No quotes. No name-drop unless
load-bearing for the next agent picking it up.`;

/**
 * Summarize a conversation in 2-4 sentences for handoff between agents.
 */
export async function summarizeConversation(
  env: Env,
  input: { conversation_id: string },
): Promise<string> {
  const messages = await dbQuery<{ direction: string; sender_type: string; content: string }>(
    env.DB,
    `SELECT direction, sender_type, content FROM chat_messages
     WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 40`,
    [input.conversation_id],
  );
  if (!messages.data.length) return '';
  const body = messages.data
    .map((m) => `${m.sender_type} (${m.direction}): ${m.content.slice(0, 400)}`)
    .join('\n');
  return callAi(env, SUMMARIZE_SYS, body, { maxTokens: 300 });
}

// ─── Suggest next actions ───────────────────────────────────────────────

const NEXT_ACTIONS_SYS = `# TASK — Next-action suggester
Look at the conversation and return 1-4 concrete next actions an agent
should take. Each action is 2-6 words; reason is one short sentence.

Return STRICT JSON:
{ "actions": [{ "action": "Send pricing PDF", "reason": "Asked twice about cost" }] }`;

export interface NextAction {
  action: string;
  reason: string;
}

/**
 * Suggest 1-4 concrete next actions an agent should take based on the
 * full conversation history.
 */
export async function suggestNextActions(
  env: Env,
  input: { conversation_id: string },
): Promise<NextAction[]> {
  const messages = await dbQuery<{ direction: string; sender_type: string; content: string }>(
    env.DB,
    `SELECT direction, sender_type, content FROM chat_messages
     WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 40`,
    [input.conversation_id],
  );
  if (!messages.data.length) return [];
  const body = messages.data
    .map((m) => `${m.sender_type} (${m.direction}): ${m.content.slice(0, 400)}`)
    .join('\n');
  const raw = await callAi(env, NEXT_ACTIONS_SYS, body, { json: true, maxTokens: 400 });
  const parsed = parseJson<{ actions?: NextAction[] }>(raw, { actions: [] });
  return (parsed.actions ?? [])
    .filter((a) => a && typeof a.action === 'string' && a.action.trim().length)
    .slice(0, 4);
}

// ─── Customer data extraction ───────────────────────────────────────────

const EXTRACT_SYS = `# TASK — Customer data extractor
Extract structured contact data the writer disclosed in their message.
Return STRICT JSON with the keys present ONLY when actually found.

{
  "email": "extracted email or omit",
  "phone": "E.164 format if possible, or raw, or omit",
  "company": "company name or omit",
  "intent": "sales | support | billing | complaint | other"
}

Never invent values. Omit a key entirely if no signal exists.`;

export interface ExtractedCustomerData {
  email?: string;
  phone?: string;
  company?: string;
  intent: Intent;
}

/**
 * Extract email, phone, company, and intent from a single inbound message.
 * Used by the inbox webhook to auto-populate `chat_contacts.custom_attrs`.
 */
export async function extractCustomerData(
  env: Env,
  input: { content: string },
): Promise<ExtractedCustomerData> {
  if (!input.content || input.content.trim().length < 2) return { intent: 'other' };
  const raw = await callAi(env, EXTRACT_SYS, input.content, { json: true, maxTokens: 200 });
  const parsed = parseJson<ExtractedCustomerData>(raw, { intent: 'other' });
  const intent: Intent = (['sales', 'support', 'billing', 'complaint', 'other'] as const).includes(
    parsed.intent as Intent,
  )
    ? (parsed.intent as Intent)
    : 'other';
  const out: ExtractedCustomerData = { intent };
  if (parsed.email && /@/.test(parsed.email)) out.email = parsed.email.trim();
  if (parsed.phone && /\d/.test(parsed.phone)) out.phone = parsed.phone.trim();
  if (parsed.company && parsed.company.trim().length > 1) out.company = parsed.company.trim();
  return out;
}

// ─── Auto-reply gate ────────────────────────────────────────────────────

/**
 * Pure helper for the inbox webhook handler — decides whether an
 * auto-reply should be sent based on inbox config + draft confidence.
 * Kept here so the routes/inbox.ts owner can simply import + call.
 */
export function shouldAutoSend(
  config: { auto_reply?: { enabled?: boolean; auto_send?: boolean; confidence_threshold?: number } } | null,
  draft: ReplyDraft | undefined,
): boolean {
  if (!config?.auto_reply?.enabled) return false;
  if (!config.auto_reply.auto_send) return false;
  if (!draft) return false;
  const threshold = config.auto_reply.confidence_threshold ?? 0.85;
  return draft.confidence >= threshold;
}

/**
 * Read inbox config JSON safely — soft-fails to null so callers can
 * branch without try/catch noise.
 */
export async function loadInboxConfig(
  env: Env,
  inboxId: string,
): Promise<{ auto_reply?: { enabled?: boolean; auto_send?: boolean; confidence_threshold?: number } } | null> {
  const row = await dbQueryOne<{ config_json: string | null }>(
    env.DB,
    `SELECT config_json FROM chat_inboxes WHERE id = ?`,
    [inboxId],
  );
  if (!row?.config_json) return null;
  try {
    return JSON.parse(row.config_json) as {
      auto_reply?: { enabled?: boolean; auto_send?: boolean; confidence_threshold?: number };
    };
  } catch {
    return null;
  }
}
