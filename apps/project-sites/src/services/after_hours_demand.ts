/**
 * @module services/after_hours_demand
 * @description #65 `after_hours_demand` — detect click-to-call/email/directions
 * attempts that land outside business hours and generate an owner nudge. Pure
 * windowing over AN18 conversion events + Places/LocalBusiness opening hours.
 * Zero-I/O, deterministic, never throws.
 * @packageDocumentation
 */

export interface BusinessHours {
  readonly day: number; // 0=Sun..6=Sat
  readonly open: string; // e.g. "9:00 AM"
  readonly close: string; // e.g. "6:00 PM"
}

export interface ConversionEvent {
  readonly kind: 'call' | 'email' | 'directions' | string;
  readonly timestampMs: number;
  readonly section?: string | null;
}

export interface AfterHoursAlert {
  /** Conversions that landed outside business hours. */
  readonly missed: readonly ConversionEvent[];
  readonly totalAfterHours: number;
  /** True when the threshold is crossed — should alert the owner. */
  readonly shouldAlert: boolean;
  /** One-line summary for the notification, e.g. "7 people tried to call after you closed". */
  readonly summary: string;
  /** Upsell suggestion tied to the dominant missed conversion kind. */
  readonly upsell: string;
}

/** Default threshold before an owner nudge fires. */
export const DEFAULT_THRESHOLD = 3;

/** Parse "9:00 AM" / "14:00" style time strings to minutes since midnight. */
function parseMinutes(time: string): number {
  const s = (time ?? '').trim().toLowerCase();
  // 24h: "14:00", "09:30"
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  // AM/PM: "9:00 am", "6:00 PM"
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    if (m12[3] === 'pm' && h !== 12) h += 12;
    if (m12[3] === 'am' && h === 12) h = 0;
    return h * 60 + parseInt(m12[2], 10);
  }
  return NaN;
}

/** Classify a conversion's local hour against business hours for that day-of-week. */
function isAfterHours(event: ConversionEvent, hours: readonly BusinessHours[]): boolean {
  const d = new Date(event.timestampMs);
  const day = d.getUTCDay();
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const h of hours) {
    if (h.day !== day) continue;
    const open = parseMinutes(h.open);
    const close = parseMinutes(h.close);
    if (Number.isNaN(open) || Number.isNaN(close)) continue;
    return minuteOfDay < open || minuteOfDay >= close;
  }
  // Day not in hours → closed → any conversion is after-hours.
  return true;
}

/**
 * Analyze conversion events against business hours, generating an after-hours
 * demand alert when the threshold is crossed.
 *
 * @param conversions - AN18 conversion events (call/email/directions).
 * @param hours - Business opening hours (Places/LocalBusiness format).
 * @param threshold - Min missed conversions before alerting (default 3).
 * @returns {@link AfterHoursAlert}.
 */
export function detectAfterHoursDemand(
  conversions: readonly ConversionEvent[],
  hours: readonly BusinessHours[],
  threshold: number = DEFAULT_THRESHOLD,
): AfterHoursAlert {
  const conv = Array.isArray(conversions) ? conversions : [];
  const hrs = Array.isArray(hours) ? hours : [];
  const thresh =
    Number.isFinite(threshold) && threshold > 0 ? Math.round(threshold) : DEFAULT_THRESHOLD;

  const missed: ConversionEvent[] = [];
  for (const c of conv) {
    if (!c || typeof c.kind !== 'string' || typeof c.timestampMs !== 'number') continue;
    if (isAfterHours(c, hrs)) missed.push(c);
  }

  const totalAfterHours = missed.length;
  const shouldAlert = hrs.length > 0 && totalAfterHours >= thresh;

  // Dominant conversion kind for the upsell suggestion.
  const kindCounts: Record<string, number> = {};
  for (const c of missed) {
    const k = c.kind || 'call';
    kindCounts[k] = (kindCounts[k] ?? 0) + 1;
  }
  let dominantKind = 'call';
  let maxC = 0;
  for (const [k, c] of Object.entries(kindCounts)) {
    if (c > maxC) {
      maxC = c;
      dominantKind = k;
    }
  }

  const upsell =
    dominantKind === 'call'
      ? `${totalAfterHours} people tried to call after you closed — add a contact form or online booking so they reach you.`
      : dominantKind === 'directions'
        ? `${totalAfterHours} people looked for directions after hours — make sure your address + a map are on every page.`
        : `${totalAfterHours} people tried to reach you after hours — add a contact form so you never miss a lead.`;

  const summary =
    totalAfterHours === 0
      ? 'No after-hours demand detected.'
      : shouldAlert
        ? upsell
        : `${totalAfterHours} after-hours contacts — below the ${thresh} threshold.`;

  return { missed, totalAfterHours, shouldAlert, summary, upsell };
}
