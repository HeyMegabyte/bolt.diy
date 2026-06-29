/**
 * @module services/migration_plan
 *
 * Pure D1 migration plan builder — generates ordered SQL statements for schema
 * changes. All exports are deterministic (no clock, no I/O).
 *
 * @example
 * ```ts
 * const plan = buildPlan(1, 'Add sites table', [
 *   { op: 'create_table', sql: 'CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT NOT NULL)', reversible: true, rollbackSql: 'DROP TABLE IF EXISTS sites' },
 * ]);
 * const { up, down } = planToSql(plan);
 * // up:   "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT NOT NULL)"
 * // down: "DROP TABLE IF EXISTS sites"
 * ```
 */

// ---------------------------------------------------------------------------
// MigrationOp — the closed set of schema operations
// ---------------------------------------------------------------------------

/** Discriminated union of every schema-operation kind the plan builder accepts. */
export type MigrationOp =
  | 'create_table'
  | 'add_column'
  | 'create_index'
  | 'drop_column'
  | 'alter_column';

// ---------------------------------------------------------------------------
// MigrationStep — a single atomic schema change
// ---------------------------------------------------------------------------

/** A single atomic schema change within a migration plan. */
export interface MigrationStep {
  /** The kind of schema operation. */
  op: MigrationOp;
  /** The SQL statement that applies this change. */
  sql: string;
  /** Whether this change can be safely rolled back. */
  reversible: boolean;
  /** SQL statement that reverses this change, or null when irreversible. */
  rollbackSql: string | null;
}

// ---------------------------------------------------------------------------
// MigrationPlan — an ordered set of schema changes
// ---------------------------------------------------------------------------

/** An ordered set of schema changes that form one versioned migration. */
export interface MigrationPlan {
  /** Monotonically increasing version number (> 0). */
  version: number;
  /** Human-readable name describing the purpose of this migration. */
  name: string;
  /** Ordered list of schema changes. */
  steps: readonly MigrationStep[];
}

// ---------------------------------------------------------------------------
// buildPlan — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed MigrationPlan with frozen steps.
 *
 * @param version - Monotonically increasing version number (must be > 0).
 * @param name    - Human-readable description of the migration.
 * @param steps   - Ordered list of schema changes.
 * @returns A complete MigrationPlan ready for validation or execution.
 *
 * @example
 * ```ts
 * const plan = buildPlan(1, 'Add sites table', [
 *   { op: 'create_table', sql: 'CREATE TABLE sites (id TEXT PRIMARY KEY)', reversible: true, rollbackSql: 'DROP TABLE IF EXISTS sites' },
 * ]);
 * expect(plan.version).toBe(1);
 * expect(plan.steps).toHaveLength(1);
 * ```
 */
export function buildPlan(version: number, name: string, steps: MigrationStep[]): MigrationPlan {
  return Object.freeze({
    name,
    steps: Object.freeze([...steps]),
    version,
  }) as MigrationPlan;
}

// ---------------------------------------------------------------------------
// planToSql — produce up/down SQL strings from a plan
// ---------------------------------------------------------------------------

/**
 * Converts a MigrationPlan into its forward (up) and rollback (down) SQL.
 *
 * The `up` string contains every step's SQL joined by double newlines.
 * The `down` string contains every reversible step's rollback SQL joined
 * by double newlines. When no step is reversible, `down` is a comment.
 *
 * @param plan - The migration plan to convert.
 * @returns An object with `up` and `down` SQL strings.
 *
 * @example
 * ```ts
 * const { up, down } = planToSql(plan);
 * // up:   "CREATE TABLE ...\n\nALTER TABLE ..."
 * // down: "DROP TABLE IF EXISTS ...\n\nALTER TABLE ..."
 * ```
 */
export function planToSql(plan: MigrationPlan): { down: string; up: string } {
  const up = plan.steps.map((s) => s.sql).join('\n\n');
  const rollbackSteps = plan.steps
    .filter((s) => s.reversible && s.rollbackSql !== null)
    .map((s) => s.rollbackSql as string);
  const down = rollbackSteps.length > 0 ? rollbackSteps.join('\n\n') : '-- No rollback available';
  return { down, up };
}

// ---------------------------------------------------------------------------
// validatePlan — verify a migration plan is well-formed
// ---------------------------------------------------------------------------

/**
 * Validates a MigrationPlan against structural rules.
 *
 * Rules checked:
 * - `version` must be greater than 0
 * - `name` must be a non-empty string
 * - `steps` array must not be empty
 * - Every step must have a non-empty `sql` field
 *
 * @param plan - The migration plan to validate.
 * @returns An object with `valid` boolean and an `errors` array of messages.
 *
 * @example
 * ```ts
 * const result = validatePlan(myPlan);
 * if (!result.valid) { console.error(result.errors); }
 * ```
 */
export function validatePlan(plan: MigrationPlan): {
  errors: string[];
  valid: boolean;
} {
  const errors: string[] = [];

  if (typeof plan.version !== 'number' || plan.version <= 0 || !Number.isInteger(plan.version)) {
    errors.push('version must be a positive integer');
  }

  if (typeof plan.name !== 'string' || plan.name.trim().length === 0) {
    errors.push('name must not be empty');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('at least one step required');
  } else {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (typeof step.sql !== 'string' || step.sql.trim().length === 0) {
        errors.push(`step ${i + 1}: sql must not be empty`);
      }
      if (step.reversible !== true && step.reversible !== false) {
        errors.push(`step ${i + 1}: reversible must be a boolean`);
      }
    }
  }

  return { errors, valid: errors.length === 0 };
}
