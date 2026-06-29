/**
 * @module __tests__/plane_cycle_automation
 * @description Unit tests for the Plane cycle automation service.
 *
 * Pure-function coverage: `generateCycles`, `generateModules`,
 * `defaultMembers`. No mocks needed — all functions are zero-I/O,
 * deterministic, and never throw.
 */

import {
  generateCycles,
  generateModules,
  defaultMembers,
  type CycleSpec,
} from '../services/plane_cycle_automation.js';

// ────────────────────────────────────────────────────────────
// generateCycles
// ────────────────────────────────────────────────────────────
describe('generateCycles', () => {
  it('returns exactly 6 cycles with default 2-week sprints', () => {
    const cycles = generateCycles('2026-07-06');
    expect(cycles).toHaveLength(6);
  });

  it('names cycles Sprint 1 through Sprint 6 in order', () => {
    const cycles = generateCycles('2026-07-06');
    for (let i = 0; i < cycles.length; i++) {
      expect(cycles[i].name).toBe(`Sprint ${i + 1}`);
    }
  });

  it('computes correct startDate / endDate for 2-week default sprints', () => {
    const cycles = generateCycles('2026-07-06');
    const expected: CycleSpec[] = [
      { name: 'Sprint 1', startDate: '2026-07-06', endDate: '2026-07-19' },
      { name: 'Sprint 2', startDate: '2026-07-20', endDate: '2026-08-02' },
      { name: 'Sprint 3', startDate: '2026-08-03', endDate: '2026-08-16' },
      { name: 'Sprint 4', startDate: '2026-08-17', endDate: '2026-08-30' },
      { name: 'Sprint 5', startDate: '2026-08-31', endDate: '2026-09-13' },
      { name: 'Sprint 6', startDate: '2026-09-14', endDate: '2026-09-27' },
    ];
    expect(cycles).toEqual(expected);
  });

  it('accepts custom sprintWeeks (1-week sprints)', () => {
    const cycles = generateCycles('2026-07-06', 1);
    expect(cycles).toHaveLength(6);
    // Each sprint lasts 7 days (1 week).
    expect(cycles[0]).toMatchObject({ startDate: '2026-07-06', endDate: '2026-07-12' });
    expect(cycles[1]).toMatchObject({ startDate: '2026-07-13', endDate: '2026-07-19' });
    expect(cycles[5]).toMatchObject({ startDate: '2026-08-10', endDate: '2026-08-16' });
  });

  it('accepts custom sprintWeeks (3-week sprints)', () => {
    const cycles = generateCycles('2026-01-05', 3);
    expect(cycles).toHaveLength(6);
    // Each sprint lasts 21 days.
    expect(cycles[0].startDate).toBe('2026-01-05');
    expect(cycles[0].endDate).toBe('2026-01-25');
    expect(cycles[5].startDate).toBe('2026-04-20');
    expect(cycles[5].endDate).toBe('2026-05-10');
  });

  it('accepts custom sprintWeeks (4-week sprints — max clamp)', () => {
    const cycles = generateCycles('2026-07-06', 4);
    expect(cycles).toHaveLength(6);
    expect(cycles[0].startDate).toBe('2026-07-06');
    expect(cycles[0].endDate).toBe('2026-08-02');
    expect(cycles[5].startDate).toBe('2026-11-23');
    expect(cycles[5].endDate).toBe('2026-12-20');
  });

  it('clamps sprintWeeks below 1 up to 1', () => {
    const cycles = generateCycles('2026-07-06', 0);
    // 0 → clamped to 1 → 1-week sprints.
    expect(cycles[0].endDate).toBe('2026-07-12');
  });

  it('clamps sprintWeeks above 4 down to 4', () => {
    const cycles = generateCycles('2026-07-06', 10);
    // 10 → clamped to 4 → 4-week sprints.
    expect(cycles[0].endDate).toBe('2026-08-02');
  });

  it('clamps sprintWeeks negative values up to 1', () => {
    const cycles = generateCycles('2026-07-06', -5);
    expect(cycles[0].endDate).toBe('2026-07-12');
  });

  it('clamps float sprintWeeks down to the integer floor', () => {
    const cycles = generateCycles('2026-07-06', 2.7);
    // floor(2.7) = 2
    expect(cycles[0].endDate).toBe('2026-07-19');
  });

  it('handles an invalid projectStart date gracefully (returns cycles with that string as start)', () => {
    // The function never throws; an invalid date propagates through.
    expect(() => generateCycles('not-a-date')).not.toThrow();
    const cycles = generateCycles('not-a-date');
    expect(cycles).toHaveLength(6);
    // Each cycle gets the same invalid string as start; Date addition is NaN-safe.
    expect(cycles[0].startDate).toBe('not-a-date');
  });

  it('handles empty string projectStart gracefully', () => {
    expect(() => generateCycles('')).not.toThrow();
    const cycles = generateCycles('');
    expect(cycles).toHaveLength(6);
  });

  it('produces back-to-back cycles with no gaps between sprints', () => {
    const cycles = generateCycles('2026-07-06');
    for (let i = 1; i < cycles.length; i++) {
      const prevEnd = new Date(cycles[i - 1].endDate);
      const currStart = new Date(cycles[i].startDate);
      // The next sprint starts the day after the prior one ends.
      const expectedNext = new Date(prevEnd);
      expectedNext.setUTCDate(expectedNext.getUTCDate() + 1);
      expect(currStart.getTime()).toBe(expectedNext.getTime());
    }
  });

  it('produces ISO 8601 date strings (YYYY-MM-DD) for every startDate and endDate', () => {
    const cycles = generateCycles('2026-07-06', 2);
    const isoPat = /^\d{4}-\d{2}-\d{2}$/;
    for (const c of cycles) {
      expect(c.startDate).toMatch(isoPat);
      expect(c.endDate).toMatch(isoPat);
    }
  });

  it('never throws regardless of input shape', () => {
    // @ts-expect-error — testing runtime resilience with undefined
    expect(() => generateCycles(undefined)).not.toThrow();
    // @ts-expect-error — testing runtime resilience with null
    expect(() => generateCycles(null)).not.toThrow();
    // @ts-expect-error — testing runtime resilience with a number
    expect(() => generateCycles(42)).not.toThrow();
  });

  it('returns frozen-like fresh objects each call (caller can safely mutate)', () => {
    const a = generateCycles('2026-07-06');
    const b = generateCycles('2026-07-06');
    expect(a).toEqual(b);
    // Different references — safe to spread/mutate.
    a[0] = { name: 'Custom', startDate: 'x', endDate: 'y' };
    expect(b[0].name).toBe('Sprint 1');
  });
});

