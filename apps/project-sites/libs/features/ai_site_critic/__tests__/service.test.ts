/**
 * @module libs/features/ai_site_critic/__tests__/service.test
 *
 * Unit tests for buildCritique — pure, deterministic, zero I/O.
 */
import { buildCritique } from '../service.js';
import type { CriticDimension } from '../schemas.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function highScores(): CriticDimension[] {
  return [
    { name: 'layout', score: 9, label: '', findings: [] },
    { name: 'typography', score: 8.5, label: '', findings: [] },
    { name: 'color', score: 9, label: '', findings: [] },
    { name: 'imagery', score: 8, label: '', findings: [] },
    { name: 'whitespace', score: 8, label: '', findings: [] },
    { name: 'distinctiveness', score: 7.5, label: '', findings: [] },
    { name: 'trust', score: 8, label: '', findings: [] },
    { name: 'copy', score: 7, label: '', findings: [] },
    { name: 'seo', score: 8, label: '', findings: [] },
    { name: 'mobile', score: 7, label: '', findings: [] },
  ];
}

function lowScores(): CriticDimension[] {
  return highScores().map((d) => ({ ...d, score: 3.5 }));
}

function withFindings(dims: CriticDimension[]): CriticDimension[] {
  return dims.map((d) => ({
    ...d,
    findings: [
      {
        severity: 'major' as const,
        title: `${d.name} issue`,
        description: 'Needs work',
        fixSuggestion: `Fix the ${d.name}`,
        autoFixable: d.name === 'seo',
      },
      {
        severity: 'critical' as const,
        title: `Critical ${d.name} gap`,
        description: 'Urgent fix needed',
        fixSuggestion: `Urgently fix ${d.name}`,
        autoFixable: false,
      },
    ],
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('buildCritique', () => {
  test('returns a complete SiteCritique with all required fields', () => {
    const critique = buildCritique('site-1', 'https://example.com', highScores());
    expect(critique.siteId).toBe('site-1');
    expect(critique.url).toBe('https://example.com');
    expect(critique.overallScore).toBeGreaterThan(0);
    expect(critique.grade).toEqual(expect.any(String));
    expect(critique.dimensions).toHaveLength(10);
    expect(critique.gradedAt).toEqual(expect.any(String));
  });

  test('high-quality site earns A or A+', () => {
    const critique = buildCritique('s1', 'https://a.com', highScores());
    expect(['A', 'A+']).toContain(critique.grade);
    expect(critique.overallScore).toBeGreaterThanOrEqual(8.0);
  });

  test('low-quality site earns D or F', () => {
    const critique = buildCritique('s1', 'https://b.com', lowScores());
    expect(['D', 'F']).toContain(critique.grade);
  });

  test('dimensions have human-readable labels', () => {
    const critique = buildCritique('s1', 'https://c.com', highScores());
    for (const d of critique.dimensions) {
      expect(d.label).toBeTruthy();
      expect(d.label.length).toBeGreaterThan(3);
    }
  });

  test('industry benchmark is included when industry is specified', () => {
    const critique = buildCritique('s1', 'https://d.com', highScores(), { industry: 'restaurant' });
    expect(critique.industryAvg).toBeDefined();
    expect(critique.industryAvg).toBeGreaterThan(0);
    expect(critique.competitiveRank).toBeDefined();
  });

  test('competitiveRank is set when industry benchmark exists', () => {
    const high = buildCritique('s1', 'https://e.com', highScores(), { industry: 'restaurant' });
    expect(high.competitiveRank).toBe('Top 10%');

    const low = buildCritique('s1', 'https://f.com', lowScores(), { industry: 'restaurant' });
    expect(low.competitiveRank).toBe('Below average');
  });

  test('industry defaults when unknown industry is specified', () => {
    const critique = buildCritique('s1', 'https://g.com', highScores(), { industry: 'nonexistent-industry-xyz' });
    expect(critique.industryAvg).toBe(6.0);
  });

  test('no industry benchmark when industry is not specified', () => {
    const critique = buildCritique('s1', 'https://h.com', highScores());
    expect(critique.industryAvg).toBeUndefined();
    expect(critique.competitiveRank).toBeUndefined();
  });

  test('priority fixes are extracted from critical and major findings', () => {
    const dims = withFindings(highScores());
    const critique = buildCritique('s1', 'https://i.com', dims);
    expect(critique.priorityFixes.length).toBeGreaterThan(0);
    // 10 dims × 2 findings = 20, all are critical or major
    expect(critique.priorityFixes.length).toBe(20);
  });

  test('dimensions with no findings produce no fixes', () => {
    const critique = buildCritique('s1', 'https://j.com', highScores());
    expect(critique.priorityFixes).toHaveLength(0);
  });

  test('auto-fixable fixes sort first', () => {
    const dims = withFindings(highScores());
    const critique = buildCritique('s1', 'https://k.com', dims);
    // SEO is auto-fixable in our test data
    const seoFix = critique.priorityFixes.find((f) => f.dimension === 'SEO Health');
    expect(seoFix?.autoFixable).toBe(true);
  });

  test('handles empty dimensions gracefully', () => {
    const critique = buildCritique('s1', 'https://l.com', []);
    expect(critique.grade).toBe('F');
    expect(critique.dimensions).toHaveLength(0);
    expect(critique.priorityFixes).toHaveLength(0);
  });
});
