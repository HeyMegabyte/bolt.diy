import { z } from 'zod';
export const CloneSiteSchema = z.object({ sourceSiteId: z.string().uuid(), targetSlug: z.string().regex(/^[a-z0-9-]{1,63}$/), targetName: z.string().min(1).max(200) }).strict();
export type CloneSiteInput = z.infer<typeof CloneSiteSchema>;
export const CloneResponseSchema = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), pagesCopied: z.number() });

export type CloneResponse = z.infer<typeof CloneResponseSchema>;
