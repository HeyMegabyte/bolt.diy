import { detectAfterHoursDemand, type BusinessHours } from '../services/after_hours_demand.js';

// UTC hours: Mon-Fri 9am-5pm
const hours: BusinessHours[] = [
  { day: 1, open: '9:00', close: '17:00' }, // Mon UTC
  { day: 2, open: '9:00', close: '17:00' }, // Tue UTC
  { day: 3, open: '9:00', close: '17:00' },
  { day: 4, open: '9:00', close: '17:00' },
  { day: 5, open: '9:00', close: '17:00' },
];

// Monday 23:00 UTC = after hours
const mon23h = Date.UTC(2026, 5, 29, 23, 0, 0);
// Monday 14:00 UTC = within hours (9-17)
const mon14h = Date.UTC(2026, 5, 29, 14, 0, 0);
// Sunday 12:00 UTC — not in the hours list at all
const sun12h = Date.UTC(2026, 5, 28, 12, 0, 0);

describe('detectAfterHoursDemand (#65)', () => {
  it('flags conversions outside business hours', () => {
    const r = detectAfterHoursDemand(
      [
        { kind: 'call', timestampMs: mon23h },
        { kind: 'call', timestampMs: mon23h },
        { kind: 'email', timestampMs: mon23h },
      ],
      hours,
    );
    expect(r.totalAfterHours).toBe(3);
    expect(r.shouldAlert).toBe(true);
    expect(r.summary).toContain('3 people tried to call');
  });

  it('does not alert when threshold is not met', () => {
    const r = detectAfterHoursDemand([{ kind: 'call', timestampMs: mon23h }], hours);
    expect(r.shouldAlert).toBe(false);
  });

  it('considers a day without hours as fully closed (Sunday)', () => {
    const r = detectAfterHoursDemand(
      [
        { kind: 'call', timestampMs: sun12h },
        { kind: 'directions', timestampMs: sun12h },
        { kind: 'directions', timestampMs: sun12h },
      ],
      hours,
    );
    expect(r.shouldAlert).toBe(true);
    expect(r.upsell).toContain('looked for directions');
  });

  it('returns no alert for conversions within business hours', () => {
    const r = detectAfterHoursDemand([{ kind: 'call', timestampMs: mon14h }], hours);
    expect(r.totalAfterHours).toBe(0);
    expect(r.summary).toBe('No after-hours demand detected.');
  });

  it('never throws on empty/null/undefined input', () => {
    expect(detectAfterHoursDemand([], []).totalAfterHours).toBe(0);
    expect(detectAfterHoursDemand(undefined as unknown as [], hours).summary).toBeDefined();
    expect(detectAfterHoursDemand([], hours, -1).shouldAlert).toBe(false);
  });
});
