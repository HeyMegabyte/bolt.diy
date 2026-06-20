import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Drift gate (per rules/drift-detection § build-artifact guards): the Tinybird
 * `projectsites_events` datasource is a CURATED artifact whose single source of
 * truth is the NDJSON object `outbox_dispatch.dispatchOutboxEvent()` ingests.
 * If the worker adds/renames/removes an ingest column without updating the
 * .datasource SCHEMA (or vice-versa), Tinybird silently drops the mismatched
 * column on ingest — invisible until a query returns wrong data. This test
 * re-derives both column sets from source and fails the build on any divergence.
 */

const DISPATCH = join(__dirname, '../services/outbox_dispatch.ts');
const DATASOURCE = join(__dirname, '../../tinybird/datasources/projectsites_events.datasource');

/** Extract the keys of the object literal passed to `ingest(env, ..., { ... })`. */
function ingestColumns(src: string): string[] {
  // Isolate the object literal inside the ingest() call.
  const start = src.indexOf('ingest(');
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  const close = src.indexOf('}', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  // Top-level `key:` identifiers (snake_case columns) within that literal.
  return [...body.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort();
}

/** Extract the backtick-quoted column names from the .datasource SCHEMA block. */
function schemaColumns(src: string): string[] {
  const schemaStart = src.indexOf('SCHEMA >');
  const engineStart = src.indexOf('ENGINE', schemaStart);
  expect(schemaStart).toBeGreaterThan(-1);
  expect(engineStart).toBeGreaterThan(schemaStart);
  // Strip comment lines (# …) so backtick-quoted words inside SCHEMA-block
  // prose (e.g. the `payload`/`data` explanation) aren't counted as columns.
  const block = src
    .slice(schemaStart, engineStart)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  return [...block.matchAll(/`(\w+)`/g)].map((m) => m[1]).sort();
}

describe('Tinybird projectsites_events schema ↔ ingest parity', () => {
  it('the .datasource SCHEMA columns exactly match the worker ingest object keys', () => {
    const ingest = ingestColumns(readFileSync(DISPATCH, 'utf8'));
    const schema = schemaColumns(readFileSync(DATASOURCE, 'utf8'));

    // Sanity: the known 7-column contract is present (guards against a regex that
    // silently matched nothing on either side).
    expect(ingest).toEqual([
      'event',
      'event_id',
      'payload',
      'producer',
      'site_id',
      'tenant_id',
      'timestamp',
      'trace_id',
    ]);
    expect(schema).toEqual(ingest);
  });
});
