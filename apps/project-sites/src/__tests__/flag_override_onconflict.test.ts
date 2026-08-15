/**
 * Regression guard for the flag_overrides upsert class (iter 78).
 *
 * `flag_overrides` enforces uniqueness with a PARTIAL index
 * `idx_flag_overrides_unique ON (scope, scope_id, flag_key) WHERE deleted_at IS NULL`.
 * SQLite requires an upsert's `ON CONFLICT` target to repeat that WHERE predicate —
 * omit it and EVERY execution throws "ON CONFLICT clause does not match any … UNIQUE
 * constraint" (proven live against prod D1). `features.ts` shipped that broken form
 * behind an empty catch → a silent lying-success toggle. This asserts every writer of
 * a `flag_overrides` `ON CONFLICT(scope, scope_id, flag_key)` repeats the predicate,
 * so a future writer (or a repopulated SITE_FEATURE_CATALOG) can't regress the class.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = join(__dirname, '..', 'routes');
// The three modules that upsert flag_overrides on (scope, scope_id, flag_key).
const FILES = ['features.ts', 'super_admin.ts', 'copilot.ts'];

describe('flag_overrides upsert — ON CONFLICT must repeat the partial-index WHERE', () => {
  for (const file of FILES) {
    it(`${file}: every (scope, scope_id, flag_key) conflict target includes WHERE deleted_at IS NULL`, () => {
      const src = readFileSync(join(ROUTES, file), 'utf8');
      // Capture the text between the conflict columns and DO UPDATE for each upsert.
      const upserts = [
        ...src.matchAll(/ON CONFLICT\(\s*scope,\s*scope_id,\s*flag_key\s*\)([\s\S]*?)DO UPDATE/g),
      ];
      // Each file that writes this table should have ≥1 such upsert (guards against a
      // silent refactor that drops the pattern entirely).
      expect(upserts.length).toBeGreaterThan(0);
      for (const m of upserts) {
        expect(m[1]).toContain('WHERE deleted_at IS NULL');
      }
    });
  }
});
