/**
 * @module services/chatwoot_ai_triage
 * @description AI-powered triage engine for Chatwoot conversations.
 *
 * Replaces keyword-based classification with Workers AI Llama 3.3 70B
 * semantic analysis. Classifies intent, urgency, sentiment, and suggests
 * labels + routing in a single LLM call (<2s p99).
 *
 * ## Architecture
 *
 * ```
 * Chatwoot webhook → /webhooks/chatwoot/agent_bot
 *   → aiTriage.classify(text, context)
 *   → { intent, urgency, sentiment, labels, routing, confidence, draft_reply }
 *   → Chatwoot AgentBot actions response
 * ```
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface TriageContext {
  /** Customer email (if known) */
  contact_email?: string;
  /** Customer name (if known) */
  contact_name?: string;
  /** Conversation history (last 5 messages) */
  history?: string[];
  /** Channel the message came from */
  channel?: 'web_widget' | 'email' | 'api';
}

export interface TriageResult {
  /** Primary intent classification */
  intent:
    | 'billing'
    | 'dns'
    | 'site_down'
    | 'editor'
    | 'ai_help'
    | 'account'
    | 'feature_request'
    | 'bug_report'
    | 'general'
    | 'churn_risk';
  /** 0-100 urgency score */
  urgency: number;
  /** -1.0 to 1.0 sentiment */
  sentiment: number;
  /** Suggested labels */
  labels: string[];
  /** Routing recommendation */
  routing: {
    team: 'billing' | 'launch' | 'general' | 'engineering';
    priority: 'critical' | 'high' | 'normal' | 'low';
    /** Whether this should auto-resolve without human */
    auto_resolvable: boolean;
  };
  /** 0-100 confidence in the classification */
  confidence: number;
  /** AI-drafted reply (if auto-resolvable) */
  draft_reply: string | null;
  /** Brief summary for agent context */
  summary: string;
}

// ────────────────────────────────────────────────────────
// Prompt template
// ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support triage AI for ProjectSites, an AI-powered website builder for small businesses.
Classify the customer message. Return ONLY valid JSON — no explanation, no markdown.

ProjectSites context:
- Customers get AI-generated websites at {slug}.projectsites.dev
- Common issues: DNS setup, site not loading, billing questions, editor help
- Plans: Free (1 site), Starter ($19/mo, 3 sites), Pro ($49/mo, 10 sites)
- Site down = customer's generated website returns 5xx or blank page
- Launch blocker = site cannot go live (DNS, build failure, domain issue)
- VIP customers = Pro plan, marked as priority

