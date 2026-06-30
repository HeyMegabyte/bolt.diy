/**
 * @module services/campaign_bundle
 * @description LOOP-SOCIAL-016 core — campaign bundle primitive for multi-post,
 * multi-day grouped campaigns. Pure functions that build, validate, and schedule
 * campaign bundles. Zero I/O.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Campaign status ────────────────────────────────────────────────────────

export const CampaignStatus = z.enum(['draft', 'scheduled', 'active', 'paused', 'completed', 'failed']);
export type CampaignStatus = z.infer<typeof CampaignStatus>;

// ── Post within a campaign ─────────────────────────────────────────────────

export const CampaignPostSchema = z.object({
  /** Unique post ID within the campaign. */
  postId: z.string().min(1),
  /** Platform target (e.g. 'twitter', 'linkedin', 'facebook'). */
  platform: z.string().min(1).max(32),
  /** Post content (plain text or rich text). */
  content: z.string().min(1).max(5000),
  /** Scheduled publish offset in minutes from campaign start. */
  offsetMinutes: z.number().int().nonnegative(),
  /** Optional image/media URL. */
  mediaUrl: z.string().url().optional(),
  /** Optional link URL. */
  linkUrl: z.string().url().optional(),
});
export type CampaignPost = z.infer<typeof CampaignPostSchema>;

// ── Campaign bundle ────────────────────────────────────────────────────────

export const CampaignBundleSchema = z.object({
  /** Unique campaign ID. */
  campaignId: z.string().min(1).max(64),
  /** Campaign name for the admin surface. */
  name: z.string().min(1).max(200),
  /** Campaign status. */
  status: CampaignStatus,
  /** Campaign start time as Unix ms. */
  startAtMs: z.number().int().positive(),
  /** Posts in this campaign, ordered by offsetMinutes. */
  posts: z.array(CampaignPostSchema).min(1).max(100),
  /** Optional tags for organization. */
  tags: z.array(z.string().max(32)).max(10).default([]),
});
export type CampaignBundle = z.infer<typeof CampaignBundleSchema>;

// ── Builders ───────────────────────────────────────────────────────────────

/** Options for building a campaign bundle. */
export interface CampaignBundleOptions {
  tags?: string[];
}

/**
 * Creates a new campaign bundle in draft status. Pure — caller provides
 * `campaignId` and `startAtMs` for determinism.
 *
 * Posts are auto-sorted by `offsetMinutes` ascending.
 */
export function createCampaign(
  campaignId: string,
  name: string,
  startAtMs: number,
  posts: CampaignPost[],
  opts: CampaignBundleOptions = {},
): CampaignBundle {
  return CampaignBundleSchema.parse({
    campaignId,
    name,
    status: 'draft',
    startAtMs,
    posts: [...posts].sort((a, b) => a.offsetMinutes - b.offsetMinutes),
    tags: opts.tags ?? [],
  });
}

/**
 * Returns the absolute publish time (Unix ms) for a campaign post.
 * Pure computation from campaign start + post offset.
 */
export function postPublishTime(campaign: CampaignBundle, post: CampaignPost): number {
  return campaign.startAtMs + post.offsetMinutes * 60_000;
}

/**
 * Returns all posts in a campaign sorted by their scheduled publish time.
 */
export function scheduledTimeline(campaign: CampaignBundle): Array<{ post: CampaignPost; atMs: number }> {
  return campaign.posts.map((p) => ({ post: p, atMs: postPublishTime(campaign, p) }));
}

/**
 * Returns the campaign duration in minutes (first post to last post).
 */
export function campaignDurationMinutes(campaign: CampaignBundle): number {
  if (campaign.posts.length <= 1) return 0;
  const offsets = campaign.posts.map((p) => p.offsetMinutes);
  return Math.max(...offsets) - Math.min(...offsets);
}

/**
 * Validates a campaign bundle for common issues. Returns an array of
 * human-readable warnings (empty = valid).
 */
export function validateCampaign(campaign: CampaignBundle): string[] {
  const warnings: string[] = [];

  // Duplicate platforms at the same time
  const seen = new Map<string, number>();
  for (const p of campaign.posts) {
    const key = `${p.platform}:${p.offsetMinutes}`;
    if (seen.has(key)) {
      warnings.push(`Duplicate platform "${p.platform}" at offset ${p.offsetMinutes}m`);
    }
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  // Posts too close together (< 5 min apart on same platform)
  const byPlatform = new Map<string, number[]>();
  for (const p of campaign.posts) {
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p.offsetMinutes);
    byPlatform.set(p.platform, list);
  }
  for (const [platform, offsets] of byPlatform) {
    offsets.sort((a, b) => a - b);
    for (let i = 1; i < offsets.length; i++) {
      if (offsets[i] - offsets[i - 1] < 5) {
        warnings.push(`Posts on "${platform}" at ${offsets[i - 1]}m and ${offsets[i]}m are <5 min apart`);
      }
    }
  }

  return warnings;
}
