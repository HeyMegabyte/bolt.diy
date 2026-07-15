import { z } from 'zod';
export const ACTIONS = ['rebuild', 'snapshot', 'delete'] as const;
export const BatchRequestSchema = z.object({ siteIds: z.array(z.string().uuid()).min(1).max(50), action: z.enum(ACTIONS) }).strict();
export type BatchRequest = z.infer<typeof BatchRequestSchema>;
export const BatchResultSchema = z.object({ siteId: z.string(), ok: z.boolean(), message: z.string() });
