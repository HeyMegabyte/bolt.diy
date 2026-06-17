/**
 * @module libs/features/cmdk_ai_actions/service
 * @description Business logic for the Cmd+K AI Actions feature module.
 *
 * Uses Workers AI (Llama 3.3 70B FP8) to resolve natural-language admin
 * commands to structured action intents.  The LLM output is validated through
 * {@link ResolvedActionSchema} before being returned — never passed raw.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { ResolvedActionSchema } from './schemas.js';
import type { ResolvedAction } from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'cmdk_ai_actions';

/** Workers AI model for natural-language intent resolution. */
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** System prompt instructing the model to return a JSON action object. */
const SYSTEM_PROMPT = `You are an assistant that maps user commands in an admin dashboard to structured actions.
Respond ONLY with a single JSON object matching this schema exactly:
{
  "action": one of ["navigate","create_site","open_settings","search","publish_site","view_analytics","manage_domains","open_docs","unknown"],
  "target": optional string (route or resource),
  "label": short human-readable label for the action,
  "confidence": number between 0 and 1
}
Do not include any text before or after the JSON object.`;

/**
 * Context hints the caller may supply to improve intent resolution.
 */
export interface ResolveContext {
  /** Current admin route (e.g. "/admin/sites"). */
  route?: string;
  /** Slug of the currently active site, if any. */
  siteSlug?: string;
  /** Additional freeform hint string. */
  hint?: string;
}

/**
 * Resolve a natural-language admin command to a structured action intent.
 *
 * @remarks
 * The method calls Workers AI with a strict JSON-output system prompt, then
 * validates the LLM response through {@link ResolvedActionSchema}.  On any
 * failure — quota, parse error, schema mismatch — it returns an `unknown`
 * action with low confidence instead of throwing.
 *
 * @param env     - Worker env (uses `env.AI`).
 * @param query   - Natural-language command from the user (≤512 chars).
 * @param context - Optional caller hints that refine intent resolution.
 * @returns A validated {@link ResolvedAction} or the fallback unknown action.
 *
 * @example
 * ```ts
 * const action = await resolveNlAction(env, 'go to analytics', { route: '/admin/sites' });
 * // { action: 'view_analytics', target: '/admin/analytics', label: 'View Analytics', confidence: 0.92 }
 * ```
 *
 * @throws Never — all errors are caught and return the fallback action.
 */
export async function resolveNlAction(
  env: Env,
  query: string,
  context?: ResolveContext,
): Promise<ResolvedAction> {
  const fallback: ResolvedAction = {
    action: 'unknown',
    label: 'Unknown command',
    confidence: 0,
  };

  const ai = (env as unknown as { AI?: { run: (model: string, inputs: object) => Promise<unknown> } }).AI;

  if (!ai?.run) {
    console.warn('[cmdk_ai_actions] Workers AI binding (env.AI) not available');
    return fallback;
  }

  // Build a concise user message that includes context when available.
  const contextLines: string[] = [];
  if (context?.route) contextLines.push(`Current route: ${context.route}`);
  if (context?.siteSlug) contextLines.push(`Active site: ${context.siteSlug}`);
  if (context?.hint) contextLines.push(`Hint: ${context.hint}`);

  const userMessage = contextLines.length > 0
    ? `${contextLines.join('\n')}\n\nUser command: ${query}`
    : `User command: ${query}`;

  try {
    const raw = await ai.run(AI_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 256,
      temperature: 0.1,
    });

    // Workers AI returns { response: string } for chat completions.
    const aiOutput = raw as Record<string, unknown>;
    const responseText = typeof aiOutput['response'] === 'string' ? aiOutput['response'].trim() : '';

    if (!responseText) {
      console.warn('[cmdk_ai_actions] Workers AI returned empty response');
      return fallback;
    }

    // Strip potential markdown code fences that some model configs emit.
    const jsonText = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.warn('[cmdk_ai_actions] LLM output was not valid JSON:', responseText.slice(0, 200));
      return fallback;
    }

    const validated = ResolvedActionSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[cmdk_ai_actions] LLM output failed schema validation', validated.error.issues);
      return fallback;
    }

    return validated.data;
  } catch (err) {
    console.warn('[cmdk_ai_actions] Workers AI call failed:', err);
    return fallback;
  }
}