Return JSON:
{
  "intent": "billing|dns|site_down|editor|ai_help|account|feature_request|bug_report|general|churn_risk",
  "urgency": 0-100,
  "sentiment": -1.0 to 1.0,
  "labels": ["label1", "label2"],
  "routing": {
    "team": "billing|launch|general|engineering",
    "priority": "critical|high|normal|low",
    "auto_resolvable": true|false
  },
  "confidence": 0-100,
  "summary": "one sentence summary of the issue"
}`;

function buildUserPrompt(text: string, ctx?: TriageContext): string {
  const parts: string[] = [`Customer message: "${text}"`];
  if (ctx?.contact_email) parts.push(`Contact: ${ctx.contact_email}`);
  if (ctx?.contact_name) parts.push(`Name: ${ctx.contact_name}`);
  if (ctx?.channel) parts.push(`Channel: ${ctx.channel}`);
  if (ctx?.history?.length) {
    parts.push(`Recent history:\n${ctx.history.map((m, i) => `  [${i + 1}] ${m}`).join('\n')}`);
  }
  return parts.join('\n');
}

// ────────────────────────────────────────────────────────
// Classifier
// ────────────────────────────────────────────────────────

/** Fallback triage when AI is unavailable — fast keyword path */
function keywordFallback(text: string): TriageResult {
  const lower = text.toLowerCase();

  // Intent detection
  let intent: TriageResult['intent'] = 'general';
  if (
    /\b(billing|invoice|charge|payment|plan|price|refund|subscription|cancel|downgrade)\b/.test(
      lower,
    )
  )
    intent = 'billing';
  else if (
    /\b(domain|dns|cname|a record|ssl|certificate|nameserver|registrar|propagation)\b/.test(lower)
  )
    intent = 'dns';
  else if (
    /\b(site down|not loading|500|502|503|blank|white screen|error page|won't load|can't access)\b/.test(
      lower,
    )
  )
    intent = 'site_down';
  else if (/\b(editor|bolt|code|preview|generate|template|component|css|html)\b/.test(lower))
    intent = 'editor';
  else if (/\b(ai|prompt|model|chat|auto|generate)\b/.test(lower)) intent = 'ai_help';
  else if (/\b(login|password|sign in|account|email|can't access)\b/.test(lower))
    intent = 'account';
  else if (/\b(feature|suggestion|could you|wish|would be nice|add support)\b/.test(lower))
    intent = 'feature_request';
  else if (/\b(bug|error|broken|glitch|unexpected|doesn't work)\b/.test(lower))
    intent = 'bug_report';
  else if (
    /\b(refund|cancel|switch|competitor|too expensive|not satisfied|not happy|leaving)\b/.test(
      lower,
    )
  )
    intent = 'churn_risk';

  // Urgency
  let urgency = 30;
  if (/\b(urgent|asap|immediately|emergency|critical)\b/.test(lower)) urgency = 95;
  else if (/\b(site down|not loading|500|502|503|down|broken|can't)\b/.test(lower)) urgency = 75;
  else if (/\b(refund|cancel|billing|payment)\b/.test(lower)) urgency = 60;
  else if (/\b(question|how to|help|wondering)\b/.test(lower)) urgency = 25;
  else if (/\b(feature|suggestion|thanks|love|great)\b/.test(lower)) urgency = 15;

  // Sentiment
  let sentiment = 0;
  if (/\b(thanks|love|great|awesome|amazing|perfect|wonderful|happy)\b/.test(lower))
    sentiment = 0.6;
  else if (/\b(frustrated|angry|terrible|awful|worst|useless|broken|hate)\b/.test(lower))
    sentiment = -0.6;
  else if (/\b(not working|issue|problem|help|confused|doesn't)\b/.test(lower)) sentiment = -0.3;

  // Labels
  const labels: string[] = [];
  if (intent === 'billing' || intent === 'churn_risk') labels.push('billing');
  if (intent === 'dns' || intent === 'site_down') labels.push('dns');
  if (intent === 'site_down') labels.push('launch-blocker');
  if (intent === 'editor' || intent === 'ai_help') labels.push('editor');
  if (intent === 'bug_report') labels.push('bug');
  if (intent === 'feature_request') labels.push('feature-request');
  if (intent === 'churn_risk') labels.push('refund-risk');
  if (urgency >= 70) labels.push('human-needed');
  if (labels.length === 0) labels.push('human-needed');

  return {
    intent,
    urgency,
    sentiment,
    labels,
    routing: {
      team:
        intent === 'billing' || intent === 'churn_risk'
          ? 'billing'
          : intent === 'site_down' || intent === 'dns'
            ? 'launch'
            : intent === 'bug_report'
              ? 'engineering'
              : 'general',
      priority:
        urgency >= 85 ? 'critical' : urgency >= 60 ? 'high' : urgency >= 30 ? 'normal' : 'low',
      auto_resolvable: intent === 'dns' || intent === 'account' || intent === 'general',
    },
    confidence: 60,
    draft_reply: null,
    summary: `[keyword] ${intent.replace(/_/g, ' ')} — urgency ${urgency}/100`,
  };
}

// ────────────────────────────────────────────────────────
// AI classify
// ────────────────────────────────────────────────────────

export async function classify(env: Env, text: string, ctx?: TriageContext): Promise<TriageResult> {
  try {
    const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(text, ctx) },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });

    const raw = (result as { response?: string })?.response ?? '';
    const parsed = JSON.parse(raw);

    return {
      intent: parsed.intent || 'general',
      urgency: Math.min(100, Math.max(0, Number(parsed.urgency) || 30)),
      sentiment: Math.min(1, Math.max(-1, Number(parsed.sentiment) || 0)),
      labels: Array.isArray(parsed.labels) ? parsed.labels : [],
      routing: {
        team: parsed.routing?.team || 'general',
        priority: parsed.routing?.priority || 'normal',
        auto_resolvable: parsed.routing?.auto_resolvable || false,
      },
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 70)),
      draft_reply: parsed.draft_reply || null,
      summary: parsed.summary || `${parsed.intent || 'general'} inquiry`,
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'AI triage failed, falling back to keyword',
        error: (err as Error).message,
      }),
    );
    return keywordFallback(text);
  }
}

/**
 * Classify with caching. Same contact + same topic within 60s = cached result.
 * Saves ~$0.0002 per duplicate classification.
 */
const cache = new Map<string, { result: TriageResult; ts: number }>();

export async function classifyCached(
  env: Env,
  text: string,
  ctx?: TriageContext,
): Promise<TriageResult> {
  const key = `${ctx?.contact_email ?? 'anon'}:${text.slice(0, 100)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < 60_000) return cached.result;

  const result = await classify(env, text, ctx);
  cache.set(key, { result, ts: Date.now() });

  // Keep cache bounded
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort(([, a], [, b]) => a.ts - b.ts).slice(0, 100);
    oldest.forEach(([k]) => cache.delete(k));
  }

  return result;
}
