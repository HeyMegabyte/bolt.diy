import {
  buildPlan,
  planToSql,
  validatePlan,
  type MigrationOp,
  type MigrationStep,
} from '../services/migration_plan.js';

describe('buildPlan', () => {
  it('creates a MigrationPlan with frozen steps', () => {
    const steps: MigrationStep[] = [
      {
        op: 'create_table',
        sql: 'CREATE TABLE t (id TEXT PRIMARY KEY)',
        reversible: true,
        rollbackSql: 'DROP TABLE IF EXISTS t',
      },
    ];
    const plan = buildPlan(1, 'Create t', steps);
    expect(plan.version).toBe(1);
    expect(plan.name).toBe('Create t');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].sql).toBe('CREATE TABLE t (id TEXT PRIMARY KEY)');
  });

  it('freezes the returned plan and its steps array', () => {
    const plan = buildPlan(1, 'Frozen', []);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
  });

  it('accepts all five MigrationOp values', () => {
    const ops: MigrationOp[] = [
      'create_table',
      'add_column',
      'create_index',
      'drop_column',
      'alter_column',
    ];
    for (const op of ops) {
      const step: MigrationStep = { op, sql: '-- no-op', reversible: false, rollbackSql: null };
      expect(() => buildPlan(1, op, [step])).not.toThrow();
    }
  });
});

describe('planToSql', () => {
  it('produces up SQL as all step.sql joined by double newlines', () => {
    const plan = buildPlan(1, 'Multi-step', [
      {
        op: 'create_table',
        sql: 'CREATE TABLE a (id TEXT PRIMARY KEY)',
        reversible: true,
        rollbackSql: 'DROP TABLE IF EXISTS a',
      },
      {
        op: 'add_column',
        sql: 'ALTER TABLE a ADD COLUMN name TEXT',
        reversible: true,
        rollbackSql: 'ALTER TABLE a DROP COLUMN name',
      },
    ]);
    const { up, down } = planToSql(plan);
    expect(up).toBe('CREATE TABLE a (id TEXT PRIMARY KEY)\n\nALTER TABLE a ADD COLUMN name TEXT');
    expect(down).toBe('DROP TABLE IF EXISTS a\n\nALTER TABLE a DROP COLUMN name');
  });

  it('down includes only reversible steps', () => {
    const plan = buildPlan(1, 'Mixed reversibility', [
      {
        op: 'create_table',
        sql: 'CREATE TABLE a (id TEXT PRIMARY KEY)',
        reversible: true,
        rollbackSql: 'DROP TABLE IF EXISTS a',
      },
      {
        op: 'drop_column',
        sql: 'ALTER TABLE a DROP COLUMN old',
        reversible: false,
        rollbackSql: null,
      },
    ]);
    const { down } = planToSql(plan);
    expect(down).toBe('DROP TABLE IF EXISTS a');
  });

  it('down is a comment when no step is reversible', () => {
    const plan = buildPlan(2, 'Irreversible', [
      {
        op: 'drop_column',
        sql: 'ALTER TABLE x DROP COLUMN y',
        reversible: false,
        rollbackSql: null,
      },
    ]);
    const { down } = planToSql(plan);
    expect(down).toBe('-- No rollback available');
  });

  it('returns empty up string for an empty plan', () => {
    const plan = buildPlan(1, 'Empty', []);
    const { up } = planToSql(plan);
    expect(up).toBe('');
  });
});

describe('validatePlan', () => {
  const validStep: MigrationStep = {
    op: 'create_table',
    sql: 'CREATE TABLE t (id TEXT PRIMARY KEY)',
    reversible: true,
    rollbackSql: 'DROP TABLE IF EXISTS t',
  };

  it('passes a well-formed plan', () => {
    const plan = buildPlan(1, 'Good plan', [validStep]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects version <= 0', () => {
    const r0 = validatePlan(buildPlan(0, 'Zero', [validStep]));
    expect(r0.valid).toBe(false);
    expect(r0.errors).toContain('version must be a positive integer');

    const rNeg = validatePlan(buildPlan(-1, 'Negative', [validStep]));
    expect(rNeg.valid).toBe(false);
    expect(rNeg.errors).toContain('version must be a positive integer');
  });

  it('rejects non-integer version', () => {
    const plan = buildPlan(1.5 as unknown as number, 'Float', [validStep]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('version must be a positive integer');
  });

  it('rejects empty name', () => {
    const rEmpty = validatePlan(buildPlan(1, '', [validStep]));
    expect(rEmpty.valid).toBe(false);
    expect(rEmpty.errors).toContain('name must not be empty');

    const rBlank = validatePlan(buildPlan(1, '   ', [validStep]));
    expect(rBlank.valid).toBe(false);
    expect(rBlank.errors).toContain('name must not be empty');
  });

  it('rejects empty steps', () => {
    const plan = buildPlan(1, 'No steps', []);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('at least one step required');
  });

  it('rejects a step with empty sql', () => {
    const plan = buildPlan(1, 'Bad step', [
      { op: 'create_table' as const, sql: '', reversible: true, rollbackSql: 'DROP' },
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('step 1: sql must not be empty');
  });

  it('rejects a step with whitespace-only sql', () => {
    const plan = buildPlan(1, 'Whitespace sql', [
      { op: 'add_column' as const, sql: '   ', reversible: false, rollbackSql: null },
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('step 1: sql must not be empty');
  });

  it('rejects a non-boolean reversible field', () => {
    const plan = buildPlan(1, 'Bad reversible', [
      {
        op: 'create_table' as const,
        sql: 'CREATE TABLE t (id TEXT PRIMARY KEY)',
        reversible: 1 as unknown as boolean,
        rollbackSql: null,
      },
    ]);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('step 1: reversible must be a boolean');
  });

  it('accumulates multiple errors', () => {
    const plan = buildPlan(0, '', []);
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
