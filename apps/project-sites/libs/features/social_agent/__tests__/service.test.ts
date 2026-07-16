import { generateProposals, scoreEngagement } from '../service.js';

const accounts = [
  { id: 'a1', platform: 'instagram' as const, handle: '@test', followers: 5000, avgEngagement: 3.5 },
  { id: 'a2', platform: 'facebook' as const, handle: '@test', followers: 8000, avgEngagement: 2.1 },
  { id: 'a3', platform: 'x' as const, handle: '@test', followers: 2000, avgEngagement: 1.8 },
];

describe('generateProposals', () => {
  test('generates requested number of proposals', () => {
    expect(generateProposals('Acme', 'Best quality', accounts, 5)).toHaveLength(5);
  });
  test('personalizes topic with business name', () => {
    const p = generateProposals("Bob's Cafe", 'Fresh coffee', accounts, 1);
    expect(p[0].topic).toContain("Bob's Cafe");
  });
  test('each proposal has required fields', () => {
    const p = generateProposals('Acme', 'Quality', accounts, 2);
    for (const prop of p) {
      expect(prop.caption).toBeTruthy();
      expect(prop.hashtags.length).toBeGreaterThan(0);
      expect(prop.bestPlatforms.length).toBeGreaterThan(0);
      expect(prop.suggestedTime).toBeTruthy();
      expect(prop.confidence).toBeGreaterThan(0.7);
      expect(prop.imagePrompt).toBeTruthy();
    }
  });
  test('confidence decreases for later proposals', () => {
    const p = generateProposals('Acme', 'Quality', accounts, 3);
    expect(p[0].confidence).toBeGreaterThan(p[1].confidence);
  });
});

describe('scoreEngagement', () => {
  test('computes engagement rate from metrics', () => {
    const s = scoreEngagement(accounts[0], { likes: 500, comments: 50, shares: 25, posts: 20 });
    expect(s.engagementRate).toBeGreaterThan(0);
    expect(s.platform).toBe('instagram');
  });
  test('high engagement → growing', () => {
    const s = scoreEngagement(accounts[0], { likes: 5000, comments: 500, shares: 200, posts: 15 });
    expect(s.trend).toBe('growing');
  });
  test('low engagement → declining', () => {
    const s = scoreEngagement(accounts[0], { likes: 50, comments: 2, shares: 1, posts: 20 });
    expect(s.trend).toBe('declining');
  });
  test('bestDay and bestTime are set', () => {
    const s = scoreEngagement(accounts[0], { likes: 100, comments: 10, shares: 5, posts: 10 });
    expect(s.bestDay).toBeTruthy();
    expect(s.bestTime).toBeTruthy();
  });
});
