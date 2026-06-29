import {
  severityRank,
  normalizeEmail,
  mergeSuppressions,
  toBlocklistFormat,
  type SuppressionEntry,
} from '../services/listmonk_suppression.js';

describe('Listmonk suppression normalizer', () => {
  // --- severityRank ---

  it('severityRank: complaint → 4', () => {
    expect(severityRank('complaint')).toBe(4);
  });

  it('severityRank: bounce_permanent / permanent → 3', () => {
    expect(severityRank('bounce_permanent')).toBe(3);
    expect(severityRank('permanent')).toBe(3);
  });

  it('severityRank: bounce_transient / transient → 2', () => {
    expect(severityRank('bounce_transient')).toBe(2);
    expect(severityRank('transient')).toBe(2);
  });

  it('severityRank: manual / unknown → 1', () => {
    expect(severityRank('manual')).toBe(1);
    expect(severityRank('')).toBe(1);
    expect(severityRank('some_other_reason')).toBe(1);
  });

  it('severityRank: case-insensitive trim', () => {
    expect(severityRank('  COMPLAINT  ')).toBe(4);
    expect(severityRank('  Complaint  ')).toBe(4);
  });

  // --- normalizeEmail ---

  it('normalizeEmail: lowercase', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com');
  });

  it('normalizeEmail: strip +alias', () => {
    expect(normalizeEmail('alice+spam@example.com')).toBe('alice@example.com');
  });

  it('normalizeEmail: trim whitespace', () => {
    expect(normalizeEmail('  alice@example.com  ')).toBe('alice@example.com');
  });

  it('normalizeEmail: combined trim + alias + lowercase', () => {
    expect(normalizeEmail('  Alice+tag@Example.COM  ')).toBe('alice@example.com');
  });

  it('normalizeEmail: plus alone without alias (no @) returns as-is lowercased', () => {
    expect(normalizeEmail('alice+')).toBe('alice+');
  });

  // --- mergeSuppressions ---

  it('mergeSuppressions: dedup by normalized email, highest severity wins', () => {
    const ses: SuppressionEntry[] = [
      {
        email: 'Alice@Example.COM',
        reason: 'complaint',
        source: 'ses',
        severity: 4,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ];
    const listmonk: SuppressionEntry[] = [
      {
        email: 'alice@example.com',
        reason: 'bounce_transient',
        source: 'listmonk',
        severity: 2,
        createdAt: '2026-06-02T00:00:00Z',
      },
    ];
    const merged = mergeSuppressions([ses, listmonk]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reason).toBe('complaint');
    expect(merged[0].severity).toBe(4);
    expect(merged[0].source).toBe('ses');
  });

  it('mergeSuppressions: ties broken by most recent createdAt', () => {
    const a: SuppressionEntry[] = [
      {
        email: 'a@b.com',
        reason: 'complaint',
        source: 'ses',
        severity: 4,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ];
    const b: SuppressionEntry[] = [
      {
        email: 'A@b.com',
        reason: 'complaint',
        source: 'listmonk',
        severity: 4,
        createdAt: '2026-06-10T00:00:00Z',
      },
    ];
    const merged = mergeSuppressions([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('listmonk'); // newer wins
  });

  it('mergeSuppressions: preserves entries from a single list', () => {
    const list: SuppressionEntry[] = [
      {
        email: 'a@a.com',
        reason: 'complaint',
        source: 'ses',
        severity: 4,
        createdAt: '2026-06-01T00:00:00Z',
      },
      {
        email: 'b@b.com',
        reason: 'bounce_transient',
        source: 'ses',
        severity: 2,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ];
    const merged = mergeSuppressions([list]);
    expect(merged).toHaveLength(2);
  });

  it('mergeSuppressions: handles +alias dedup across entries', () => {
    const a: SuppressionEntry[] = [
      {
        email: 'alice+work@example.com',
        reason: 'bounce_permanent',
        source: 'ses',
        severity: 3,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ];
    const b: SuppressionEntry[] = [
      {
        email: 'alice@example.com',
        reason: 'complaint',
        source: 'listmonk',
        severity: 4,
        createdAt: '2026-06-02T00:00:00Z',
      },
    ];
    const merged = mergeSuppressions([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reason).toBe('complaint'); // severity 4 > 3
  });

  it('mergeSuppressions: empty lists produce empty result', () => {
    expect(mergeSuppressions([])).toEqual([]);
    expect(mergeSuppressions([[]])).toEqual([]);
    expect(mergeSuppressions([[], [], []])).toEqual([]);
  });

  // --- toBlocklistFormat ---

  it('toBlocklistFormat: CSV header + rows', () => {
    const entries: SuppressionEntry[] = [
      {
        email: 'alice@example.com',
        reason: 'complaint',
        source: 'ses',
        severity: 4,
        createdAt: '2026-06-01T00:00:00Z',
      },
      {
        email: 'bob@example.com',
        reason: 'bounce_permanent',
        source: 'listmonk',
        severity: 3,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ];
    const csv = toBlocklistFormat(entries);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('email,reason');
    expect(lines).toContain('alice@example.com,complaint');
    expect(lines).toContain('bob@example.com,bounce_permanent');
  });

  it('toBlocklistFormat: excludes manual-only severity-1 entries', () => {
    const entries: SuppressionEntry[] = [
      {
        email: 'alice@example.com',
        reason: 'complaint',
        source: 'ses',
        severity: 4,
        createdAt: '2026-06-01T00:00:00Z',
      },
      {
        email: 'bob@example.com',
        reason: 'manual',
        source: 'manual',
        severity: 1,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ];
    const csv = toBlocklistFormat(entries);
    expect(csv).not.toContain('bob@example.com');
    expect(csv).toContain('alice@example.com');
  });

  it('toBlocklistFormat: empty entries produce only the header', () => {
    expect(toBlocklistFormat([])).toBe('email,reason');
  });

  // --- Never throws ---

  it('severityRank never throws', () => {
    expect(() => severityRank(null as unknown as string)).not.toThrow();
    expect(() => severityRank(undefined as unknown as string)).not.toThrow();
  });

  it('normalizeEmail never throws', () => {
    expect(() => normalizeEmail(null as unknown as string)).not.toThrow();
    expect(() => normalizeEmail(undefined as unknown as string)).not.toThrow();
  });

  it('mergeSuppressions never throws on garbage input', () => {
    expect(() =>
      mergeSuppressions(null as unknown as readonly (readonly SuppressionEntry[])[]),
    ).not.toThrow();
  });

  it('toBlocklistFormat never throws', () => {
    expect(() => toBlocklistFormat(null as unknown as readonly SuppressionEntry[])).not.toThrow();
  });
});
