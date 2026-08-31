/**
 * Minimal 5-field cron matcher (Stage 6.1, ADR-0035) — decides whether a site's
 * registered cron expression fires at a given UTC minute, for the platform-side
 * cron dispatcher (`index.ts scheduled()` enumerates schedules each minute and
 * cron-matches to pick which to dispatch). Pure + zero-dependency.
 *
 * Supports per field: `*`, `* /N` (step), `a-b` (range), `a-b/N`, `a,b,c` (list),
 * and plain numbers — the standard cron subset Cloudflare accepts. Fields, in
 * order: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6,
 * Sunday=0; a `7` also matches Sunday). Cloudflare Cron Triggers execute on UTC.
 */

/** Whether `val` satisfies one comma-free cron token for a field bounded [lo,hi]. */
function matchToken(token: string, val: number, lo: number, hi: number, isDow: boolean): boolean {
  const t = token.trim();
  if (!t) return false;
  let step = 1;
  let range = t;
  const slash = t.indexOf('/');
  if (slash !== -1) {
    range = t.slice(0, slash) || '*';
    step = Number.parseInt(t.slice(slash + 1), 10);
    if (!Number.isFinite(step) || step < 1) return false;
  }
  let start: number;
  let end: number;
  if (range === '*') {
    start = lo;
    end = hi;
  } else if (range.includes('-')) {
    const [a, b] = range.split('-').map((x) => Number.parseInt(x, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    start = a;
    end = b;
  } else {
    const n = Number.parseInt(range, 10);
    if (!Number.isFinite(n)) return false;
    start = n;
    end = n;
  }
  // day-of-week: Sunday is 0, but a spec may use 7 — treat val 0 as {0,7}.
  const candidates = isDow && val === 0 ? [0, 7] : [val];
  for (const v of candidates) {
    if (v >= start && v <= end && (v - start) % step === 0) return true;
  }
  return false;
}

/** Whether ANY comma-separated token in `spec` matches `val`. */
function fieldMatches(spec: string, val: number, lo: number, hi: number, isDow = false): boolean {
  for (const token of spec.split(',')) {
    if (matchToken(token, val, lo, hi, isDow)) return true;
  }
  return false;
}

/**
 * Does the 5-field `cron` expression fire at UTC `date` (to the minute)?
 *
 * Standard day-of-month/day-of-week semantics: when BOTH are restricted (neither
 * is `*`), the day matches if EITHER matches; otherwise both must match. Returns
 * false for a malformed expression (wrong field count / unparseable token).
 *
 * @example cronMatches('0 * * * *', new Date('2026-01-01T13:00:00Z')) // true (top of the hour)
 * @example cronMatches('*\/5 * * * *', new Date('2026-01-01T13:07:00Z')) // false
 */
export function cronMatches(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minP, hrP, domP, monP, dowP] = parts;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dow = date.getUTCDay(); // 0-6, Sunday = 0

  const domRestricted = domP !== '*';
  const dowRestricted = dowP !== '*';
  const dayOk =
    domRestricted && dowRestricted
      ? fieldMatches(domP, dom, 1, 31) || fieldMatches(dowP, dow, 0, 6, true)
      : fieldMatches(domP, dom, 1, 31) && fieldMatches(dowP, dow, 0, 6, true);

  return (
    fieldMatches(minP, minute, 0, 59) &&
    fieldMatches(hrP, hour, 0, 23) &&
    dayOk &&
    fieldMatches(monP, month, 1, 12)
  );
}
