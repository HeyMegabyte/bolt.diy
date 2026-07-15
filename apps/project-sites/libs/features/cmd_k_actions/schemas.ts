import { z } from 'zod';
export const CmdKQuerySchema = z.object({ q: z.string().min(1).max(200) }).strict();
export const CmdKSuggestionSchema = z.object({ id: z.string(), label: z.string(), action: z.enum(['rebuild','snapshot','delete','view','edit','publish']), siteSlug: z.string().nullable(), route: z.string() });
