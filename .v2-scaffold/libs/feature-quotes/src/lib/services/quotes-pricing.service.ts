/**
 * Pure pricing math used by the wizard's transparent fare-estimate
 * card. Exposed as an `@Injectable` so tests can override it; the
 * functions are pure so they're trivially unit-testable too.
 */
import { Injectable } from '@angular/core';
import type { ServiceCategory, WizardDay, WizardFare } from '../types.js';

/** Category-by-category base fare in USD cents. */
const BASE_FARE: Readonly<Record<ServiceCategory, number>> = {
  power_wash: 18_900,
  landscape: 22_500,
  mechanic: 16_000,
  labor: 12_500,
  background_acting: 9_500,
};

/** Sales-tax rate (NJ default — overridable by tenant later). */
const DEFAULT_TAX_RATE = 0.066;

export interface PricingInputs {
  readonly category: ServiceCategory | null;
  readonly days: readonly WizardDay[];
  readonly surgeMultiplier: number;
  readonly promoDiscountCents: number;
  readonly taxRate?: number;
}

@Injectable({ providedIn: 'root' })
export class QuotesPricingService {
  /**
   * Deterministic fare calc. Re-runs on every wizard state change.
   *
   * @example
   * ```ts
   * pricing.compute({ category: 'power_wash', days: [d1, d2], surgeMultiplier: 1, promoDiscountCents: 0 })
   * // → { totalCents: 41_200, ... }
   * ```
   */
  compute(input: PricingInputs): WizardFare {
    const baseCents = input.category ? BASE_FARE[input.category] : 0;
    const dayCount = Math.max(1, input.days.length);
    const perDayMultiplier = dayCount === 1 ? 1 : 1 + (dayCount - 1) * 0.85;
    const surgeMultiplier = Math.max(1, input.surgeMultiplier);
    const subtotal = Math.round(baseCents * perDayMultiplier * surgeMultiplier);
    const afterPromo = Math.max(0, subtotal - input.promoDiscountCents);
    const taxRate = input.taxRate ?? DEFAULT_TAX_RATE;
    const taxCents = Math.round(afterPromo * taxRate);
    const totalCents = afterPromo + taxCents;

    return {
      baseCents,
      perDayMultiplier,
      surgeMultiplier,
      taxCents,
      totalCents,
      promoCode: null,
      promoDiscountCents: input.promoDiscountCents,
    };
  }
}
