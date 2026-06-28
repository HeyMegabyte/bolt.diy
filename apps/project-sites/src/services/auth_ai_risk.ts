/**
 * @module services/auth_ai_risk
 *
 * @description
 * AI-native login-risk scoring (#45). When the cheap heuristic (#44 anomaly) has
 * ALREADY flagged a login as deviating, this asks Workers AI (Llama 3.1 8B FP8 —
 * fast + free at the edge) to grade the severity and recommend a response. It is
 * NEVER called on the clean-login hot path — only on already-flagged logins — so
 * the LLM cost stays proportional (cost-per-request-accountability).
 *
 * The model output is Zod-validated (contract-first-ai). On ANY failure (AI down,
 * bad JSON, schema miss) it FAILS SAFE to `challenge` — a flagged login we cannot
 * grade gets step-up auth, never a silent `allow`.
 */
import { z } from 'zod';
import type { Env } from '../types/env.js';

/** Llama 3.1 8B FP8 — light classification, free Workers-AI tier (model-routing). */
const RISK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';

/** The validated risk verdict contract. */
export const LoginRiskSchema = z.object({
  /** 0 (benign) … 1 (almost certainly malicious). */
  risk: z.number().min(0).max(1),
  /** What to do: let it through, step-up challenge, or hard block. */
  recommendation: z.enum(['allow', 'challenge', 'block']),
  /** One short human-readable sentence. */
  reason: z.string().min(1).max(280),
});
export type LoginRisk = z.infer<typeof LoginRiskSchema>;

/** Context describing the already-flagged login. */
export interface LoginRiskContext {
  /** Anomaly reasons from #44, e.g. `['new_ip','new_device']`. */
  readonly reasons: readonly string[];
  /** Client IP (may be ''). */
  readonly ip: string;
  /** Client user-agent (may be ''). */
  readonly userAgent: string;
}

/** Fail-safe verdict: a flagged login we cannot grade gets a step-up challenge. */
const FAILSAFE: LoginRisk = {
  risk: 0.5,
  recommendation: 'challenge',
  reason: 'AI risk scoring unavailable — defaulting to step-up challenge.',
};

const SYSTEM_PROMPT =
  'You are a security analyst grading a flagged login. Respond with ONLY a compact JSON ' +
  'object: {"risk": <0..1>, "recommendation": "allow"|"challenge"|"block", "reason": "<one sentence>"}. ' +
  'A brand-new IP and device together is moderate risk (challenge). Multiple strong signals ' +
  'are high risk (block). No prose outside the JSON.';

/** Extract the first balanced JSON object from a model response (tolerant of prose). */
function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('no json');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Grade a flagged login with Workers AI. Never throws — returns {@link FAILSAFE}
 * on any error. Call ONLY for logins #44 already flagged.
 *
 * @param env - Worker env (needs the `AI` binding).
 * @param ctx - The flagged-login {@link LoginRiskContext}.
 * @returns A Zod-validated {@link LoginRisk} (or the fail-safe challenge verdict).
 *
 * @example
 * const v = await assessLoginRisk(env, { reasons: ['new_ip','new_device'], ip, userAgent });
 * if (v.recommendation === 'block') await lockSession();
 */
export async function assessLoginRisk(env: Env, ctx: LoginRiskContext): Promise<LoginRisk> {
  try {
    const user =
      `Flagged login.\nSignals: ${ctx.reasons.join(', ') || 'none'}\n` +
      `IP: ${ctx.ip || 'unknown'}\nUser-Agent: ${ctx.userAgent || 'unknown'}`;
    const out = (await env.AI.run(RISK_MODEL as Parameters<Env['AI']['run']>[0], {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    })) as { response?: string };
    const parsed = LoginRiskSchema.safeParse(firstJsonObject(out.response ?? ''));
    return parsed.success ? parsed.data : FAILSAFE;
  } catch {
    return FAILSAFE;
  }
}
