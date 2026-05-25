/**
 * Pulse Social publishers — central registry.
 *
 * Maps `Platform` → `Publisher` and exposes a `getPublisher(platform)`
 * helper for the workflow + route layers.
 */
import { bluesky } from './bluesky.js';
import { discord } from './discord.js';
import { facebook } from './facebook.js';
import { instagram } from './instagram.js';
import { linkedin } from './linkedin.js';
import { mastodon } from './mastodon.js';
import { reddit } from './reddit.js';
import { slack } from './slack.js';
import { telegram } from './telegram.js';
import { threads } from './threads.js';
import { twitter } from './twitter.js';
import type { Platform, Publisher } from './types.js';

const REGISTRY: Record<Platform, Publisher> = {
  twitter,
  linkedin,
  facebook,
  instagram,
  threads,
  bluesky,
  reddit,
  mastodon,
  discord,
  slack,
  telegram,
};

export function getPublisher(platform: Platform): Publisher {
  const p = REGISTRY[platform];
  if (!p) throw new Error(`unknown_platform:${platform}`);
  return p;
}

export { PLATFORMS } from './types.js';
export type { Platform, Publisher, SocialAccountCtx, PostCtx, PublishResult, AnalyticsSnapshot } from './types.js';
export { MissingAppCredsError } from './types.js';