// ────────────────────────────────────────────────────────────
// generateModules
// ────────────────────────────────────────────────────────────
describe('generateModules', () => {
  it('returns 4 module templates', () => {
    const modules = generateModules();
    expect(modules).toHaveLength(4);
  });

  it('includes Frontend, Backend, Design, and DevOps', () => {
    const modules = generateModules();
    const names = modules.map((m) => m.name);
    expect(names).toContain('Frontend');
    expect(names).toContain('Backend');
    expect(names).toContain('Design');
    expect(names).toContain('DevOps');
  });

  it('returns them in the correct order', () => {
    const modules = generateModules();
    expect(modules[0].name).toBe('Frontend');
    expect(modules[1].name).toBe('Backend');
    expect(modules[2].name).toBe('Design');
    expect(modules[3].name).toBe('DevOps');
  });

  it('every module has a non-empty description', () => {
    for (const m of generateModules()) {
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it('returns fresh objects each call (caller can safely mutate)', () => {
    const a = generateModules();
    const b = generateModules();
    expect(a).toEqual(b);
    a[0] = { name: 'Changed', description: 'changed' };
    expect(b[0].name).toBe('Frontend');
  });
});

// ────────────────────────────────────────────────────────────
// defaultMembers
// ────────────────────────────────────────────────────────────
describe('defaultMembers', () => {
  it('returns 3 role entries', () => {
    const members = defaultMembers();
    expect(members).toHaveLength(3);
  });

  it('includes admin, member, and viewer roles', () => {
    const members = defaultMembers();
    const roles = members.map((m) => m.role);
    expect(roles).toContain('admin');
    expect(roles).toContain('member');
    expect(roles).toContain('viewer');
  });

  it('returns them in the correct order', () => {
    const members = defaultMembers();
    expect(members[0].role).toBe('admin');
    expect(members[1].role).toBe('member');
    expect(members[2].role).toBe('viewer');
  });

  it('sets admin count to 1', () => {
    const admin = defaultMembers().find((m) => m.role === 'admin')!;
    expect(admin.count).toBe(1);
  });

  it('sets member count to 2', () => {
    const member = defaultMembers().find((m) => m.role === 'member')!;
    expect(member.count).toBe(2);
  });

  it('sets viewer count to 1', () => {
    const viewer = defaultMembers().find((m) => m.role === 'viewer')!;
    expect(viewer.count).toBe(1);
  });

  it('all counts are non-negative integers', () => {
    for (const m of defaultMembers()) {
      expect(m.count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(m.count)).toBe(true);
    }
  });

  it('returns fresh objects each call (caller can safely mutate)', () => {
    const a = defaultMembers();
    const b = defaultMembers();
    expect(a).toEqual(b);
    a[0] = { role: 'admin', count: 99 };
    expect(b[0].count).toBe(1);
  });
});
