/**
 * Unit tests for the site_doctor feature module.
 *
 * The scoring + lock core is pure (no env, no I/O), so these exercise it
 * directly. Covers: scoring, grade boundaries, severity ordering, the
 * free/paid lock, the all-pass state, schema validity, and FLAG_KEY.
 */

import { describe, it, expect } from '@jest/globals';

type Sig = { name: string; pass: boolean; weight: number };

/** The 4 readiness signals, all failing — worst case. */
const ALL_FAIL: Sig[] = [
  { name: 'published', pass: false, weight: 25 },
  { name: 'custom_domain', pass: false, weight: 25 },
  { name: 'performance', pass: false, weight: 25 },
  { name: 'sitemap', pass: false, weight: 25 },
];

describe('site_doctor/service — scoreToGrade', () => {
  it('maps boundaries A/B/C/D/F', async () => {
    const { scoreToGrade } = await import('../service.js');
    expect(scoreToGrade(100)).toBe('A');
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(80)).toBe('B');
    expect(scoreToGrade(70)).toBe('C');
    expect(scoreToGrade(60)).toBe('D');
    expect(scoreToGrade(59)).toBe('F');
    expect(scoreToGrade(0)).toBe('F');
  });
});

describe('site_doctor/service — buildSiteDoctorReport scoring', () => {
  it('all signals failing → score 0, grade F', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const r = buildSiteDoctorReport(ALL_FAIL, 'pro');
    expect(r.score).toBe(0);
    expect(r.grade).toBe('F');
    expect(r.issues).toHaveLength(4);
  });

  it('all signals passing → score 100, grade A, no issues', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const passing = ALL_FAIL.map((s) => ({ ...s, pass: true }));
    const r = buildSiteDoctorReport(passing, 'free');
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.issues).toHaveLength(0);
    expect(r.locked_count).toBe(0);
    expect(r.summary).toContain('passes every check');
  });

  it('empty signals → score 100 (nothing to fail)', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    expect(buildSiteDoctorReport([], 'free').score).toBe(100);
  });

  it('half the weight passing → score 50, grade F', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const half: Sig[] = [
      { name: 'published', pass: true, weight: 25 },
      { name: 'custom_domain', pass: true, weight: 25 },
      { name: 'performance', pass: false, weight: 25 },
      { name: 'sitemap', pass: false, weight: 25 },
    ];
    const r = buildSiteDoctorReport(half, 'pro');
    expect(r.score).toBe(50);
    expect(r.issues).toHaveLength(2);
  });
});

describe('site_doctor/service — severity ordering', () => {
  it('orders issues critical → high → medium', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const r = buildSiteDoctorReport(ALL_FAIL, 'pro');
    // published=critical, custom_domain/performance=high, sitemap=medium
    expect(r.issues[0].id).toBe('published');
    expect(r.issues[0].severity).toBe('critical');
    expect(r.issues[r.issues.length - 1].id).toBe('sitemap');
    expect(r.issues[r.issues.length - 1].severity).toBe('medium');
  });
});

describe('site_doctor/service — free/paid lock', () => {
  it('free plan unlocks only the top issue; rest locked', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const r = buildSiteDoctorReport(ALL_FAIL, 'free');
    expect(r.issues[0].locked).toBe(false);
    expect(r.issues.slice(1).every((i) => i.locked)).toBe(true);
    expect(r.locked_count).toBe(3);
  });

  it('paid plans unlock every issue', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    for (const plan of ['starter', 'pro'] as const) {
      const r = buildSiteDoctorReport(ALL_FAIL, plan);
      expect(r.issues.every((i) => !i.locked)).toBe(true);
      expect(r.locked_count).toBe(0);
    }
  });

  it('free plan with a single issue locks nothing', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const one: Sig[] = [
      { name: 'published', pass: true, weight: 25 },
      { name: 'custom_domain', pass: true, weight: 25 },
      { name: 'performance', pass: true, weight: 25 },
      { name: 'sitemap', pass: false, weight: 25 },
    ];
    const r = buildSiteDoctorReport(one, 'free');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].locked).toBe(false);
    expect(r.locked_count).toBe(0);
  });
});

describe('site_doctor/service — schema validity', () => {
  it('every produced report is schema-valid', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const { SiteDoctorReportSchema } = await import('../schemas.js');
    for (const plan of ['free', 'starter', 'pro'] as const) {
      expect(SiteDoctorReportSchema.safeParse(buildSiteDoctorReport(ALL_FAIL, plan)).success).toBe(
        true,
      );
    }
  });

  it('an unknown signal name falls back to a low-severity issue', async () => {
    const { buildSiteDoctorReport } = await import('../service.js');
    const r = buildSiteDoctorReport([{ name: 'mystery', pass: false, weight: 10 }], 'pro');
    expect(r.issues[0].severity).toBe('low');
    expect(r.issues[0].id).toBe('mystery');
  });
});

describe('site_doctor/service — FLAG_KEY', () => {
  it('FLAG_KEY equals the module slug', async () => {
    const { FLAG_KEY } = await import('../service.js');
    expect(FLAG_KEY).toBe('site_doctor');
  });
});
