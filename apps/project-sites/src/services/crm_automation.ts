/**
 * @module services/crm_automation
 *
 * TW9 lifecycle automation rules engine. Pure rule matcher: given a subscriber
 * or company's current lifecycle cohort and the event that just fired, returns
 * the matched automation rules (next cohort + CRM action list).
 *
 * Pure, never throws. Every input combination produces a valid result — empty
 * array when no rule matches.
 */

/** Current lifecycle stage for a subscriber or company. */
export type Cohort = 'new' | 'trial' | 'active' | 'dormant' | 'churned';

/** Event that may trigger a lifecycle transition. */
export type Trigger =
  | 'signup'
  | 'build_complete'
  | 'payment'
  | 'payment_failed'
  | 'inactive_30d'
  | 'inactive_90d';

/** A single automation rule: match condition + transition result. */
export interface AutomationRule {
  readonly then: {
    readonly actions: readonly string[];
    readonly nextCohort: Cohort;
  };
  readonly when: { readonly cohort: Cohort; readonly trigger: Trigger };
}

// ---------------------------------------------------------------------------
// Default rules — cover the standard subscriber lifecycle
// ---------------------------------------------------------------------------

/**
 * Default lifecycle automation rules.
 *
 * | Current     | Trigger         | → Cohort  | Actions                                    |
 * |-------------|-----------------|-----------|--------------------------------------------|
 * | new         | signup          | trial     | tag_free_trial, send_welcome_email         |
 * | trial       | build_complete  | active    | tag_active, send_site_live_notification    |
 * | active      | payment         | active    | tag_paid, send_receipt                     |
 * | active      | inactive_30d    | dormant   | tag_dormant_30d, send_winback_email        |
 * | dormant     | inactive_90d    | churned   | tag_churned, send_farewell_email           |
 * | dormant     | payment         | active    | tag_reactivated, send_welcome_back_email   |
 * | churned     | payment         | active    | tag_reactivated, send_welcome_back_email   |
 * | trial       | payment_failed  | trial     | tag_payment_failed, send_payment_reminder  |
 */
export const DEFAULT_RULES: readonly AutomationRule[] = Object.freeze([
  {
    then: {
      actions: ['tag_free_trial', 'send_welcome_email'],
      nextCohort: 'trial',
    },
    when: { cohort: 'new', trigger: 'signup' },
  },
  {
    then: {
      actions: ['tag_active', 'send_site_live_notification'],
      nextCohort: 'active',
    },
    when: { cohort: 'trial', trigger: 'build_complete' },
  },
  {
    then: {
      actions: ['tag_paid', 'send_receipt'],
      nextCohort: 'active',
    },
    when: { cohort: 'active', trigger: 'payment' },
  },
  {
    then: {
      actions: ['tag_dormant_30d', 'send_winback_email'],
      nextCohort: 'dormant',
    },
    when: { cohort: 'active', trigger: 'inactive_30d' },
  },
  {
    then: {
      actions: ['tag_churned', 'send_farewell_email'],
      nextCohort: 'churned',
    },
    when: { cohort: 'dormant', trigger: 'inactive_90d' },
  },
  {
    then: {
      actions: ['tag_reactivated', 'send_welcome_back_email'],
      nextCohort: 'active',
    },
    when: { cohort: 'dormant', trigger: 'payment' },
  },
  {
    then: {
      actions: ['tag_reactivated', 'send_welcome_back_email'],
      nextCohort: 'active',
    },
    when: { cohort: 'churned', trigger: 'payment' },
  },
  {
    then: {
      actions: ['tag_payment_failed', 'send_payment_reminder'],
      nextCohort: 'trial',
    },
    when: { cohort: 'trial', trigger: 'payment_failed' },
  },
]);

/**
 * Return every `AutomationRule` from the given rule set that matches the
 * supplied cohort and trigger.
 *
 * Pure function — no I/O, no side-effects, no throws. Returns `[]` when no
 * rule matches (i.e. the event is a no-op for the current cohort).
 *
 * @param cohort - Current lifecycle stage.
 * @param trigger - The event that fired.
 * @param rules - Rule set (defaults to `DEFAULT_RULES`).
 * @returns A (possibly empty) array of matching rules.
 *
 * @example
 * const rules = matchRules('new', 'signup');
 * // → [{ then: { actions:['tag_free_trial','send_welcome_email'], nextCohort:'trial' }, when: { cohort:'new', trigger:'signup' } }]
 *
 * @example
 * matchRules('new', 'payment_failed');
 * // → []
 */
export function matchRules(
  cohort: Cohort,
  trigger: Trigger,
  rules: readonly AutomationRule[] = DEFAULT_RULES,
): AutomationRule[] {
  const matched: AutomationRule[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.when.cohort === cohort && rule.when.trigger === trigger) {
      matched.push(rule);
    }
  }

  return matched;
}
