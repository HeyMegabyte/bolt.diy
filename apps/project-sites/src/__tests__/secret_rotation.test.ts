import {
  rotationStatus,
  buildRotationReport,
  DEFAULT_MAX_AGE_DAYS,
  DUE_SOON_DAYS,
  type SecretRecord,
} from '../services/secret_rotation.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // fixed reference instant

function daysAgo(n: number): number {
  return NOW - n * DAY;
}

describe('rotationStatus (AP9 secret-rotation)', () => {
  it('classifies a freshly-rotated secret as ok', () => {
    const e = rotationStatus(
      { name: 'STRIPE_SECRET_KEY', vendor: 'stripe', lastRotatedAt: daysAgo(10) },
      NOW,
    );
    expect(e.status).toBe('ok');
    expect(e.ageDays).toBe(10);
    expect(e.daysUntilDue).toBe(DEFAULT_MAX_AGE_DAYS - 10);
    expect(e.vendor).toBe('stripe');
  });

  it('flags due_soon within the lead window', () => {
    const e = rotationStatus(
      { name: 'X', lastRotatedAt: daysAgo(DEFAULT_MAX_AGE_DAYS - DUE_SOON_DAYS + 1) },
      NOW,
    );
    expect(e.status).toBe('due_soon');
    expect(e.daysUntilDue).toBeLessThanOrEqual(DUE_SOON_DAYS);
    expect(e.daysUntilDue).toBeGreaterThanOrEqual(0);
  });

  it('flags overdue past the deadline', () => {
    const e = rotationStatus({ name: 'X', lastRotatedAt: daysAgo(120) }, NOW);
    expect(e.status).toBe('overdue');
    expect(e.daysUntilDue).toBeLessThan(0);
  });

  it('honors a per-secret maxAgeDays override', () => {
    const e = rotationStatus({ name: 'X', lastRotatedAt: daysAgo(40), maxAgeDays: 30 }, NOW);
    expect(e.status).toBe('overdue');
  });

  it('returns unknown for a never-rotated secret', () => {
    const e = rotationStatus({ name: 'X', lastRotatedAt: null }, NOW);
    expect(e.status).toBe('unknown');
    expect(e.ageDays).toBeNull();
    expect(e.dueAtMs).toBeNull();
  });

  it('accepts ISO-string timestamps', () => {
    const e = rotationStatus(
      { name: 'X', lastRotatedAt: '2026-01-01T00:00:00.000Z' },
      '2026-02-01T00:00:00.000Z',
    );
    expect(e.ageDays).toBe(31);
  });

  it('never throws on a non-finite now', () => {
    const e = rotationStatus({ name: 'X', lastRotatedAt: daysAgo(1) }, NaN);
    expect(e.status).toBe('unknown');
  });
});

describe('buildRotationReport (AP9)', () => {
  const records: SecretRecord[] = [
    { name: 'FRESH', lastRotatedAt: daysAgo(5) },
    { name: 'OVERDUE', lastRotatedAt: daysAgo(200) },
    { name: 'NEVER', lastRotatedAt: null },
    { name: 'SOON', lastRotatedAt: daysAgo(DEFAULT_MAX_AGE_DAYS - 3) },
  ];

  it('sorts most-urgent first (overdue → due_soon → unknown → ok)', () => {
    const r = buildRotationReport(records, NOW);
    expect(r.entries.map((e) => e.name)).toEqual(['OVERDUE', 'SOON', 'NEVER', 'FRESH']);
  });

  it('tallies counts + needsAttention', () => {
    const r = buildRotationReport(records, NOW);
    expect(r.overdue).toBe(1);
    expect(r.dueSoon).toBe(1);
    expect(r.unknown).toBe(1);
    expect(r.needsAttention).toBe(true);
  });

  it('is calm when all secrets are fresh', () => {
    const r = buildRotationReport([{ name: 'A', lastRotatedAt: daysAgo(1) }], NOW);
    expect(r.needsAttention).toBe(false);
    expect(r.overdue).toBe(0);
  });

  it('handles an empty / non-array input without throwing', () => {
    expect(buildRotationReport([], NOW).entries).toEqual([]);
    expect(buildRotationReport(undefined as unknown as [], NOW).needsAttention).toBe(false);
  });
});
