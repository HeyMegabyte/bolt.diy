/**
 * @module services/outreach_router
 * @description Lead Scanner #96 — channel router + drip sequence. Pure,
 * deterministic state machine the orchestrator (#87) runs to decide HOW and WHEN
 * to contact a discovered lead: channel by confidence (email / postcard / both),
 * and the next drip step (email → nudge → postcard → final), stopping instantly
 * on a reply. Zero I/O — the caller resolves history + persists the decision.
 *
 * @packageDocumentation
 */

import type { OutreachChannel } from './lead_propensity.js';

/** The ordered drip ladder. `done` is the terminal (no further contact). */
export type DripStep = 'email' | 'nudge' | 'postcard' | 'final' | 'done';

/** Inputs that determine the next outreach step. */
export interface OutreachState {
  /** 0–1 confidence we can reach this lead by email (MX/verify result). */
  readonly emailConfidence: number;
  /** 0–1 confidence the postal address is deliverable (USPS/Lob check). */
  readonly addressConfidence: number;
  /** Steps already sent, in order. */
  readonly sentSteps?: readonly DripStep[];
  /** True once the lead replied / engaged — hard stop. */
  readonly replied?: boolean;
}

/** Minimum confidence to use a channel at all. */
const EMAIL_MIN = 0.5;
const ADDRESS_MIN = 0.6;

/**
 * Choose the contact channel for a lead from its reachability confidences.
 * `both` only when BOTH clear their bar (highest-value leads); `none` when
 * neither does (don't spend on an unreachable lead).
 *
 * @param state - Reachability confidences.
 * @returns The {@link OutreachChannel}.
 *
 * @example
 * chooseChannel({ emailConfidence: 0.9, addressConfidence: 0.2 }); // 'email'
 */
export function chooseChannel(
  state: Pick<OutreachState, 'emailConfidence' | 'addressConfidence'>,
): OutreachChannel {
  const email = state.emailConfidence >= EMAIL_MIN;
  const post = state.addressConfidence >= ADDRESS_MIN;
  if (email && post) return 'both';
  if (email) return 'email';
  if (post) return 'postcard';
  return 'none';
}

/**
 * Decide the next drip step. The ladder is email → nudge (2nd email) → postcard
 * → final, but each step is SKIPPED when its channel isn't viable for the lead
 * (e.g. no postcard when the address is undeliverable). A reply, or an exhausted
 * ladder, returns `done`.
 *
 * @param state - Confidences + what's already been sent + replied flag.
 * @returns The next {@link DripStep} to send, or `done`.
 *
 * @example
 * nextDripStep({ emailConfidence: 0.9, addressConfidence: 0.9, sentSteps: ['email'] }); // 'nudge'
 */
export function nextDripStep(state: OutreachState): DripStep {
  if (state.replied) return 'done';
  const channel = chooseChannel(state);
  if (channel === 'none') return 'done';

  const canEmail = channel === 'email' || channel === 'both';
  const canPost = channel === 'postcard' || channel === 'both';
  const sent = new Set(state.sentSteps ?? []);

  // Ladder in priority order; emit the first viable step not yet sent.
  const ladder: ReadonlyArray<{ step: DripStep; viable: boolean }> = [
    { step: 'email', viable: canEmail },
    { step: 'nudge', viable: canEmail },
    { step: 'postcard', viable: canPost },
    { step: 'final', viable: canPost },
  ];
  for (const { step, viable } of ladder) {
    if (viable && !sent.has(step)) return step;
  }
  return 'done';
}
