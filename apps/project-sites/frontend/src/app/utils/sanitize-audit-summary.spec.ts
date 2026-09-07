import { sanitizeAuditSummary } from './sanitize-audit-summary';

/**
 * The /admin/audit table and the dashboard Recent-activity widget both render
 * stored audit summaries, some of which carry a stray interpolated `undefined`
 * (e.g. the billing checkout writer's "for 'undefined' tier"). Both surfaces
 * must scrub it identically — this locks the shared sanitizer (AL-139).
 */
describe('sanitizeAuditSummary', () => {
  it('drops a broken "for \'undefined\' <word>" clause (the checkout incident)', () => {
    expect(sanitizeAuditSummary("Stripe checkout session created for 'undefined' tier")).toBe(
      'Stripe checkout session created',
    );
  });

  it('handles the null variant + other lead-in prepositions', () => {
    expect(sanitizeAuditSummary("Snapshot restored to 'null' version")).toBe('Snapshot restored');
    expect(sanitizeAuditSummary("Event fired as 'undefined' type")).toBe('Event fired');
  });

  it('neutralizes a remaining quoted null token to \'unknown\'', () => {
    expect(sanitizeAuditSummary("Site 'undefined' updated")).toBe("Site 'unknown' updated");
  });

  it('strips bare undefined/null words and tidies whitespace + punctuation', () => {
    expect(sanitizeAuditSummary('Deployed undefined build , ok')).toBe('Deployed build, ok');
  });

  it('leaves a clean summary untouched', () => {
    const clean = "Site 'vito-salon' renamed to 'Vito's Salon'";
    expect(sanitizeAuditSummary(clean)).toBe(clean);
  });

  it('passes empty / falsy through unchanged', () => {
    expect(sanitizeAuditSummary('')).toBe('');
  });
});
