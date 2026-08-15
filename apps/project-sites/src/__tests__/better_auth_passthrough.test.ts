/**
 * Regression guard (iter 81): the embedded Better Auth `/api/auth/*` middleware
 * (index.ts) intercepts every `/api/auth/*` path NOT in its `legacyPaths`
 * fall-through allowlist. The frontend's passwordless login uses the LEGACY
 * `POST /api/auth/magic-link` (request) + `GET /api/auth/magic-link/verify`
 * (emailed link). With the `better_auth` flag ON — it is globally enabled in
 * prod — omitting those from the allowlist makes the BA handler swallow them and
 * return its own 404 → the primary passwordless login is BROKEN. This asserts the
 * login endpoints (and the other legacy passthroughs) stay allowlisted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
// Isolate the legacyPaths array literal so we don't match unrelated occurrences.
const start = src.indexOf('const legacyPaths');
const end = src.indexOf('if (legacyPaths.includes', start);
const block = start >= 0 && end > start ? src.slice(start, end) : '';

describe('better_auth /api/auth/* passthrough allowlist (index.ts)', () => {
  it('found the legacyPaths allowlist block', () => {
    expect(block).not.toBe('');
  });

  // The two login endpoints the frontend actually calls — the iter-81 fix.
  const LOGIN_PATHS = ['/api/auth/magic-link', '/api/auth/magic-link/verify'];
  // The pre-existing passthroughs that must not regress either.
  const OTHER_LEGACY = [
    '/api/auth/magic-link/peek',
    '/api/auth/me',
    '/api/auth/google',
    '/api/auth/github',
    '/api/auth/list-sessions',
  ];

  for (const path of [...LOGIN_PATHS, ...OTHER_LEGACY]) {
    it(`falls through to legacy auth for ${path}`, () => {
      expect(block).toContain(`'${path}'`);
    });
  }
});
