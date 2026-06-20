/**
 * Guards that Angular CLI schematics generate spec files.
 *
 * `skipTests: true` on every schematic meant `ng generate component|service|…`
 * never emitted a `*.spec.ts`, so CLI-scaffolded code shipped test-free — in
 * direct conflict with the repo's 100%-coverage mandate. This gate fails if any
 * schematic re-enables skipTests.
 *
 * Ledger: 50-improvement audit (2026-06-19) item #50.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('angular.json schematics (audit #50)', () => {
  const raw = readFileSync(
    join(__dirname, '..', '..', 'frontend', 'angular.json'),
    'utf8',
  );

  it('does not skip test generation on any schematic', () => {
    // RED until the eight `"skipTests": true` flags are flipped to false.
    expect(/"skipTests"\s*:\s*true/.test(raw)).toBe(false);
  });
});
