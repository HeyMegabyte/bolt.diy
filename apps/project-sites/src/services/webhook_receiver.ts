/**
 * @module services/webhook_receiver
 * @description PL21 Plane webhook event types, Zod-validated payload schemas,
 * and classification function. Pure (zero I/O), never throws.
 *
 * Consumed by the existing {@link verifyWebhook | inbound_webhook HMAC verifier}
 * after signature verification passes — this module handles the type-safe
 * payload interpretation layer.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Plane webhook envelope ────────────────────────────────────────────

/** Known Plane webhook event type literal. */
export type PlaneEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'cycle.created'
  | 'module.created'
  | 'project.created'
  | 'comment.created';

/**
 * All known Plane event types. Frozen const array — safe for iteration,
 * inclusion checks, and as a source of truth for registration.
 */
export const PLANE_EVENT_TYPES: readonly PlaneEventType[] = Object.freeze([
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'cycle.created',
  'module.created',
  'project.created',
  'comment.created',
]);

// ── Common shared sub-schemas ──────────────────────────────────────────

/** Minimal workspace reference carried in webhook payloads. */
const PlaneWorkspaceSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

/** Minimal project reference carried in webhook payloads. */
const PlaneProjectSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  name: z.string().min(1),
});

/** Base reference shape common to all issue payloads. */
const PlaneIssueCommonSchema = z.object({
  archived_at: z.string().datetime().nullable().optional(),
  assignees: z.array(z.string()).optional(),
  completed_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime().optional(),
  created_by: z.string().min(1).optional(),
  description_html: z.string().optional(),
  id: z.string().min(1),
  labels: z.array(z.string()).optional(),
  name: z.string(),
  priority: z
    .union([
      z.literal('urgent'),
      z.literal('high'),
      z.literal('medium'),
      z.literal('low'),
      z.literal('none'),
    ])
    .optional(),
  sequence_id: z.number().int().positive(),
  start_date: z.string().nullable().optional(),
  state: z.string().min(1),
  state_name: z.string().optional(),
  target_date: z.string().nullable().optional(),
  updated_at: z.string().datetime().optional(),
});

/** Cycle reference in the payload's `cycle` field. */
const PlaneCycleSchema = z.object({
  created_at: z.string().datetime().optional(),
  description: z.string().optional(),
  end_date: z.string().nullable().optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  start_date: z.string().nullable().optional(),
  updated_at: z.string().datetime().optional(),
});

/** Module reference in the payload's `module` field. */
const PlaneModuleSchema = z.object({
  created_at: z.string().datetime().optional(),
  description: z.string().optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  updated_at: z.string().datetime().optional(),
});

/** Comment payload shape. */
const PlaneCommentSchema = z.object({
  comment_html: z.string().min(1),
  created_at: z.string().datetime().optional(),
  created_by: z.string().min(1).optional(),
  id: z.string().min(1),
  issue: z.string().min(1).optional(),
  updated_at: z.string().datetime().optional(),
});

/** Project details carried in the payload (richer than the common reference). */
const PlaneProjectDetailsSchema = PlaneProjectSchema.extend({
  created_at: z.string().datetime().optional(),
  created_by: z.string().min(1).optional(),
  description: z.string().optional(),
  updated_at: z.string().datetime().optional(),
});

/** Event context — origin metadata from the Plane webhook envelope. */
const PlaneEventContextSchema = z
  .object({
    project_slug: z.string().min(1),
    user: z.string().min(1),
    workspace_slug: z.string().min(1),
  })
  .passthrough();

// ── Per-event payload schemas ──────────────────────────────────────────

const IssueCreatedPayloadSchema = z
  .object({
    event: z.literal('issue.created'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      cycle: PlaneCycleSchema.optional(),
      issue: PlaneIssueCommonSchema,
      module: PlaneModuleSchema.optional(),
      project: PlaneProjectSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

const IssueUpdatedPayloadSchema = z
  .object({
    event: z.literal('issue.updated'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      cycle: PlaneCycleSchema.optional(),
      issue: PlaneIssueCommonSchema,
      module: PlaneModuleSchema.optional(),
      project: PlaneProjectSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

const IssueDeletedPayloadSchema = z
  .object({
    event: z.literal('issue.deleted'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      issue: PlaneIssueCommonSchema.partial().required({ id: true }),
      project: PlaneProjectSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

const CycleCreatedPayloadSchema = z
  .object({
    event: z.literal('cycle.created'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      cycle: PlaneCycleSchema,
      project: PlaneProjectSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

const ModuleCreatedPayloadSchema = z
  .object({
    event: z.literal('module.created'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      module: PlaneModuleSchema,
      project: PlaneProjectSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

const ProjectCreatedPayloadSchema = z
  .object({
    event: z.literal('project.created'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      project: PlaneProjectDetailsSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

const CommentCreatedPayloadSchema = z
  .object({
    event: z.literal('comment.created'),
    event_context: PlaneEventContextSchema.optional(),
    payload: z.object({
      comment: PlaneCommentSchema,
      issue: PlaneIssueCommonSchema,
      project: PlaneProjectSchema,
      workspace: PlaneWorkspaceSchema,
    }),
    timestamp: z.string().datetime().optional(),
    webhook_id: z.string().min(1).optional(),
  })
  .passthrough();

// ── Typed event discriminator ─────────────────────────────────────────

/**
 * Union of all Plane webhook payload Zod schemas, discriminated by `event`.
 * Use this for exhaustive validation when you need to ensure the body matches
 * exactly one known event shape.
 */
export const PlaneWebhookEventSchema = z.discriminatedUnion('event', [
  IssueCreatedPayloadSchema,
  IssueUpdatedPayloadSchema,
  IssueDeletedPayloadSchema,
  CycleCreatedPayloadSchema,
  ModuleCreatedPayloadSchema,
  ProjectCreatedPayloadSchema,
  CommentCreatedPayloadSchema,
]);

/**
 * Inferred type of a validated, fully-typed Plane webhook event.
 * Only use via {@link PlaneWebhookEventSchema.parse} or `.safeParse`.
 */
export type PlaneWebhookEvent = z.infer<typeof PlaneWebhookEventSchema>;

// ── Classification (loose recognizer) ─────────────────────────────────

/**
 * Classify a raw Plane webhook body into a typed event.
 *
 * Returns the typed event when `event` is a known event type and the payload
 * shape passes basic validation. Returns `null` when the event type is unknown
 * or the body is structurally invalid.
 *
 * This is the **primary consumer entry point** — use after HMAC signature
 * verification to turn the raw body into a typed dispatch target.
 *
 * @param body - The parsed JSON body of a Plane webhook request.
 * @returns A validated Plane webhook event, or `null` if unclassifiable.
 *
 * @example
 * ```ts
 * const event = classifyPlaneEvent(JSON.parse(rawBody));
 * if (!event) return { reason: 'unknown plane event', valid: false };
 * switch (event.event) {
 *   case 'issue.created': handleIssueCreated(event); break;
 *   // ...
 * }
 * ```
 *
 * @throws Never throws — all validation is done via safeParse.
 */
export function classifyPlaneEvent(body: Record<string, unknown>): PlaneWebhookEvent | null {
  if (!body || typeof body !== 'object') return null;

  const rawEvent = (body as Record<string, unknown>).event;
  if (typeof rawEvent !== 'string') return null;

  // Fast-path: reject unknown event types before attempting safeParse.
  if (!(PLANE_EVENT_TYPES as readonly string[]).includes(rawEvent)) return null;

  const result = PlaneWebhookEventSchema.safeParse(body);
  return result.success ? result.data : null;
}
