/**
 * @module libs/features/upgrade_moments/service
 * @description Pure business logic for the Upgrade Moments feature module.
 *
 * The catalog + eligibility + copy resolution are PURE functions (no env, no
 * I/O) so they are fully unit-testable and deterministic. Persistence
 * (dismissals) lives in the handler via KV — keeping this core side-effect free.
 *
 * Generous-free model: every moment surfaces on the free tier and points to a
 * paid power-up. Paid plans (`starter`/`pro`) are NOT nagged — the friction is
 * already removed, so the moment resolves `eligible: false`.
 *
 * @packageDocumentation
 */

import {
  UpgradeMomentSchema,
  UpgradeTriggerSchema,
  type PlanTier,
  type UpgradeContext,
  type UpgradeMoment,
  type UpgradeTrigger,
} from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'upgrade_moments';

/** Every trigger in the catalog, in display priority order. */
export const ALL_TRIGGERS: readonly UpgradeTrigger[] = UpgradeTriggerSchema.options;

/**
 * Static, curated copy per trigger. Honest value metrics — no fabricated stats.
 * `cta_url` is attributed to the trigger so billing can measure which friction
 * point converts (feeds the golden-path funnel).
 */
interface MomentTemplate {
  headline: string;
  body: string;
  benefits: readonly string[];
  cta_label: string;
  price_hint: string;
  value_metric: string;
}

const CATALOG: Record<UpgradeTrigger, MomentTemplate> = {
  custom_domain: {
    headline: 'Launch on your own domain',
    body: 'A custom domain signals an established business and lifts first-visit trust. DNS and SSL are provisioned automatically.',
    benefits: [
      'Connect yourbusiness.com in two clicks',
      'Automatic HTTPS — zero setup',
      'Your free preview link keeps working',
    ],
    cta_label: 'Add domain',
    price_hint: 'Paid plan',
    value_metric: 'Custom-domain sites earn first-visit trust faster than a shared subdomain.',
  },
  remove_branding: {
    headline: 'Remove the ProjectSites bar',
    body: 'Drop the platform bar so the page reads as fully your own. Every pixel points at your brand and your call to action.',
    benefits: [
      'Hide the ProjectSites top bar',
      'Cleaner, more professional first impression',
      'All focus on your logo and CTA',
    ],
    cta_label: 'Remove bar',
    price_hint: 'Paid plan',
    value_metric: 'A branding-free header keeps every click on your own call to action.',
  },
  more_pages: {
    headline: 'Add more pages',
    body: 'Give services, locations, and FAQs their own focused, rankable surfaces instead of crowding one page.',
    benefits: [
      'Dedicated service, location, and FAQ pages',
      'Stronger SEO from focused content',
      'Room to grow without a rebuild',
    ],
    cta_label: 'Add pages',
    price_hint: 'Paid plan',
    value_metric: 'Focused pages rank for more of the exact searches customers type.',
  },
  ai_credits: {
    headline: 'Unlimited AI edits',
    body: "You've used this cycle's free AI edits. Go unlimited to keep refining copy, sections, and images without a counter.",
    benefits: [
      'Unlimited AI edits and regenerations',
      'Priority access to top models',
      'No monthly credit ceiling',
    ],
    cta_label: 'Go unlimited',
    price_hint: 'Paid plan',
    value_metric: 'Owners who edit most in week one keep their sites live longest.',
  },
  priority_build: {
    headline: 'Priority builds',
    body: 'Skip the shared free queue. Priority builds run first, so same-day changes go live in minutes.',
    benefits: [
      'Front of the build queue',
      'Same-day changes go live fast',
      'Less waiting at peak hours',
    ],
    cta_label: 'Build faster',
    price_hint: 'Paid plan',
    value_metric: 'Priority builds finish ahead of the shared free queue at peak hours.',
  },
  analytics_pro: {
    headline: 'See who calls and from where',
    body: 'Unlock owner analytics: which section drives calls, which channel sends visitors, and a weekly summary by email.',
    benefits: [
      'Section-level conversion attribution',
      'Traffic source and channel breakdown',
      'Weekly summary emailed to you',
    ],
    cta_label: 'Unlock analytics',
    price_hint: 'Paid plan',
    value_metric: 'Knowing which section earns the call tells you exactly what to improve next.',
  },
};

/**
 * Whether a trigger applies to the given plan.
 *
 * Paid plans (`starter`/`pro`) already have these power-ups, so their moments
 * are not eligible — we never nag a paying customer.
 *
 * @param _trigger - The friction point (reserved for future per-trigger rules).
 * @param plan     - The caller's plan tier.
 * @returns true when the upsell should be shown.
 */
export function isMomentEligible(_trigger: UpgradeTrigger, plan: PlanTier): boolean {
  return plan === 'free';
}

/**
 * Apply light, optional business-type personalization to a body string.
 *
 * Keeps the deterministic catalog intact while making the copy feel hand-written
 * for the business. No-op when `businessType` is absent or blank.
 *
 * @param body         - The base catalog body.
 * @param businessType - Optional business type, e.g. "salon".
 * @returns Possibly-prefixed body string.
 */
function personalizeBody(body: string, businessType?: string): string {
  const type = businessType?.trim();
  if (!type) return body;
  return `For a ${type}, this matters: ${body}`;
}

/**
 * Resolve a single upgrade moment for a trigger + context.
 *
 * Pure: no env, no I/O. The returned object is Zod-validated against
 * {@link UpgradeMomentSchema} so callers can trust the shape.
 *
 * @param trigger - The friction point that fired.
 * @param ctx     - Plan + optional business type.
 * @returns A fully-resolved, validated {@link UpgradeMoment}.
 * @throws {z.ZodError} if the catalog ever produces an invalid shape (build bug).
 *
 * @example
 * ```ts
 * const moment = getUpgradeMoment('custom_domain', { plan: 'free' });
 * // { trigger: 'custom_domain', eligible: true, headline: '...', ... }
 * ```
 */
export function getUpgradeMoment(trigger: UpgradeTrigger, ctx: UpgradeContext): UpgradeMoment {
  const tpl = CATALOG[trigger];
  const eligible = isMomentEligible(trigger, ctx.plan);
  return UpgradeMomentSchema.parse({
    trigger,
    eligible,
    headline: tpl.headline,
    body: personalizeBody(tpl.body, ctx.businessType),
    benefits: [...tpl.benefits],
    cta_label: tpl.cta_label,
    cta_url: `/admin/billing?upsell=${trigger}`,
    price_hint: tpl.price_hint,
    value_metric: tpl.value_metric,
    dismiss_key: `upgrade_moment:${trigger}`,
  });
}

/**
 * Resolve every eligible upgrade moment for a context, in display order.
 *
 * Pure: dismissals are applied by the handler (which has KV), not here.
 *
 * @param ctx - Plan + optional business type.
 * @returns Eligible moments only (empty for paid plans).
 *
 * @example
 * ```ts
 * listEligibleMoments({ plan: 'free' }).length // 6
 * listEligibleMoments({ plan: 'pro' }).length  // 0
 * ```
 */
export function listEligibleMoments(ctx: UpgradeContext): UpgradeMoment[] {
  return ALL_TRIGGERS.map((t) => getUpgradeMoment(t, ctx)).filter((m) => m.eligible);
}
