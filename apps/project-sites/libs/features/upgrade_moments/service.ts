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
    headline: 'Put your business on its own domain',
    body: "A custom domain makes you look established and earns trust before a visitor reads a word. We handle DNS and the SSL certificate for you.",
    benefits: [
      'Connect yourbusiness.com in two clicks',
      'Automatic HTTPS — no certificate setup',
      'Keep your free preview link working too',
    ],
    cta_label: 'Add my domain',
    price_hint: '$5/mo',
    value_metric: 'Sites on a custom domain are trusted faster by first-time visitors.',
  },
  remove_branding: {
    headline: 'Make it 100% yours',
    body: "Remove the ProjectSites bar so the site reads as fully your own. Your brand, front and center, with nothing competing for attention.",
    benefits: [
      'Hide the ProjectSites top bar',
      'Cleaner, professional first impression',
      'Your logo and CTA get all the focus',
    ],
    cta_label: 'Remove the bar',
    price_hint: '$5/mo',
    value_metric: 'A branding-free header keeps every click on your own call to action.',
  },
  more_pages: {
    headline: 'Add more pages to your site',
    body: "You've hit the free page limit. Unlock more pages to give services, locations, and your story the room they deserve.",
    benefits: [
      'Add service, location, and FAQ pages',
      'Better SEO from deeper, focused content',
      'Room to grow without a rebuild',
    ],
    cta_label: 'Unlock more pages',
    price_hint: '$9/mo',
    value_metric: 'More focused pages rank for more of the searches your customers actually type.',
  },
  ai_credits: {
    headline: 'Unlock unlimited AI edits',
    body: "You're out of free AI edits for this cycle. Go unlimited and keep refining copy, sections, and images without watching a counter.",
    benefits: [
      'Unlimited AI edits and regenerations',
      'Priority access to the best models',
      'No monthly credit ceiling',
    ],
    cta_label: 'Go unlimited',
    price_hint: '$9/mo',
    value_metric: 'The owners who edit most in week one keep their sites live the longest.',
  },
  priority_build: {
    headline: 'Skip the line on every build',
    body: "Priority builds jump the queue and finish first, so a same-day change is live in minutes, not after the free queue clears.",
    benefits: [
      'Front-of-queue on every rebuild',
      'Same-day changes go live fast',
      'Less waiting when you need it most',
    ],
    cta_label: 'Build faster',
    price_hint: '$9/mo',
    value_metric: 'Priority builds finish ahead of the shared free queue at busy hours.',
  },
  analytics_pro: {
    headline: 'See who calls and where they come from',
    body: "Unlock owner analytics: which section drives the calls, which channel sends the visitors, and a weekly summary in your inbox.",
    benefits: [
      'Section-level conversion attribution',
      'Traffic sources and channel breakdown',
      'A weekly summary emailed to you',
    ],
    cta_label: 'Unlock analytics',
    price_hint: '$9/mo',
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
