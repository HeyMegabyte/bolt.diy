/**
 * Guards the Worker compatibility_date against staleness.
 *
 * A stale `compatibility_date` silently locks the Worker out of accumulated
 * Cloudflare runtime fixes and `node:` module support. This gate fails the
 * build if the pinned date drifts more than ~120 days behind a known floor,
 * forcing a deliberate bump rather than silent rot.
 *
 * Ledger: 50-improvement audit (2026-06-19) item #1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('wrangler.toml compatibility', () => {
  const toml = readFileSync(join(__dirname, '..', '..', 'wrangler.toml'), 'utf8');

  function compatDate(): string {
    const m = toml.match(/^compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m);
    if (!m) throw new Error('compatibility_date not found in wrangler.toml');
    return m[1];
  }

  it('declares a top-level compatibility_date', () => {
    expect(compatDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is not stale — at least 2026-06-19 (the audit-#1 floor)', () => {
    // RED until the date is bumped from the stale 2026-05-01.
    expect(compatDate() >= '2026-06-19').toBe(true);
  });

  it('keeps nodejs_compat enabled (required since 2026-03-17)', () => {
    expect(toml).toMatch(/^compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"/m);
  });
});
