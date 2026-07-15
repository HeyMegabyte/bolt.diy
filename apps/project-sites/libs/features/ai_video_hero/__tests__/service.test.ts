/**
 * @module libs/features/ai_video_hero/__tests__/service.test
 *
 * Unit tests for generateVideoScript — pure, deterministic, zero I/O.
 */
import { generateVideoScript } from '../service.js';

describe('generateVideoScript', () => {
  const siteId = 'site-123';
  const name = "Tony's Brick Oven Pizza";
  const desc = 'Authentic Neapolitan pizza in Brooklyn since 2010';
  const points = [
    'Wood-fired pizzas made with imported Italian ingredients',
    'Over 500,000 pizzas served since 2010',
    'Voted Best Pizza in Brooklyn 2024',
  ];

  test('returns a complete VideoScript with all required fields', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    expect(script.siteId).toBe(siteId);
    expect(script.title).toContain(name);
    expect(script.totalDurationSec).toBeGreaterThanOrEqual(55);
    expect(script.totalDurationSec).toBeLessThanOrEqual(65);
    expect(script.clips).toHaveLength(8);
    expect(script.voiceStyle).toBe('professional');
    expect(script.backgroundMusic).toBe('corporate');
    expect(script.estimatedCost).toContain('$');
    expect(script.generatedAt).toEqual(expect.any(String));
  });

  test('every clip has required fields', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    for (const clip of script.clips) {
      expect(clip.index).toBeGreaterThanOrEqual(1);
      expect(clip.index).toBeLessThanOrEqual(8);
      expect(clip.durationSec).toBeGreaterThanOrEqual(3);
      expect(clip.durationSec).toBeLessThanOrEqual(15);
      expect(clip.visualPrompt).toBeTruthy();
      expect(clip.visualPrompt.length).toBeGreaterThan(20);
      expect(clip.narration).toBeTruthy();
      expect(clip.narration.length).toBeGreaterThan(5);
      expect(['fade', 'dissolve', 'cut', 'wipe']).toContain(clip.transition);
      expect(clip.status).toBe('queued');
    }
  });

  test('clips are indexed 1-8 in order', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    const indices = script.clips.map((c) => c.index);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('personalizes visual prompts with business name', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    const nameClips = script.clips.filter((c) =>
      c.visualPrompt.includes(name),
    );
    expect(nameClips.length).toBeGreaterThanOrEqual(3);
  });

  test('personalizes narration with business name', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    const nameNarrations = script.clips.filter((c) =>
      c.narration.includes(name),
    );
    expect(nameNarrations.length).toBeGreaterThanOrEqual(2);
  });

  test('incorporates selling points into clips', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    // At least one clip should reference the first selling point
    const hasPoint = script.clips.some((c) =>
      c.visualPrompt.includes(points[0]) || c.narration.includes(points[0]),
    );
    expect(hasPoint).toBe(true);
  });

  test('uses colors when provided', () => {
    const script = generateVideoScript(siteId, name, desc, points, {
      colors: ['#ff6b35', '#004e89'],
    });
    const colorClip = script.clips.some((c) =>
      c.visualPrompt.includes('#ff6b35') || c.visualPrompt.includes('#004e89'),
    );
    expect(colorClip).toBe(true);
  });

  test('voice style affects background music selection', () => {
    const energetic = generateVideoScript(siteId, name, desc, points, { style: 'energetic' });
    expect(energetic.backgroundMusic).toBe('inspirational');

    const dramatic = generateVideoScript(siteId, name, desc, points, { style: 'dramatic' });
    expect(dramatic.backgroundMusic).toBe('cinematic');

    const warm = generateVideoScript(siteId, name, desc, points, { style: 'warm' });
    expect(warm.backgroundMusic).toBe('ambient');
  });

  test('cost estimate scales with duration', () => {
    const script = generateVideoScript(siteId, name, desc, points);
    // ~60 seconds × $0.05/sec = ~$3.00
    const costStr = script.estimatedCost;
    const costMatch = costStr.match(/\$(\d+\.\d+)/);
    expect(costMatch).toBeTruthy();
    const cost = parseFloat(costMatch![1]);
    expect(cost).toBeGreaterThan(2.0);
    expect(cost).toBeLessThan(5.0);
  });

  test('handles minimal input gracefully', () => {
    const script = generateVideoScript('site-min', 'Cafe', 'Good coffee', []);
    expect(script.clips).toHaveLength(8);
    expect(script.title).toContain('Cafe');
  });
});
