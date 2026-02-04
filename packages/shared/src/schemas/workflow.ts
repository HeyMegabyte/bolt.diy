/**
 * Workflow and job schemas (Cloudflare Workflows)
 */
import { z } from 'zod';
import { uuidSchema, timestampsSchema } from './base.js';
import { JOB_STATES, DEFAULT_CAPS } from '../constants/index.js';

// ============================================================================
// JOB STATE
// ============================================================================

export const jobStateSchema = z.enum([
  JOB_STATES.PENDING,
  JOB_STATES.RUNNING,
  JOB_STATES.COMPLETED,
  JOB_STATES.FAILED,
  JOB_STATES.DEAD,
]);

// ============================================================================
// WORKFLOW JOB
// ============================================================================

export const workflowJobSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  job_name: z.string().min(1).max(100),
  state: jobStateSchema,
  dedupe_key: z.string().max(255).nullable().optional(),
  payload_r2_path: z.string().nullable().optional(),
  result_r2_path: z.string().nullable().optional(),
  attempt: z.number().int().nonnegative().default(0),
  max_attempts: z.number().int().positive().default(DEFAULT_CAPS.MAX_QUEUED_RETRIES),
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
  failed_at: z.string().datetime().nullable().optional(),
  error_message: z.string().nullable().optional(),
  error_stack: z.string().nullable().optional(),
  worker_id: z.string().nullable().optional(),
  parent_job_id: uuidSchema.nullable().optional(),
  workflow_instance_id: z.string().nullable().optional(),
  ...timestampsSchema.shape,
});

export const createWorkflowJobInputSchema = z.object({
  job_name: z.string().min(1).max(100),
  org_id: uuidSchema,
  dedupe_key: z.string().max(255).optional(),
  payload: z.record(z.unknown()).optional(),
  max_attempts: z.number().int().positive().optional(),
  parent_job_id: uuidSchema.optional(),
});

// ============================================================================
// JOB ENVELOPE (for queue transport)
// ============================================================================

export const jobEnvelopeSchema = z.object({
  job_id: uuidSchema,
  job_name: z.string(),
  org_id: uuidSchema,
  dedupe_key: z.string().nullable().optional(),
  payload_pointer: z.string().nullable().optional(),
  attempt: z.number().int(),
  max_attempts: z.number().int(),
  scheduled_at: z.string().datetime(),
  trace_id: z.string(),
  request_id: z.string(),
});

// ============================================================================
// WORKFLOW DEFINITIONS
// ============================================================================

export const siteGenerationWorkflowInputSchema = z.object({
  org_id: uuidSchema,
  site_id: uuidSchema,
  business_name: z.string(),
  business_email: z.string().email().optional(),
  business_phone: z.string().optional(),
  business_address: z.string().optional(),
});

export const siteGenerationWorkflowOutputSchema = z.object({
  site_id: uuidSchema,
  r2_path: z.string(),
  lighthouse_score: z.number().int().min(0).max(100),
  published_at: z.string().datetime(),
  confidence_scores: z.record(z.number()),
});

// ============================================================================
// AI MICROTASK SCHEMAS
// ============================================================================

export const aiMicrotaskInputSchema = z.object({
  task_type: z.string(),
  org_id: uuidSchema,
  site_id: uuidSchema,
  context: z.record(z.unknown()),
  max_tokens: z.number().int().positive().default(4096),
});

export const aiMicrotaskOutputSchema = z.object({
  task_type: z.string(),
  success: z.boolean(),
  result: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  tokens_used: z.number().int().nonnegative(),
  cost_cents: z.number().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
});

// ============================================================================
// BUSINESS PROFILE (aggregated from microtasks)
// ============================================================================

export const businessProfileSchema = z.object({
  business_name: z.string(),
  tagline: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.object({
    street: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    formatted: z.string().nullable().optional(),
  }).nullable().optional(),
  website_url: z.string().url().nullable().optional(),
  services: z.array(z.string()).nullable().optional(),
  hours: z.record(z.string()).nullable().optional(),
  social_links: z.record(z.string().url()).nullable().optional(),
  reviews: z.array(z.object({
    source: z.string(),
    rating: z.number().min(0).max(5),
    count: z.number().int().nonnegative(),
    url: z.string().url().optional(),
  })).nullable().optional(),
  images: z.array(z.object({
    url: z.string().url(),
    alt: z.string(),
    type: z.enum(['logo', 'hero', 'gallery', 'team', 'other']),
  })).nullable().optional(),
  ctas: z.array(z.object({
    text: z.string(),
    url: z.string().url().optional(),
    type: z.enum(['call', 'email', 'visit', 'book', 'custom']),
  })).nullable().optional(),
});

export const confidenceMapSchema = z.record(z.number().min(0).max(100));

export const sourceSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  retrieved_at: z.string().datetime(),
  data_type: z.string(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type JobState = z.infer<typeof jobStateSchema>;
export type WorkflowJob = z.infer<typeof workflowJobSchema>;
export type CreateWorkflowJobInput = z.infer<typeof createWorkflowJobInputSchema>;
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;
export type SiteGenerationWorkflowInput = z.infer<typeof siteGenerationWorkflowInputSchema>;
export type SiteGenerationWorkflowOutput = z.infer<typeof siteGenerationWorkflowOutputSchema>;
export type AiMicrotaskInput = z.infer<typeof aiMicrotaskInputSchema>;
export type AiMicrotaskOutput = z.infer<typeof aiMicrotaskOutputSchema>;
export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export type ConfidenceMap = z.infer<typeof confidenceMapSchema>;
export type Source = z.infer<typeof sourceSchema>;
