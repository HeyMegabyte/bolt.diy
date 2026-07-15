/**
 * AI Social Media Agent (#45, ROI 2.03) — pure content proposal engine +
 * engagement scoring. Zero I/O, deterministic.
 */
export type Platform = 'facebook' | 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'google_business' | 'pinterest' | 'threads' | 'bluesky' | 'youtube';

export interface SocialAccount { id: string; platform: Platform; handle: string; followers: number; avgEngagement: number; }

export interface ContentProposal {
  id: string; topic: string; contentType: 'post' | 'story' | 'reel' | 'carousel' | 'article';
  caption: string; hashtags: string[]; bestPlatforms: Platform[];
  suggestedTime: string; confidence: number; imagePrompt: string;
}

export interface EngagementScore {
  accountId: string; platform: Platform; postsLast30d: number;
  totalLikes: number; totalComments: number; totalShares: number;
  engagementRate: number; trend: 'growing' | 'stable' | 'declining';
  bestDay: string; bestTime: string;
}

const PLATFORM_LIMITS: Record<Platform, { maxChars: number; maxHashtags: number; bestDays: string[]; bestTimes: string[] }> = {
  facebook: { maxChars: 63206, maxHashtags: 3, bestDays: ['Thu', 'Fri', 'Sat'], bestTimes: ['13:00', '15:00'] },
  instagram: { maxChars: 2200, maxHashtags: 30, bestDays: ['Tue', 'Thu', 'Sat'], bestTimes: ['10:00', '14:00', '19:00'] },
  x: { maxChars: 280, maxHashtags: 2, bestDays: ['Mon', 'Tue', 'Wed'], bestTimes: ['09:00', '12:00', '17:00'] },
  linkedin: { maxChars: 3000, maxHashtags: 5, bestDays: ['Tue', 'Wed', 'Thu'], bestTimes: ['08:00', '12:00', '17:00'] },
  tiktok: { maxChars: 2200, maxHashtags: 5, bestDays: ['Tue', 'Thu', 'Fri'], bestTimes: ['19:00', '21:00'] },
  google_business: { maxChars: 1500, maxHashtags: 0, bestDays: ['Mon', 'Tue', 'Wed'], bestTimes: ['09:00', '16:00'] },
  pinterest: { maxChars: 500, maxHashtags: 0, bestDays: ['Fri', 'Sat', 'Sun'], bestTimes: ['20:00', '21:00'] },
  threads: { maxChars: 500, maxHashtags: 5, bestDays: ['Mon', 'Tue', 'Wed'], bestTimes: ['10:00', '18:00'] },
  bluesky: { maxChars: 300, maxHashtags: 3, bestDays: ['Mon', 'Tue', 'Wed'], bestTimes: ['09:00', '17:00'] },
  youtube: { maxChars: 5000, maxHashtags: 3, bestDays: ['Thu', 'Fri', 'Sat'], bestTimes: ['12:00', '17:00'] },
};

const TOPIC_TEMPLATES = [
  'Behind the scenes at {business}',
  'Customer spotlight: {business} made their day',
  'New at {business}: what we are excited about',
  'Quick tip from {business}: {tip}',
  'Why customers choose {business}',
  'Meet the team at {business}',
  'A day in the life at {business}',
  '{business} community update',
  'Seasonal special at {business}',
  'Did you know? {business} fun fact',
];

/**
 * Generates content proposals for a business across platforms.
 */
export function generateProposals(business: string, sellingPoint: string, accounts: SocialAccount[], count = 5): ContentProposal[] {
  const proposals: ContentProposal[] = [];
  for (let i = 0; i < count; i++) {
    const template = TOPIC_TEMPLATES[i % TOPIC_TEMPLATES.length];
    const topic = template.replace('{business}', business).replace('{tip}', sellingPoint);
    const bestPlatforms = accounts.slice(0, 3).map((a) => a.platform);
    const primary = bestPlatforms[0] || 'facebook';
    const limits = PLATFORM_LIMITS[primary];
    proposals.push({
      id: `prop_${i}`, topic, contentType: i === 0 ? 'post' : i === 1 ? 'story' : i === 2 ? 'carousel' : 'post',
      caption: `✨ ${topic}\n\n${sellingPoint}. Visit us today!\n\n${generateHashtags(business, primary).join(' ')}`,
      hashtags: generateHashtags(business, primary),
      bestPlatforms, suggestedTime: `${limits.bestDays[0]} at ${limits.bestTimes[0]}`,
      confidence: 0.85 - i * 0.05, imagePrompt: `${business} ${topic}, professional lighting, ${primary} ready`,
    });
  }
  return proposals;
}

function generateHashtags(business: string, platform: Platform): string[] {
  const tags = [`#${business.replace(/\s+/g, '')}`, '#SmallBusiness', '#ShopLocal'];
  const max = PLATFORM_LIMITS[platform].maxHashtags;
  if (platform === 'instagram') tags.push('#InstaDaily', '#BusinessTips', '#LocalBiz');
  if (platform === 'linkedin') tags.push('#BusinessGrowth', '#Entrepreneurship');
  return tags.slice(0, max);
}

/**
 * Computes engagement score for a social account from raw metrics.
 */
export function scoreEngagement(account: SocialAccount, metrics: { likes: number; comments: number; shares: number; posts: number }): EngagementScore {
  const total = metrics.likes + metrics.comments + metrics.shares;
  const rate = metrics.posts > 0 ? total / metrics.posts / account.followers : 0;
  return {
    accountId: account.id, platform: account.platform,
    postsLast30d: metrics.posts, totalLikes: metrics.likes,
    totalComments: metrics.comments, totalShares: metrics.shares,
    engagementRate: Math.round(rate * 10000) / 100,
    trend: rate > 0.05 ? 'growing' : rate > 0.02 ? 'stable' : 'declining',
    bestDay: PLATFORM_LIMITS[account.platform].bestDays[0],
    bestTime: PLATFORM_LIMITS[account.platform].bestTimes[1] || PLATFORM_LIMITS[account.platform].bestTimes[0],
  };
}
