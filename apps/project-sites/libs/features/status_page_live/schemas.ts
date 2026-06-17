/**
 * @module libs/features/status_page_live/schemas
 * @description Zod schemas for the status_page_live feature module.
 * @packageDocumentation
 */

import { z } from 'zod';

export const StatusSeveritySchema = z.enum(['minor', 'major', 'critical']);
export type StatusSeverity = z.infer<typeof StatusSeveritySchema>;

export const StatusStateSchema = z.enum(['open', 'resolved']);
export type StatusState = z.infer<typeof StatusStateSchema>;

export const OverallStatusSchema = z.enum(['operational', 'degraded', 'outage']);
export type OverallStatus = z.infer<typeof OverallStatusSchema>;

export const StatusIncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: StatusSeveritySchema,
  message: z.string(),
  status: StatusStateSchema,
  createdAt: z.string(),
});
export type StatusIncident = z.infer<typeof StatusIncidentSchema>;

export const CreateIncidentBodySchema = z
  .object({
    title: z.string().min(5),
    severity: StatusSeveritySchema,
    message: z.string(),
  })
  .strict();
export type CreateIncidentBody = z.infer<typeof CreateIncidentBodySchema>;

export const StatusFeedResponseSchema = z.object({
  ok: z.literal(true),
  status: OverallStatusSchema,
  incidents: z.array(StatusIncidentSchema),
});
export type StatusFeedResponse = z.infer<typeof StatusFeedResponseSchema>;

export const CreateIncidentResponseSchema = z.object({
  ok: z.literal(true),
  incident: StatusIncidentSchema,
});
export type CreateIncidentResponse = z.infer<typeof CreateIncidentResponseSchema>;
