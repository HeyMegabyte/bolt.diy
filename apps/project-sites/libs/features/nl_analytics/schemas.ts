import { z } from 'zod';
export const QueryRequestSchema = z.object({ question: z.string().min(3).max(500) }).strict();
export type QueryRequest = z.infer<typeof QueryRequestSchema>;
export const QueryResponseSchema = z.object({ sql: z.string(), explanation: z.string(), question: z.string() });
export type QueryResponse = z.infer<typeof QueryResponseSchema>;
