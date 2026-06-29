/**
 * @module services/send_optimization
 * @description LM16 — send-time + subject A/B optimization mechanics. Three pure
 * helpers the campaign sender uses: a deterministic A/B(/n) variant assigner
 * (stable per recipient, even split), a best-send-hour recommender from
 * historical opens, and a winning-subject picker from A/B open-rate stats. Pure +
 * zero-I/O: the caller pulls opens/stats from analytics and applies the result.
 * The AI that *generates* subject candidates is a separate layer. Never throws.
 *
 * @packageDocumentation
 */

/** Default send hour (local) when there is no open history to learn from. */
export const DEFAULT_SEND_HOUR = 10;
/** Minimum sends before an A/B subject variant's open rate is trusted. */
export const DEFAULT_MIN_SENT = 50;

/**
 * Deterministic 32-bit djb2 hash of a string → unsigned int. Stable across
 * runs/processes (no crypto, no `Math.random`) so a recipient always lands in
 * the same bucket.
 */
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Assign a stable A/B(/n) variant for a key (e.g. recipient id). Same key+salt
 * always yields the same variant; the split is even across variants.
 *
 * @param key - Stable bucketing key (recipient id / email).
 * @param variants - Non-empty list of variant labels.
 * @param salt - Per-experiment salt so different experiments split independently.
 * @returns The chosen variant (the first variant when `variants` is empty).
 *
 * @example
 * assignVariant('user_42', ['A', 'B'], 'subject_test_1') // → 'A' (stable)
 */
export function assignVariant<T extends string>(key: string, variants: readonly T[], salt = ''): T {
  if (!Array.isArray(variants) || variants.length === 0) return variants?.[0] as T;
  const idx = djb2(`${key}|${salt}`) % variants.length;
  return variants[idx];
}

/**
 * Recommend the best hour-of-day (0–23) to send, from historical open hours.
 * Returns the modal hour (ties → earliest); {@link DEFAULT_SEND_HOUR} when there
 * is no valid data.
 *
 * @param openHours - Hours-of-day (0–23) at which past opens occurred.
 * @param opts - `default` override for the no-data fallback.
 * @returns The recommended send hour.
 *
 * @example
 * recommendSendHour([9, 9, 14, 9, 14]) // → 9
 */
export function recommendSendHour(
  openHours: readonly number[],
  opts: { default?: number } = {},
): number {
  const fallback =
    typeof opts.default === 'number' && opts.default >= 0 && opts.default <= 23
      ? opts.default
      : DEFAULT_SEND_HOUR;
  if (!Array.isArray(openHours) || openHours.length === 0) return fallback;

  const counts = new Map<number, number>();
  for (const h of openHours) {
    if (typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return fallback;

  let bestHour = fallback;
  let bestCount = -1;
  for (let h = 0; h <= 23; h++) {
    const c = counts.get(h) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      bestHour = h;
    }
  }
  return bestHour;
}

/** Per-subject A/B send/open tally. */
export interface SubjectStat {
  readonly subject: string;
  readonly sent: number;
  readonly opened: number;
}

/** The winning subject + its open rate. */
export interface SubjectWinner {
  readonly subject: string;
  /** 0–100, one decimal. */
  readonly openRate: number;
}

/**
 * Pick the winning subject by open rate among variants with enough sends.
 *
 * @param stats - Per-subject {@link SubjectStat} tallies.
 * @param minSent - Minimum sends to qualify (default {@link DEFAULT_MIN_SENT}).
 * @returns The {@link SubjectWinner}, or null when no variant qualifies.
 *
 * @example
 * pickWinningSubject([
 *   { subject: 'A', sent: 100, opened: 30 },
 *   { subject: 'B', sent: 100, opened: 42 },
 * ]) // → { subject: 'B', openRate: 42 }
 */
export function pickWinningSubject(
  stats: readonly SubjectStat[],
  minSent: number = DEFAULT_MIN_SENT,
): SubjectWinner | null {
  const min = Number.isFinite(minSent) && minSent > 0 ? minSent : DEFAULT_MIN_SENT;
  let winner: SubjectWinner | null = null;
  for (const s of Array.isArray(stats) ? stats : []) {
    if (!s || typeof s.subject !== 'string') continue;
    const sent = typeof s.sent === 'number' && s.sent > 0 ? s.sent : 0;
    const opened = typeof s.opened === 'number' && s.opened > 0 ? s.opened : 0;
    if (sent < min) continue;
    const openRate = Math.round((Math.min(opened, sent) / sent) * 1000) / 10;
    if (!winner || openRate > winner.openRate) {
      winner = { subject: s.subject, openRate };
    }
  }
  return winner;
}
