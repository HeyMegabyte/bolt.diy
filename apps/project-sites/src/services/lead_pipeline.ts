/**
 * @module services/lead_pipeline
 * @description Lead Scanner #94 — CRM pipeline stage machine. Pure, deterministic
 * transition rules for a discovered lead's lifecycle:
 *   discovered → enriched → contacted → build_triggered → preview_sent → claimed
 * with `lost` as a terminal reachable from any non-terminal stage. The claim
 * webhook + CRM sync (#94 wiring) call `applyLeadEvent` to advance a lead and
 * reject illegal jumps; this layer is zero-I/O so it unit-tests with no DB.
 *
 * @packageDocumentation
 */

/** Ordered lifecycle stages (forward progression) + the two terminals. */
export const LEAD_STAGES = [
  'discovered',
  'enriched',
  'contacted',
  'build_triggered',
  'preview_sent',
  'claimed',
  'lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** The forward funnel order (terminals excluded). */
const FORWARD: readonly LeadStage[] = [
  'discovered',
  'enriched',
  'contacted',
  'build_triggered',
  'preview_sent',
];

/** Events that drive transitions. `lose` is allowed from any non-terminal. */
export type LeadEvent =
  | 'enrich'
  | 'contact'
  | 'trigger_build'
  | 'send_preview'
  | 'claim'
  | 'lose';

/** The stage each event advances TO. */
const EVENT_TARGET: Record<LeadEvent, LeadStage> = {
  enrich: 'enriched',
  contact: 'contacted',
  trigger_build: 'build_triggered',
  send_preview: 'preview_sent',
  claim: 'claimed',
  lose: 'lost',
};

/** `claimed` + `lost` are terminal — no further transitions. */
export function isTerminal(stage: LeadStage): boolean {
  return stage === 'claimed' || stage === 'lost';
}

/**
 * Whether `from → to` is a legal transition: one step forward along the funnel,
 * `claim` only from `preview_sent` (you can't claim a lead you never previewed),
 * or `lose` from any non-terminal. No backward moves, no skips, none off a terminal.
 *
 * @param from - Current stage.
 * @param to - Proposed next stage.
 * @returns `true` when the transition is allowed.
 *
 * @example
 * canTransition('contacted', 'build_triggered'); // true
 * canTransition('discovered', 'claimed');        // false (skip)
 */
export function canTransition(from: LeadStage, to: LeadStage): boolean {
  if (isTerminal(from)) return false;
  if (to === 'lost') return true; // lose from any non-terminal
  if (to === 'claimed') return from === 'preview_sent';
  const fi = FORWARD.indexOf(from);
  const ti = FORWARD.indexOf(to);
  return fi >= 0 && ti === fi + 1; // exactly one forward step
}

/**
 * Apply an event to a lead's current stage. Returns the new stage, or `null`
 * when the event is illegal from `current` (caller keeps the lead unchanged +
 * can log the rejected transition for the funnel dashboard #97).
 *
 * @param current - The lead's current stage.
 * @param event - The lifecycle event.
 * @returns The resulting {@link LeadStage}, or `null` if rejected.
 *
 * @example
 * applyLeadEvent('preview_sent', 'claim'); // 'claimed'
 * applyLeadEvent('discovered', 'claim');   // null
 */
export function applyLeadEvent(current: LeadStage, event: LeadEvent): LeadStage | null {
  const target = EVENT_TARGET[event];
  if (!target) return null;
  return canTransition(current, target) ? target : null;
}
