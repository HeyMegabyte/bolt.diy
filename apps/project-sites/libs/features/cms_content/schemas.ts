/**
 * @module libs/features/cms_content/schemas
 * @description Zod schemas for the CMS↔generated-site bridge. Single source of
 * truth for (a) the inbound Payload `notify-sites` webhook payload and (b) the
 * flat blog feed shape the generated sites consume. Validating the upstream feed
 * here means a Payload shape change can never silently corrupt a client site.
 */
import { z } from 'zod';

/** Inbound webhook from Payload `notify-sites` hook (HMAC-signed body). */
export const CmsWebhookPayload = z.object({
  collection: z.string().min(1),
  slug: z.string().min(1),
  event: z.enum(['published', 'unpublished', 'deleted']),
  at: z.string().min(1),
});
export type CmsWebhookPayload = z.infer<typeof CmsWebhookPayload>;

/** A single published post in the flat consumption feed. */
export const BlogPost = z.object({
  title: z.string(),
  slug: z.string(),
  url: z.string(),
  excerpt: z.string(),
  publishedAt: z.string().nullable(),
  author: z.string().nullable(),
  categories: z.array(z.string()),
  image: z.string().nullable(),
});
export type BlogPost = z.infer<typeof BlogPost>;

/** The full `/api/blog.json` envelope as served to generated sites. */
export const BlogFeed = z.object({
  count: z.number().int().min(0),
  posts: z.array(BlogPost),
});
export type BlogFeed = z.infer<typeof BlogFeed>;
