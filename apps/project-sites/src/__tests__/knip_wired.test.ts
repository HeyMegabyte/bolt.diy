/**
 * Guards that knip (dead-code / unused-export detector) is wired as a runnable
 * script + a report-only CI surface.
 *
 * knip.json existed but no `knip` npm script and no CI workflow ran it, so dead
 * exports accumulated invisibly (~13 unused functions + 7 types at audit time).
 * This gate keeps the Detect→Surface rung in place: the script must exist, and
 * the report-only workflow must be present (non-blocking — it surfaces the count
 * without failing CI on the known backlog; the sweep is a separate session).
 *
 * Ledger: 50-improvement audit (2026-06-19) item #15.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('knip wiring (audit #15)', () => {
  const root = join(__dirname, '..', '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it('exposes a `knip` npm script', () => {
    expect(pkg.scripts?.knip).toBeDefined();
    expect(pkg.scripts?.knip).toMatch(/knip/);
  });

  it('exposes a non-blocking `knip:report` script', () => {
    expect(pkg.scripts?.['knip:report']).toMatch(/knip/);
    // Report-only: must not fail the caller on findings.
    expect(pkg.scripts?.['knip:report']).toMatch(/\|\|\s*true/);
  });

  it('ships a report-only knip CI workflow', () => {
    const wf = join(root, '..', '..', '.github', 'workflows', 'knip-report.yml');
    expect(existsSync(wf)).toBe(true);
    const body = readFileSync(wf, 'utf8');
    // Non-blocking gate — never breaks the build on the known dead-export backlog.
    expect(body).toMatch(/continue-on-error:\s*true|knip:report/);
  });
});
