import { z } from 'zod';

export const MruCardSchema = z.object({
  siteId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  lastAction: z.string(),
  lastActivityAt: z.string(),
});
export type MruCard = z.infer<typeof MruCardSchema>;

export const MruCardsResponseSchema = z.object({
  data: z.array(MruCardSchema),
});
export type MruCardsResponse = z.infer<typeof MruCardsResponseSchema>;
