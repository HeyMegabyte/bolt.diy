/**
 * Sanitize a human audit summary for display — never render a stray
 * `undefined`/`null` that a writer interpolated from a missing field.
 *
 * Reference incident: the billing checkout writer emits
 * `"Stripe checkout session created for '<budget_tier>' tier"`, and when the
 * tier is absent the literal renders as `"… for 'undefined' tier"` (AL-001 on
 * the dashboard widget; AL-139 found the SAME raw string leaking on the
 * /admin/audit table, which rendered `row.message` without sanitizing).
 *
 * Legacy audit rows persist in D1 with these summaries (they are stored at
 * write-time, not recomputed), so BOTH the dashboard Recent-activity widget
 * AND the /admin/audit table sanitize at render. Shared here so the two
 * surfaces can never drift (was a duplicated inline `clean()` — drift-detection).
 *
 * Drops a broken "for/to/as/on 'undefined' <word>" clause, neutralizes any
 * remaining quoted null token to `'unknown'`, strips bare `undefined`/`null`
 * words, and tidies whitespace/punctuation.
 *
 * @param summary - The raw audit summary/message (may be empty/undefined-laden).
 * @returns The sanitized summary, safe to render to a user.
 *
 * @example
 * sanitizeAuditSummary("Stripe checkout session created for 'undefined' tier")
 *   // → "Stripe checkout session created"
 */
export function sanitizeAuditSummary(summary: string): string {
  if (!summary) return summary;
  return summary
    .replace(/\s*\b(for|to|as|on)\s+'(?:undefined|null)'\s+\S+/gi, '')
    .replace(/'(?:undefined|null)'/gi, "'unknown'")
    .replace(/\b(?:undefined|null)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
