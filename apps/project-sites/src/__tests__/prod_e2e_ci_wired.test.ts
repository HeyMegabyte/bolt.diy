/**
 * Guards that the prod Playwright suite (`test:e2e:prod`) is wired into CI,
 * gated on the E2E_API_KEY secret (fail-open when the secret is absent so forks
 * / secret-less runs don't break — per conditional-ci-gates).
 *
 * playwright.prod.config.ts + the `test:e2e:prod` script existed but nothing in
 * CI ran the real-login-against-prod suite, so admin regressions could ship
 * unverified. This closes #50's deferred half.
 *
 * Ledger: 50-improvement audit (2026-06-19) item #50 (prod-E2E-in-CI half).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('prod-E2E CI wiring (audit #50)', () => {
  const wf = join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'prod-e2e.yml');

  it('ships a prod-e2e workflow', () => {
    expect(existsSync(wf)).toBe(true);
  });

  it('runs the test:e2e:prod script', () => {
    expect(readFileSync(wf, 'utf8')).toMatch(/test:e2e:prod/);
  });

  it('is gated on the E2E_API_KEY secret (fail-open)', () => {
    const body = readFileSync(wf, 'utf8');
    expect(body).toMatch(/E2E_API_KEY/);
    // A presence gate so the run skips (not fails) when the secret is unset.
    expect(body).toMatch(/has_key|secrets\.E2E_API_KEY|continue-on-error/);
  });
});
