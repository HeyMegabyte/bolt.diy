import { campaignDurationMinutes, createCampaign, postPublishTime, scheduledTimeline, validateCampaign } from '../campaign_bundle';

const START_MS = 1719705600000;

function makePosts() {
  return [
    { postId: 'p1', platform: 'twitter', content: 'Tweet 1', offsetMinutes: 0 },
    { postId: 'p2', platform: 'linkedin', content: 'LinkedIn post', offsetMinutes: 30 },
    { postId: 'p3', platform: 'twitter', content: 'Tweet 2', offsetMinutes: 60 },
  ];
}

describe('createCampaign', () => {
  it('creates a draft campaign with sorted posts', () => {
    const posts = makePosts().reverse(); // unsorted
    const c = createCampaign('camp-1', 'Launch Week', START_MS, posts);
    expect(c.campaignId).toBe('camp-1');
    expect(c.status).toBe('draft');
    expect(c.posts[0].offsetMinutes).toBe(0);
    expect(c.posts[1].offsetMinutes).toBe(30);
    expect(c.posts[2].offsetMinutes).toBe(60);
  });

  it('accepts tags', () => {
    const c = createCampaign('c1', 'Test', START_MS, makePosts(), { tags: ['launch', 'q3'] });
    expect(c.tags).toEqual(['launch', 'q3']);
  });
});

describe('postPublishTime', () => {
  it('computes absolute publish time', () => {
    const c = createCampaign('c1', 'Test', START_MS, makePosts());
    expect(postPublishTime(c, c.posts[1])).toBe(START_MS + 30 * 60_000);
  });
});

describe('scheduledTimeline', () => {
  it('returns posts sorted by publish time', () => {
    const c = createCampaign('c1', 'Test', START_MS, makePosts());
    const timeline = scheduledTimeline(c);
    expect(timeline).toHaveLength(3);
    expect(timeline[0].atMs).toBe(START_MS);
    expect(timeline[2].atMs).toBe(START_MS + 60 * 60_000);
  });
});

describe('campaignDurationMinutes', () => {
  it('returns 0 for single-post campaign', () => {
    const c = createCampaign('c1', 'Test', START_MS, [{ postId: 'p1', platform: 'twitter', content: 'Hi', offsetMinutes: 0 }]);
    expect(campaignDurationMinutes(c)).toBe(0);
  });

  it('returns spread between first and last post', () => {
    const c = createCampaign('c1', 'Test', START_MS, makePosts());
    expect(campaignDurationMinutes(c)).toBe(60);
  });
});

describe('validateCampaign', () => {
  it('returns empty for a valid campaign', () => {
    const c = createCampaign('c1', 'Test', START_MS, makePosts());
    expect(validateCampaign(c)).toEqual([]);
  });

  it('warns on duplicate platform at same offset', () => {
    const c = createCampaign('c1', 'Test', START_MS, [
      { postId: 'p1', platform: 'twitter', content: 'A', offsetMinutes: 0 },
      { postId: 'p2', platform: 'twitter', content: 'B', offsetMinutes: 0 },
    ]);
    const warnings = validateCampaign(c);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Duplicate');
  });

  it('warns on posts too close together', () => {
    const c = createCampaign('c1', 'Test', START_MS, [
      { postId: 'p1', platform: 'twitter', content: 'A', offsetMinutes: 0 },
      { postId: 'p2', platform: 'twitter', content: 'B', offsetMinutes: 2 },
    ]);
    const warnings = validateCampaign(c);
    expect(warnings.some((w) => w.includes('<5 min apart'))).toBe(true);
  });
});
