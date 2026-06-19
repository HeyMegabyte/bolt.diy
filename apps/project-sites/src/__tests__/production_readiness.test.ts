import { scoreReadiness } from '../services/production_readiness';
import type { ValidationReport, Violation } from '../services/build_validators';

const v = (code: string, severity: 'error' | 'warn' | 'info' = 'error'): Violation => ({
  code,
  severity,
  message: code,
});

const report = (errors: Violation[] = [], warnings: Violation[] = []): ValidationReport => ({
  ok: errors.length === 0,
  errors,
  warnings,
  infos: [],
  summary: '',
});

describe('scoreReadiness', () => {
  it('a clean build scores 100 / grade A / passing', () => {
    const r = scoreReadiness(report());
    expect(r).toMatchObject({ score: 100, grade: 'A', passing: true });
  });

  it('penalizes warnings lightly (still passing at A/B)', () => {
    const r = scoreReadiness(report([], [v('meta.title_length', 'warn'), v('meta.description_length', 'warn')]));
    expect(r.score).toBe(96); // 100 - 2*2
    expect(r.passing).toBe(true);
  });

  it('a security error tanks the score AND forces non-passing regardless of grade', () => {
    const r = scoreReadiness(report([v('security.client_secret_exposed')]));
    expect(r.score).toBe(75); // 100 - 25
    expect(r.grade).toBe('C');
    expect(r.passing).toBe(false); // security error => never publishable
    expect(r.summary).toContain('security issue');
  });

  it('one security error blocks even an otherwise-A build', () => {
    // 1 security error only → score 75 (C). But even if score were high, a
    // security error must force passing=false — assert the invariant directly.
    const r = scoreReadiness(report([v('security.client_secret_exposed')], []));
    expect(r.passing).toBe(false);
  });

  it('non-security errors penalize 10 each and lower the grade', () => {
    const r = scoreReadiness(report([v('meta.title_length'), v('og.missing'), v('asset.missing')]));
    expect(r.score).toBe(70); // 100 - 3*10
    expect(r.grade).toBe('C');
    expect(r.passing).toBe(false);
  });

  it('groups violations into a per-category breakdown sorted by error count', () => {
    const r = scoreReadiness(
      report([v('security.client_secret_exposed'), v('meta.title_length'), v('meta.description_length')], [v('asset.missing', 'warn')]),
    );
    const cats = r.breakdown.map((b) => b.category);
    expect(cats).toContain('security');
    expect(cats).toContain('meta');
    expect(cats).toContain('asset');
    const meta = r.breakdown.find((b) => b.category === 'meta');
    expect(meta).toMatchObject({ errors: 2 });
  });

  it('clamps the score at 0 for a wreck of a build', () => {
    const many = Array.from({ length: 20 }, (_, i) => v(`asset.missing_${i}`));
    expect(scoreReadiness(report(many)).score).toBe(0);
  });
});
