import { z } from 'zod';

/** Health status for a single integration. */
export const IntegrationStatusSchema = z.object({
  name: z.string(),
  url: z.string(),
  status: z.enum(['healthy', 'degraded', 'down', 'unknown']),
  latencyMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
}).strict();
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

/** Aggregated system status response. */
export const SystemStatusResponseSchema = z.object({
  overall: z.enum(['healthy', 'degraded', 'down']),
  checkedAt: z.string(),
  integrations: z.array(IntegrationStatusSchema),
});
export type SystemStatusResponse = z.infer<typeof SystemStatusResponseSchema>;

/** Known integration health-check targets. */
export interface HealthTarget {
  name: string;
  url: string;
  /** Optional category for grouping in the UI. */
  category?: 'email' | 'billing' | 'auth' | 'ai' | 'infra' | 'collab' | 'other';
}
