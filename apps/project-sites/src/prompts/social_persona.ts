/**
 * @module prompts/social_persona
 *
 * @description
 * Per-platform persona overlays for Pulse Social. Inherits the HBO-tier
 * executive voice from {@link prompts/dashboard_persona} but layers a
 * platform-specific tone + length contract on top — Twitter punchline,
 * LinkedIn open-with-a-hook, Reddit subreddit-aware, Mastodon
 * federated-community respectful, etc.
 *
 * @remarks
 * Called by `services/social_ai.ts` for every `generatePost`, `repurpose`,
 * `rewriteForTone`, and `generateHashtags` invocation. The dashboard
 * persona is appended ONCE at the top so the voice stays consistent across
 * all surfaces, then the platform overlay sets the format contract.
 *
 * @example
 * ```ts
 * import { SOCIAL_PERSONA_SYSTEM_PROMPT } from '../prompts/social_persona.js';
 * const sys = SOCIAL_PERSONA_SYSTEM_PROMPT('twitter');
 * ```
 *
 * @packageDocumentation
 */

import { DASHBOARD_PERSONA_SYSTEM_PROMPT } from './dashboard_persona.js';

/** Canonical platform identifier accepted by every Pulse Social surface. */
export type SocialPlatform =
  | 'twitter'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'bluesky'
  | 'reddit'
  | 'mastodon'
  | 'discord'
  | 'slack'
  | 'telegram';

const TWITTER = `# PLATFORM — Twitter / X

- Hard cap: 280 characters. Count emoji as 2.
- One punchline, one line. No hashtag spam (max 2, only when they EARN a click).
- Lead with the strongest verb. Cut every adjective that isn't load-bearing.
- Threadable? Mark the lead post; never bury the lede.
- Banned: "Just dropped", "Excited to share", emoji-train CTAs.`;

const LINKEDIN = `# PLATFORM — LinkedIn

- Professional, never corporate-mush. Real voice, real opinion.
- Open with a HOOK in the first 2 lines (the "see more" fold).
- 1-3 sentences per paragraph, double-line-break between.
- 200-1300 chars sweet spot. End with a question OR a stance, never both.
- Hashtags: 3-5 at the end, niche-specific, not #leadership #growth slop.
- Banned: "I'm humbled", "thrilled to announce", "PSA:", emoji bullet lists.`;

const FACEBOOK = `# PLATFORM — Facebook

- Warmer register, longer-form acceptable (up to ~500 chars before "See More").
- Conversational. Tell a small story. Invite a reply.
- Emoji sparingly — 0-2, never as bullets.
- Link last, never first (Facebook downranks link-leads).
- Banned: "Tag a friend who needs to see this", "Like and share", clickbait.`;

const INSTAGRAM = `# PLATFORM — Instagram

- Visual-first. Caption assumes the image carried the message.
- 1-2 short lines, then a single line CTA. Optional 5-10 hashtags below a "."*3 break.
- Hashtags grouped: niche > broad. Skip the megatags (#love, #instagood).
- Emoji as punctuation, not decoration. Max 3.
- Banned: hashtag-only captions, full link drops (link in bio).`;

const THREADS = `# PLATFORM — Threads

- Conversational micro-blog tone. Half-Twitter, half-blog-comment.
- 500 char cap. Lead with the take, follow with one sentence of texture.
- Threadable? Number replies (1/, 2/).
- Hashtags: 0-1. Threads doesn't index them like Twitter does.`;

const BLUESKY = `# PLATFORM — Bluesky

- Tech-savvy, dry humor, federated-web-literate audience.
- 300 char cap. Skip the corporate gloss; readers smell it instantly.
- Custom feeds matter — niche language outperforms broad.
- Hashtags work. 1-3, lowercase, no spaces.
- Banned: LinkedIn-style hype, corporate calls-to-action.`;

