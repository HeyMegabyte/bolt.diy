/**
 * Pulse Social publishers — central registry.
 *
 * Maps `Platform` → `Publisher` and exposes a `getPublisher(platform)`
 * helper for the workflow + route layers.
 */
import { bluesky } from './bluesky.js';
import { discord } from './discord.js';
import { facebook } from './facebook.js';
import { google_business } from './google_business.js';
import { instagram } from './instagram.js';
import { linkedin } from './linkedin.js';
import { mastodon } from './mastodon.js';
import { nextdoor } from './nextdoor.js';
import { pinterest } from './pinterest.js';
import { reddit } from './reddit.js';
import { slack } from './slack.js';
import { telegram } from './telegram.js';
import { threads } from './threads.js';
import { tiktok } from './tiktok.js';
import { twitter } from './twitter.js';
import { youtube } from './youtube.js';
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
  tiktok,
  youtube,
  pinterest,
  google_business,
  nextdoor,
};

export function getPublisher(platform: Platform): Publisher {
  const p = REGISTRY[platform];
  if (!p) throw new Error(`unknown_platform:${platform}`);
  return p;
}

export { PLATFORMS } from './types.js';
export type {
  Platform,
  Publisher,
  SocialAccountCtx,
  PostCtx,
  PublishResult,
  AnalyticsSnapshot,
} from './types.js';
export { MissingAppCredsError } from './types.js';
