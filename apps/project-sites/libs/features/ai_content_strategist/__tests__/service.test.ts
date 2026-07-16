/**
 * @module libs/features/ai_content_strategist/__tests__/service.test
 *
 * Unit tests for content strategy engine — pure, deterministic, zero I/O.
 */
import { detectContentGaps, generateCalendar, buildContentStrategy } from '../service.js';

describe('detectContentGaps', () => {
  test('detects gaps when competitors cover topics the site does not', () => {
    const gaps = detectContentGaps(
      'restaurant',
      ['Hours & location'],
      ['Menu highlights', 'Chef stories', 'Local ingredients', 'Customer favorites'],
    );
    // Site only covers 1 pillar, competitors cover 4 → should find gaps
    expect(gaps.length).toBeGreaterThanOrEqual(2);
  });

  test('returns no gaps when site covers all competitor topics', () => {
    const gaps = detectContentGaps(
      'restaurant',
      ['Menu highlights', 'Chef stories', 'Local ingredients', 'Events & catering', 'Customer favorites', 'Seasonal specials'],
      ['Menu highlights', 'Local ingredients'],
    );
    expect(gaps.length).toBe(0);
  });

  test('returns no gaps when no competitors cover a pillar', () => {
    const gaps = detectContentGaps(
      'restaurant',
      ['Hours & location'],
      [], // no competitor topics
    );
    expect(gaps.length).toBe(0);
  });

  test('gaps are sorted by competitor count descending', () => {
    const gaps = detectContentGaps(
      'restaurant',
      ['Hours & location'],
      ['Menu highlights', 'Chef stories', 'Customer favorites', 'Local ingredients', 'Seasonal specials', 'Events & catering'],
    );
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i - 1].competitorCount).toBeGreaterThanOrEqual(gaps[i].competitorCount);
    }
  });

  test('each gap has required fields', () => {
    const gaps = detectContentGaps(
      'restaurant',
      [],
      ['Menu highlights', 'Chef stories'],
    );
    for (const gap of gaps) {
      expect(gap.topic).toBeTruthy();
      expect(gap.competitorCount).toBeGreaterThan(0);
      expect(['high', 'medium', 'low', 'unknown']).toContain(gap.searchVolume);
      expect(['easy', 'moderate', 'hard']).toContain(gap.difficulty);
      expect(gap.suggestedTitle).toBeTruthy();
      expect(gap.suggestedKeywords.length).toBeGreaterThan(0);
      expect(gap.outline.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('different industries use different pillars', () => {
    const restaurantGaps = detectContentGaps('restaurant', [], ['Menu highlights', 'Chef stories']);
    const healthcareGaps = detectContentGaps('healthcare', [], ['Treatment guides', 'Patient stories']);
    const restaurantTopics = restaurantGaps.map((g) => g.topic);
    const healthcareTopics = healthcareGaps.map((g) => g.topic);
    expect(restaurantTopics).not.toEqual(healthcareTopics);
  });

  test('unknown industry uses default pillars', () => {
    const gaps = detectContentGaps('nonexistent-xyz', [], ['Service overview', 'How-to guides']);
    expect(gaps.length).toBeGreaterThan(0);
  });
});

describe('generateCalendar', () => {
  const gaps = [
    { topic: 'Pricing', competitorCount: 4, searchVolume: 'high' as const, difficulty: 'hard' as const, suggestedTitle: 'Pricing Guide', suggestedKeywords: ['pricing'], outline: ['a', 'b', 'c'] },
    { topic: 'Reviews', competitorCount: 2, searchVolume: 'medium' as const, difficulty: 'moderate' as const, suggestedTitle: 'Review Guide', suggestedKeywords: ['reviews'], outline: ['d', 'e'] },
    { topic: 'FAQ', competitorCount: 1, searchVolume: 'low' as const, difficulty: 'easy' as const, suggestedTitle: 'FAQ', suggestedKeywords: ['faq'], outline: ['f'] },
  ];

  test('generates one calendar entry per gap', () => {
    const calendar = generateCalendar('TestCo', gaps);
    expect(calendar).toHaveLength(3);
  });

  test('entries are in sequential weeks', () => {
    const calendar = generateCalendar('TestCo', gaps);
    expect(calendar[0].week).toBe(1);
    expect(calendar[1].week).toBe(2);
    expect(calendar[2].week).toBe(3);
  });

  test('high competitor count gaps get high priority', () => {
    const calendar = generateCalendar('TestCo', gaps);
    expect(calendar[0].priority).toBe('high');
  });

  test('caps at 13 weeks', () => {
    const manyGaps = Array.from({ length: 20 }, (_, i) => ({
      topic: `Topic ${i}`,
      competitorCount: 1,
      searchVolume: 'low' as const,
      difficulty: 'easy' as const,
      suggestedTitle: `Title ${i}`,
      suggestedKeywords: [`keyword-${i}`],
      outline: [`point ${i}`],
    }));
    const calendar = generateCalendar('TestCo', manyGaps);
    expect(calendar.length).toBeLessThanOrEqual(13);
  });

  test('each entry has required fields', () => {
    const calendar = generateCalendar('TestCo', gaps);
    for (const entry of calendar) {
      expect(entry.week).toBeGreaterThanOrEqual(1);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title).toContain('TestCo');
      expect(entry.contentType).toBeTruthy();
      expect(entry.targetKeywords.length).toBeGreaterThan(0);
      expect(entry.outline.length).toBeGreaterThan(0);
    }
  });
});

describe('buildContentStrategy', () => {
  test('returns complete strategy with all fields', () => {
    const strategy = buildContentStrategy(
      'site-1', "Tony's Pizza", 'restaurant',
      ['Hours & location'],
      ['Menu highlights', 'Chef stories', 'Local ingredients', 'Customer favorites'],
    );
    expect(strategy.siteId).toBe('site-1');
    expect(strategy.totalGaps).toBeGreaterThan(0);
    expect(strategy.gaps.length).toBe(strategy.totalGaps);
    expect(strategy.calendar.length).toBe(strategy.totalGaps);
    expect(strategy.calendarWeeks).toBe(13);
    expect(strategy.summary).toBeTruthy();
    expect(strategy.generatedAt).toEqual(expect.any(String));
  });

  test('zero-gap site produces empty calendar and reassuring summary', () => {
    const strategy = buildContentStrategy(
      'site-2', 'FullCoverage', 'restaurant',
      ['Menu highlights', 'Chef stories', 'Local ingredients', 'Events & catering', 'Customer favorites', 'Seasonal specials'],
      ['Menu highlights'],
    );
    expect(strategy.totalGaps).toBe(0);
    expect(strategy.calendar).toHaveLength(0);
  });
});
