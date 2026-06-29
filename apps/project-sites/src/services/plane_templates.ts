/**
 * @module plane_templates
 * @remarks
 * PL23 — standard Plane states/labels/cycles that every new project gets seeded
 * with. Pure, never throws, zero I/O.
 *
 * @example
 * ```ts
 * const tpl = templateFor('app');
 * // tpl.states → ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']
 * // tpl.labels → [{ name: 'bug', color: '#ff0000' }, …]
 * // tpl.cycles → [{ name: 'Sprint 1', durationWeeks: 2 }, …]
 * ```
 */

/** Typed template for seeding a new Plane project. */
export interface PlaneTemplate {
  readonly cycles: readonly { durationWeeks: number; name: string }[];
  readonly labels: readonly { color: string; name: string }[];
  readonly states: readonly string[];
}

/* ── Canonical defaults ─────────────────────────────────────────────── */

const DEFAULT_STATES = [
  'Backlog',
  'Todo',
  'In Progress',
  'In Review',
  'Done',
  'Cancelled',
] as const satisfies readonly string[];

const DEFAULT_LABELS = [
  { color: '#ff0000', name: 'bug' },
  { color: '#3b82f6', name: 'feature' },
  { color: '#22c55e', name: 'improvement' },
  { color: '#6b7280', name: 'task' },
  { color: '#f97316', name: 'urgent' },
  { color: '#eab308', name: 'ops' },
] as const satisfies readonly { color: string; name: string }[];

function buildCycles(count: number, prefix = 'Sprint', weeks = 2) {
  return Array.from({ length: count }, (_, i) => ({
    durationWeeks: weeks,
    name: `${prefix} ${i + 1}`,
  }));
}

const DEFAULT_CYCLES = buildCycles(6, 'Sprint', 2) as readonly {
  name: string;
  color?: string;
  durationWeeks: number;
}[];

/** Canonical template: 6 states, 6 labels, 6 sprints. */
export const DEFAULT_TEMPLATE: PlaneTemplate = {
  cycles: DEFAULT_CYCLES,
  labels: DEFAULT_LABELS,
  states: DEFAULT_STATES,
};

/* ── Per-type overrides ─────────────────────────────────────────────── */

/**
 * State/label/cycle template tuned for a project type.
 *
 * - **app** — adds a `qa` label; otherwise canonical.
 * - **site_build** — drops "In Review" from states (builds go straight to Done);
 *   adds a `content` label.
 * - **ops** — adds "Monitoring" after "Done"; adds a `security` label.
 *
 * @throws Never throws — returns a complete PlaneTemplate for every input.
 */
export function templateFor(projectType: 'app' | 'site_build' | 'ops'): PlaneTemplate {
  switch (projectType) {
    case 'app':
      return {
        cycles: [...DEFAULT_CYCLES],
        labels: [...DEFAULT_LABELS, { color: '#a855f7', name: 'qa' }],
        states: [...DEFAULT_STATES],
      };

    case 'site_build':
      return {
        cycles: buildCycles(4, 'Sprint', 2),
        labels: [...DEFAULT_LABELS, { color: '#06b6d4', name: 'content' }],
        states: ['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled'] as const,
      };

    case 'ops':
      return {
        cycles: buildCycles(4, 'Wave', 4),
        labels: [...DEFAULT_LABELS, { color: '#dc2626', name: 'security' }],
        states: [...DEFAULT_STATES.slice(0, 5), 'Monitoring', 'Cancelled'] as const,
      };
  }
}
