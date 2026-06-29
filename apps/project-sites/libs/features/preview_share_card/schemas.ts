/**
 * @module libs/features/preview_share_card/schemas
 * @description Zod response schema for the preview share-card endpoint.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const ShareMessagesSchema = z.object({
  sms: z.string(),
  whatsapp: z.string(),
  email: z.object({ subject: z.string(), body: z.string() }),
  generic: z.string(),
});

export const ShareLinksSchema = z.object({
  sms: z.string(),
  whatsapp: z.string(),
  email: z.string(),
  x: z.string(),
  facebook: z.string(),
  copy: z.string(),
});

export const OgCardParamsSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  url: z.string(),
  theme: z.enum(['dark', 'light']),
});

export const ShareCardResponseSchema = z.object({
  messages: ShareMessagesSchema,
  links: ShareLinksSchema,
  og: OgCardParamsSchema,
});

export type ShareCardResponse = z.infer<typeof ShareCardResponseSchema>;
