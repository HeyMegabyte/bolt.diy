import { z } from 'zod';
export const BadgeSchema = z.object({ total: z.number().int().nonnegative(), alerts: z.number().int().nonnegative(), builds: z.number().int().nonnegative() });
