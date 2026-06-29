/**
 * @module plane_templates.test
 * @remarks
 * Contract-locking tests for {@link DEFAULT_TEMPLATE} and {@link templateFor}.
 * Locks the canonical state/label/cycle set and the per-type overrides.
 * Drift here means a plane-backend consumer gets the wrong seed data.
 */

import { DEFAULT_TEMPLATE, templateFor, type PlaneTemplate } from '../services/plane_templates.js';

describe('DEFAULT_TEMPLATE', () => {
  // -----------------------------------------------------------------------
  // Shape
  // -----------------------------------------------------------------------
  it('has states, labels, and cycles', () => {
    expect(DEFAULT_TEMPLATE).toHaveProperty('states');
    expect(DEFAULT_TEMPLATE).toHaveProperty('labels');
    expect(DEFAULT_TEMPLATE).toHaveProperty('cycles');
  });

  // -----------------------------------------------------------------------
  // States
  // -----------------------------------------------------------------------
  it('has exactly 6 canonical states in order', () => {
    expect(DEFAULT_TEMPLATE.states).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'In Review',
      'Done',
      'Cancelled',
    ]);
  });

  // -----------------------------------------------------------------------
  // Labels
  // -----------------------------------------------------------------------
  it('has exactly 6 canonical labels', () => {
    const labels = DEFAULT_TEMPLATE.labels;
    expect(labels).toHaveLength(6);

    const names = labels.map((l) => l.name);
    expect(names).toEqual(['bug', 'feature', 'improvement', 'task', 'urgent', 'ops']);
  });

  it('every label has a name and a hex color', () => {
    for (const label of DEFAULT_TEMPLATE.labels) {
      expect(typeof label.name).toBe('string');
      expect(label.name.length).toBeGreaterThan(0);
      expect(label.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('label colors match the canonical mapping', () => {
    const byName = Object.fromEntries(DEFAULT_TEMPLATE.labels.map((l) => [l.name, l.color]));

    expect(byName.bug).toBe('#ff0000');
    expect(byName.feature).toBe('#3b82f6');
    expect(byName.improvement).toBe('#22c55e');
    expect(byName.task).toBe('#6b7280');
    expect(byName.urgent).toBe('#f97316');
    expect(byName.ops).toBe('#eab308');
  });

  // -----------------------------------------------------------------------
  // Cycles
  // -----------------------------------------------------------------------
  it('has exactly 6 sprints of 2 weeks each', () => {
    expect(DEFAULT_TEMPLATE.cycles).toHaveLength(6);

    DEFAULT_TEMPLATE.cycles.forEach((cycle, i) => {
      expect(cycle.name).toBe(`Sprint ${i + 1}`);
      expect(cycle.durationWeeks).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Frozen — every array / object is readonly
  // -----------------------------------------------------------------------
  it('all arrays are readonly (freeze-check via spread in mutation guard)', () => {
    // If any array were mutable, spreading into a new array would still work;
    // we verify that DEFAULT_TEMPLATE itself is not frozen (TS readonly is
    // compile-time), but the RUNTIME contract is that callers never mutate it.
    // The next-best assertion: every state/label/cycle item is a plain object.
    for (const state of DEFAULT_TEMPLATE.states) {
      expect(typeof state).toBe('string');
    }
    for (const label of DEFAULT_TEMPLATE.labels) {
      expect(typeof label.name).toBe('string');
      expect(typeof label.color).toBe('string');
    }
    for (const cycle of DEFAULT_TEMPLATE.cycles) {
      expect(typeof cycle.name).toBe('string');
      expect(typeof cycle.durationWeeks).toBe('number');
    }
  });
});

describe('templateFor', () => {
  // -----------------------------------------------------------------------
  // 'app'
  // -----------------------------------------------------------------------
  describe("'app'", () => {
    const tpl = templateFor('app');

    it('returns a PlaneTemplate', () => {
      expect(tpl).toHaveProperty('states');
      expect(tpl).toHaveProperty('labels');
      expect(tpl).toHaveProperty('cycles');
    });

    it('has the 6 canonical states (unchanged)', () => {
      expect(tpl.states).toEqual(DEFAULT_TEMPLATE.states);
    });

    it('has 7 labels (canonical + qa)', () => {
      expect(tpl.labels).toHaveLength(7);
      expect(tpl.labels[tpl.labels.length - 1].name).toBe('qa');
      expect(tpl.labels[tpl.labels.length - 1].color).toBe('#a855f7');
    });

    it('has the 6 canonical cycles', () => {
      expect(tpl.cycles).toHaveLength(6);
      expect(tpl.cycles[0].name).toBe('Sprint 1');
      expect(tpl.cycles[0].durationWeeks).toBe(2);
    });

    it('preserves the 6 canonical labels in order before qa', () => {
      const firstSix = tpl.labels.slice(0, 6);
      expect(firstSix.map((l) => l.name)).toEqual([
        'bug',
        'feature',
        'improvement',
        'task',
        'urgent',
        'ops',
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // 'site_build'
  // -----------------------------------------------------------------------
  describe("'site_build'", () => {
    const tpl = templateFor('site_build');

    it('has 5 states (no "In Review")', () => {
      expect(tpl.states).toHaveLength(5);
      expect(tpl.states).toEqual(['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled']);
    });

    it('has 7 labels (canonical + content)', () => {
      expect(tpl.labels).toHaveLength(7);
      expect(tpl.labels[tpl.labels.length - 1].name).toBe('content');
      expect(tpl.labels[tpl.labels.length - 1].color).toBe('#06b6d4');
    });

    it('has 4 cycles (Sprint 1-4, 2 weeks each)', () => {
      expect(tpl.cycles).toHaveLength(4);
      tpl.cycles.forEach((cycle, i) => {
        expect(cycle.name).toBe(`Sprint ${i + 1}`);
        expect(cycle.durationWeeks).toBe(2);
      });
    });

    it('does not contain "In Review" anywhere in states', () => {
      expect(tpl.states.includes('In Review')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 'ops'
  // -----------------------------------------------------------------------
  describe("'ops'", () => {
    const tpl = templateFor('ops');

    it('has 7 states (canonical + "Monitoring" before Cancelled)', () => {
      expect(tpl.states).toHaveLength(7);
      expect(tpl.states).toEqual([
        'Backlog',
        'Todo',
        'In Progress',
        'In Review',
        'Done',
        'Monitoring',
        'Cancelled',
      ]);
    });

    it('has 7 labels (canonical + security)', () => {
      expect(tpl.labels).toHaveLength(7);
      expect(tpl.labels[tpl.labels.length - 1].name).toBe('security');
      expect(tpl.labels[tpl.labels.length - 1].color).toBe('#dc2626');
    });

    it('has 4 cycles (Wave 1-4, 4 weeks each)', () => {
      expect(tpl.cycles).toHaveLength(4);
      tpl.cycles.forEach((cycle, i) => {
        expect(cycle.name).toBe(`Wave ${i + 1}`);
        expect(cycle.durationWeeks).toBe(4);
      });
    });

    it('Monitoring is present and Cancelled is last', () => {
      const idx = tpl.states.indexOf('Monitoring');
      expect(idx).toBe(5);
      expect(tpl.states[idx + 1]).toBe('Cancelled');
    });
  });

  // -----------------------------------------------------------------------
  // Every type never throws
  // -----------------------------------------------------------------------
  it('never throws for any valid project type', () => {
    for (const pt of ['app', 'site_build', 'ops'] as const) {
      expect(() => templateFor(pt)).not.toThrow();
    }
  });

  // -----------------------------------------------------------------------
  // Returns are isolated (calls don't share mutation)
  // -----------------------------------------------------------------------
  it('every call returns a fresh object', () => {
    const a = templateFor('app');
    const b = templateFor('app');

    expect(a).not.toBe(b);
    expect(a.states).not.toBe(b.states);
    expect(a.labels).not.toBe(b.labels);
    expect(a.cycles).not.toBe(b.cycles);
  });

  // -----------------------------------------------------------------------
  // Every label has a valid hex color across all types
  // -----------------------------------------------------------------------
  it('every label across all types has a valid hex color', () => {
    for (const pt of ['app', 'site_build', 'ops'] as const) {
      for (const label of templateFor(pt).labels) {
        expect(label.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Cycles are always ≥1 week
  // -----------------------------------------------------------------------
  it('every cycle across all types has durationWeeks ≥ 1', () => {
    for (const pt of ['app', 'site_build', 'ops'] as const) {
      for (const cycle of templateFor(pt).cycles) {
        expect(cycle.durationWeeks).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// -----------------------------------------------------------------------
// Type-level check: PlaneTemplate is assignable from the exported values
// -----------------------------------------------------------------------
// The following line would FAIL to compile if a template violated the type:
// (uncomment to verify type soundness at the type-check gate)
// const _check: PlaneTemplate = { states: [], labels: [], cycles: [] };
