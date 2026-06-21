/**
 * TraceHub Durable Object — inline-DDL ↔ migration-file lockstep guard.
 *
 * `src/durable_objects/trace_hub.ts` embeds its SQLite schema inline (`SCHEMA_SQL`)
 * so the DO never depends on a file fetch at runtime, AND keeps a canonical
 * human-readable copy at `migrations/do-tracehub-schema.sql`. Both files carry a
 * "edit BOTH in lockstep" note — a purely MANUAL sync. If they drift (a column
 * added to the migration but not the inline copy, or vice versa) the DO creates a
 * table shape that disagrees with the declared schema, silently, with no gate.
 *
 * This locks the two together: after stripping SQL comments + collapsing
 * whitespace, the inline DDL must be byte-identical to the migration's DDL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Strip `-- line comments`, collapse whitespace, lowercase — DDL-equivalence form. */
function normalizeDdl(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

describe('TraceHub DO schema lockstep (inline SCHEMA_SQL ↔ migration .sql)', () => {
  it('the inline DDL matches migrations/do-tracehub-schema.sql (comments/whitespace aside)', () => {
    const doSrc = readFileSync(join(__dirname, '../durable_objects/trace_hub.ts'), 'utf8');
    const match = doSrc.match(/const SCHEMA_SQL = `([\s\S]*?)`;/);
    expect(match).not.toBeNull();

    const inline = normalizeDdl(match![1]);
    const migration = normalizeDdl(
      readFileSync(join(__dirname, '../../migrations/do-tracehub-schema.sql'), 'utf8'),
    );

    // Equal DDL ⇒ the DO's runtime tables match the canonical migration exactly.
    expect(inline).toBe(migration);
  });

  it('both copies declare the trace_events + activity_events tables (sanity)', () => {
    const migration = readFileSync(
      join(__dirname, '../../migrations/do-tracehub-schema.sql'),
      'utf8',
    );
    for (const table of ['trace_events', 'activity_events']) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
    }
  });
});
