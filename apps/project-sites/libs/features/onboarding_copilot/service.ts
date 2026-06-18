/**
 * @module libs/features/onboarding_copilot/service
 * @description Pure business logic for the onboarding activation checklist.
 * Computes next-best-actions so new orgs reach their first activation milestones.
 * No I/O — fully unit-testable with plain objects.
 */

import type { ChecklistResponse, ChecklistStep } from './schemas.js';

/** Feature flag key that gates this feature. */
export const FLAG_KEY = 'onboarding_copilot';

/** TTL (seconds) for the KV dismissed flag — 1 year. */
export const DISMISS_TTL = 31_536_000;

/** KV namespace key for the dismissed state of an org. */
export function dismissedKey(orgId: string): string {
  return `onboarding:dismissed:${orgId}`;
}

/** Input signals queried from D1 and KV. */
export interface ChecklistSignals {
  hasSite: boolean;
  hasPublished: boolean;
  hasDomain: boolean;
  dismissed: boolean;
}

/**
 * Builds the activation checklist for an org from their computed signals.
 *
 * @param signals - Signals derived from D1 counts and KV dismissed state.
 * @returns {@link ChecklistResponse} with the ordered steps and completion state.
 *
 * @example
 * const result = buildChecklist({ hasSite: true, hasPublished: false, hasDomain: false, dismissed: false });
 * // result.steps[0] = { id: 'create_site', done: true, next: false, ... }
 * // result.steps[1] = { id: 'publish_site', done: false, next: true, ... }
 */
export function buildChecklist(signals: ChecklistSignals): ChecklistResponse {
  const { hasSite, hasPublished, hasDomain, dismissed } = signals;

  const steps: ChecklistStep[] = [
    {
      id: 'create_site',
      title: 'Create your first site',
      done: hasSite,
      cta_url: '/admin/sites/new',
      cta_label: 'Create site',
      next: false,
    },
    {
      id: 'publish_site',
      title: 'Publish your site',
      done: hasPublished,
      cta_url: '/admin/sites',
      cta_label: 'Go to sites',
      next: false,
    },
    {
      id: 'add_custom_domain',
      title: 'Add a custom domain',
      done: hasDomain,
      cta_url: '/admin/domains',
      cta_label: 'Add domain',
      next: false,
    },
    {
      id: 'invite_or_explore',
      title: 'Invite a teammate or explore AI features',
      done: false,
      cta_url: '/admin/settings',
      cta_label: 'Explore settings',
      next: false,
    },
  ];

  // Mark the first incomplete step as the recommended next action.
  let foundNext = false;
  for (const step of steps) {
    if (!step.done && !foundNext) {
      step.next = true;
      foundNext = true;
    }
  }

  const complete = steps.every((s) => s.done);

  return { dismissed, complete, steps };
}
