/**
 * Wizard view-model types kept separate from the SSOT in `@org/domain`.
 * Wizard state is allowed to be invalid mid-flow; only `toQuoteDraft()`
 * coerces it into a SSOT-compatible shape on submit.
 */
import type { BookingDay, Quote, QuoteDayOverride } from '@org/domain';

export type ServiceCategory =
  | 'power_wash'
  | 'landscape'
  | 'mechanic'
  | 'labor'
  | 'background_acting';

export const SERVICE_CATEGORIES: readonly {
  readonly value: ServiceCategory;
  readonly label: string;
  readonly icon: string;
}[] = [
  { value: 'power_wash', label: 'Power-washing', icon: 'pi pi-cloud' },
  { value: 'landscape', label: 'Landscape', icon: 'pi pi-sun' },
  { value: 'mechanic', label: 'Mechanic / repair', icon: 'pi pi-wrench' },
  { value: 'labor', label: 'General labor', icon: 'pi pi-users' },
  {
    value: 'background_acting',
    label: 'Background acting',
    icon: 'pi pi-video',
  },
];

export interface WizardLocation {
  /** Formatted Google Places `formatted_address` string. */
  formatted: string;
  /** Place ID (stable across sessions). */
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface WizardDay extends BookingDay {
  /** UI label rendered top-left ("Day 1", "Day 2", …). */
  label: string;
  /** Optional per-day note (e.g. "smaller crew on day 2"). */
  note: string | null;
  /** Editable crew count override. */
  crew_size: number | null;
}

export interface WizardDetails {
  notes: string;
  photoUrls: readonly string[];
  recurring: 'none' | 'weekly' | 'biweekly' | 'monthly';
  stops: readonly WizardLocation[];
}

export interface WizardFare {
  baseCents: number;
  perDayMultiplier: number;
  surgeMultiplier: number;
  taxCents: number;
  totalCents: number;
  promoCode: string | null;
  promoDiscountCents: number;
}

export interface QuoteWizardState {
  category: ServiceCategory | null;
  location: WizardLocation;
  multiDay: boolean;
  days: readonly WizardDay[];
  details: WizardDetails;
  fare: WizardFare;
}

export interface QuoteDraft {
  quote: Quote;
  day_overrides: readonly QuoteDayOverride[];
}