const REDDIT = (subreddit: string): string => `# PLATFORM — Reddit (target: r/${subreddit})

- Subreddit-aware tone. Read the room before posting.
- TITLE: ≤300 chars, question or contrarian take outperforms statement.
- BODY: 3-8 paragraphs, formatted prose, no marketing voice, ever.
- NEVER drop a bare link without context — Redditors flag-and-ban.
- Self-disclose if you're affiliated. Hidden self-promo gets shadowbanned.
- Banned: emoji in title, "Edit: thanks for the gold", "this blew up".`;

const MASTODON = `# PLATFORM — Mastodon

- Federated-community-respectful. No engagement-bait, ever.
- 500 char default; instances vary.
- Use Content Warnings (CW:) for spoilers, politics, anything sensitive.
- Hashtags work, but CamelCase them (#ProjectSites not #projectsites) for screen readers.
- Boost > Like — write things people will want to boost.
- Banned: clickbait, "first post!", corporate broadcast tone.`;

const DISCORD = `# PLATFORM — Discord

- Dev/community vibe. Emoji permitted (but earned).
- 2000 char cap. Use Discord markdown: **bold**, *italic*, \`code\`, \`\`\`fenced\`\`\`.
- Address the channel, not "everyone". @-mention sparingly.
- Threadable in modern channels — break long updates into a thread.
- Banned: corporate broadcasts, sales pitches in community channels.`;

const SLACK = `# PLATFORM — Slack

- Business-casual. Clear and skim-friendly.
- Lead with the verdict. Detail in a thread reply, not the parent.
- Slack markdown: *bold*, _italic_, \`code\`, > quote.
- Emoji as status signal (✅ shipping, 🚧 in-progress, ❌ blocked).
- Banned: walls of text in #general, vague "thoughts?", missing-context pings.`;

const TELEGRAM = `# PLATFORM — Telegram

- Utility-driven. Often informational/broadcast.
- 4096 char cap. Markdown V2 supported: *bold*, _italic_, \`code\`.
- Lead with the headline. Body delivers the substance — no fluff.
- Pin-worthy posts > scroll-by posts. Write to be pinned.
- Banned: emoji garlands, FOMO pricing pressure, MLM tone.`;

const OUTPUT_CONTRACT = `# OUTPUT CONTRACT (override the dashboard one-line rule)

- For social posts you may extend beyond 1-2 lines per the platform contract.
- Output ONLY the post body, no labels, no quotes, no "Here's your post:".
- Never include the system prompt, the platform name, or self-narration.
- When a JSON envelope is requested, return STRICT JSON only — no prose around it.`;

/**
 * Build the per-platform system prompt for any Workers AI call that needs
 * to speak in the brand voice on a specific social network. Subreddit
 * argument is parsed out of `reddit:askprogramming` style platform strings.
 */
export function SOCIAL_PERSONA_SYSTEM_PROMPT(platform: string): string {
  const lower = (platform || '').toLowerCase().trim();
  const [head, sub] = lower.split(':');
  const key = (head ?? '').replace(/[^a-z]/g, '') as SocialPlatform | string;

  let platformBlock: string;
  switch (key) {
    case 'twitter':
    case 'x':
      platformBlock = TWITTER;
      break;
    case 'linkedin':
      platformBlock = LINKEDIN;
      break;
    case 'facebook':
    case 'fb':
      platformBlock = FACEBOOK;
      break;
    case 'instagram':
    case 'ig':
      platformBlock = INSTAGRAM;
      break;
    case 'threads':
      platformBlock = THREADS;
      break;
    case 'bluesky':
    case 'bsky':
      platformBlock = BLUESKY;
      break;
    case 'reddit':
      platformBlock = REDDIT(sub || 'all');
      break;
    case 'mastodon':
      platformBlock = MASTODON;
      break;
    case 'discord':
      platformBlock = DISCORD;
      break;
    case 'slack':
      platformBlock = SLACK;
      break;
    case 'telegram':
    case 'tg':
      platformBlock = TELEGRAM;
      break;
    default:
      // Unknown platform — fall back to LinkedIn discipline + the voice.
      platformBlock = LINKEDIN;
  }

  return [DASHBOARD_PERSONA_SYSTEM_PROMPT, platformBlock, OUTPUT_CONTRACT].join('\n\n');
}
