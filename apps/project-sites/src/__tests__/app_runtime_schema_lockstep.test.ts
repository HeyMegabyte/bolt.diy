/**
 * AppRuntime Durable Object — inline-DDL ↔ migration-file lockstep guard.
 *
 * `src/durable_objects/app_runtime.ts` embeds its SQLite schema inline
 * (`SCHEMA_SQL`, applied via `appSql.exec(...)`) and references a canonical copy at
 * `migrations/do-app-runtime-schema.sql`. That migration file was MISSING until
 * this guard landed — the "kept in lockstep" comment pointed at a non-existent
 * file. Both now exist; this test keeps them identical so the DO's runtime tables
 * can never silently disagree with the declared schema (mirrors the TraceHub guard).
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

describe('AppRuntime DO schema lockstep (inline SCHEMA_SQL ↔ migration .sql)', () => {
  it('the inline DDL matches migrations/do-app-runtime-schema.sql (comments/whitespace aside)', () => {
    const doSrc = readFileSync(join(__dirname, '../durable_objects/app_runtime.ts'), 'utf8');
    const match = doSrc.match(/const SCHEMA_SQL = `([\s\S]*?)`;/);
    expect(match).not.toBeNull();

    const inline = normalizeDdl(match![1]);
    const migration = normalizeDdl(
      readFileSync(join(__dirname, '../../migrations/do-app-runtime-schema.sql'), 'utf8'),
    );

    expect(inline).toBe(migration);
  });

  it('both copies declare the app_meta + app_logs tables (sanity)', () => {
    const migration = readFileSync(
      join(__dirname, '../../migrations/do-app-runtime-schema.sql'),
      'utf8',
    );
    for (const table of ['app_meta', 'app_logs']) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
    }
  });
});
