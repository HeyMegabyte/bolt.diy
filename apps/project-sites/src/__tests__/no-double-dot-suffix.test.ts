import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Regression guard for the double-dot host bug (fixed 2026-08-22).
 *
 * `DOMAINS.SITES_SUFFIX` is `'.projectsites.dev'` — it ALREADY begins with a dot.
 * So `` `https://${slug}.${DOMAINS.SITES_SUFFIX}` `` produced
 * `https://slug..projectsites.dev` — a host that does not resolve (a dead link
 * that shipped in the "your site is live" email). The correct form is
 * `` `${slug}${DOMAINS.SITES_SUFFIX}` `` (no extra dot). This test fails the
 * build if the buggy `.${...SITES_SUFFIX}` pattern is ever reintroduced.
 */
describe('no double-dot SITES_SUFFIX host construction', () => {
  const SRC = resolve(__dirname, '..');
  // A literal dot immediately before an interpolation ending in SITES_SUFFIX.
  const DOUBLE_DOT = /\.\$\{[^}]*SITES_SUFFIX\}/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('never writes ${x}.${DOMAINS.SITES_SUFFIX} (would yield slug..projectsites.dev)', () => {
    const offenders = walk(SRC)
      .filter((f) => DOUBLE_DOT.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
