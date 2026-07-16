import { z } from 'zod';
export const SparklineSchema = z.object({ siteId: z.string().uuid(), days: z.array(z.object({ date: z.string(), visits: z.number().int().nonnegative() })) });
