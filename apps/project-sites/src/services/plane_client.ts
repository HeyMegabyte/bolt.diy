/**
 * @module services/plane_client
 *
 * @description
 * Typed Zod schemas for the Plane API (pm.projectsites.dev). AGPL-isolated: every
 * type is re-declared locally, never imported from Plane's SDK. Zero I/O — this is
 * a pure type layer for eventual HTTP client use.
 *
 * All schemas use `safeParse`-friendly shapes: optionals for nullable fields,
 * branded primitives for IDs, and strict enums for closed vocabularies.
 *
 * @remarks
 * Plane is AGPL-licensed (see `rules/agpl-isolation-via-http-boundary.md`). The HTTP
 * boundary is the license firewall — types and abstractions stay in this file, never
 * leak to feature modules.
 *
 * @example
 * ```ts
 * import { IssueSchema, type Issue } from './plane_client.js';
 *
 * const result = IssueSchema.safeParse(raw);
 * if (!result.success) {
 *   // handle validation error
 * }
 * const issue: Issue = result.data;
 * ```
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base primitives
// ---------------------------------------------------------------------------

/** Plane UUID identifier. */
const planeId = z.string().uuid();

/** ISO 8601 datetime string. */
const dateTime = z.string().datetime();

/** ISO 8601 date string (YYYY-MM-DD). */
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Hex color string (#RRGGBB). */
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable()
  .optional();

// ---------------------------------------------------------------------------
// Priority — Plane's 5-level scale
// ---------------------------------------------------------------------------

/** Plane issue priority. */
export const PrioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
export type Priority = z.infer<typeof PrioritySchema>;

// ---------------------------------------------------------------------------
// State group — maps to issue status pipeline
// ---------------------------------------------------------------------------

/** Logical group a Plane state belongs to. */
export const StateGroupSchema = z.enum([
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
]);
export type StateGroup = z.infer<typeof StateGroupSchema>;

// ---------------------------------------------------------------------------
// Cycle status
// ---------------------------------------------------------------------------

export const CycleStatusSchema = z.enum(['draft', 'started', 'completed']);
export type CycleStatus = z.infer<typeof CycleStatusSchema>;

// ---------------------------------------------------------------------------
// Module status
// ---------------------------------------------------------------------------

export const ModuleStatusSchema = z.enum([
  'backlog',
  'planned',
  'in_progress',
  'paused',
  'completed',
  'cancelled',
]);
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;

// ---------------------------------------------------------------------------
// Project member role
// ---------------------------------------------------------------------------

/** Plane project member role level — higher numbers with more privileges. */
export const MemberRoleSchema = z.enum(['admin', 'member', 'guest', 'viewer']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

/** Maps Plane's numeric role to a named role. */
const roleNumberToLabel: Record<number, MemberRole> = {
  2: 'admin',
  5: 'member',
  10: 'guest',
  15: 'viewer',
};

// ---------------------------------------------------------------------------
// State (issue status pipeline node)
// ---------------------------------------------------------------------------

/**
 * A single status node in Plane's state pipeline (e.g. "In Progress", "Done").
 *
 * @remarks
 * Every project has its own state pipeline. The `group` field maps the state to a
 * logical bucket (`started` / `completed` / etc.), and `sequence` controls ordering.
 */
export const StateSchema = z.object({
  /** Brand hex color for the state badge. */
  color: hexColor,
  created_at: dateTime,
  /** Whether this is the project's default state. */
  default: z.boolean().optional(),
  /** Logical group the state belongs to. */
  group: StateGroupSchema,
  id: planeId,
  /** Display name (e.g. "In Review"). */
  name: z.string(),
  /** Project this state belongs to. */
  project: planeId,
  /** Sort order within the group. */
  sequence: z.number().int(),
  updated_at: dateTime,
  /** Workspace slug. */
  workspace: z.string(),
});
export type State = z.infer<typeof StateSchema>;

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

/**
 * A colored label for categorizing issues within a project.
 */
export const LabelSchema = z.object({
  /** Brand hex color for the label. */
  color: hexColor,
  created_at: dateTime,
  id: planeId,
  /** Display name. */
  name: z.string(),
  /** Parent label UUID (nested labels). */
  parent: planeId.nullable().optional(),
  /** Project this label belongs to. */
  project: planeId,
  updated_at: dateTime,
  /** Workspace slug. */
  workspace: z.string(),
});
export type Label = z.infer<typeof LabelSchema>;

// ---------------------------------------------------------------------------
// User (brief — used in assignee and member sub-objects)
// ---------------------------------------------------------------------------

/**
 * Brief user representation returned by Plane in nested relationship objects.
 */
export const PlaneUserSchema = z.object({
  avatar: z.string().url().nullable().optional(),
  display_name: z.string(),
  email: z.string().email().optional(),
  first_name: z.string().optional(),
  id: planeId,
  last_name: z.string().optional(),
});
export type PlaneUser = z.infer<typeof PlaneUserSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * A Plane project — the primary grouping container for issues, cycles, and modules.
 *
 * @remarks
 * The `identifier` is a short uppercase prefix (e.g. "PROJ", "DESIGN") used in
 * issue display IDs (e.g. "PROJ-42"). It is unique per workspace.
 */
export const ProjectSchema = z.object({
  /** URL to the project's cover image. */
  cover_image_url: z.string().url().nullable().optional(),
  created_at: dateTime,
  /** Long-form description. */
  description: z.string().nullable().optional(),
  id: planeId,
  /** Short uppercase prefix for issue display IDs (e.g. "PROJ"). */
  identifier: z.string(),
  /** Logo configuration (icon, color, etc.). */
  logo_props: z.record(z.unknown()).nullable().optional(),
  /** Display name. */
  name: z.string(),
  /** Total number of issues in this project. */
  total_issues: z.number().int().optional(),
  /** Total number of members in this project. */
  total_members: z.number().int().optional(),
  updated_at: dateTime,
  /** Workspace this project belongs to. */
  workspace: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

/**
 * A Plane issue — the core work item. Maps to a single task, bug, feature, or
 * story within a project.
 *
 * @remarks
 * `priority` uses Plane's 5-level scale: urgent → high → medium → low → none.
 * `sequence_id` is the project-scoped sequential number displayed as
 * `{identifier}-{sequence_id}` (e.g. "PROJ-42").
 * `state` references the state UUID; expanded `state_detail` is available when
 * Plane's expand=state query param is used.
 */
export const IssueSchema = z.object({
  /** Expanded assignee details (present when ?expand=assignees). */
  assignee_details: z.array(PlaneUserSchema).optional(),
  /** Array of assignee user UUIDs. */
  assignees: z.array(planeId).default([]),
  /** Timestamp when the issue was moved to a completed state. */
  completed_at: dateTime.nullable().optional(),
  created_at: dateTime,
  /** Plain-text description. */
  description: z.string().nullable().optional(),
  /** HTML description. */
  description_html: z.string().nullable().optional(),
  id: planeId,
  /** Expanded label details (present when ?expand=labels). */
  label_details: z.array(LabelSchema).optional(),
  /** Array of label UUIDs. */
  labels: z.array(planeId).default([]),
  /** Issue title. */
  name: z.string(),
  /** Parent issue UUID (for sub-issues). */
  parent: planeId.nullable().optional(),
  /** Issue priority. */
  priority: PrioritySchema,
  /** Project this issue belongs to. */
  project: planeId,
  /** Project-scoped sequential number. */
  sequence_id: z.number().int(),
  /** Sort order within the issue list. */
  sort_order: z.number().optional(),
  /** Start date. */
  start_date: dateString.nullable().optional(),
  /** Current state (status node UUID). */
  state: planeId,
  /** Expanded state detail (present when ?expand=state). */
  state_detail: StateSchema.optional(),
  /** Target/due date. */
  target_date: dateString.nullable().optional(),
  updated_at: dateTime,
  /** Workspace slug. */
  workspace: z.string(),
});
export type Issue = z.infer<typeof IssueSchema>;

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

/**
 * A time-boxed sprint within a project. Cycles group issues that should be
 * completed within a specific date range.
 */
export const CycleSchema = z.object({
  /** Number of cancelled issues. */
  cancelled_issues: z.number().int().optional(),
  /** Number of completed issues. */
  completed_issues: z.number().int().optional(),
  created_at: dateTime,
  /** Cycle description. */
  description: z.string().nullable().optional(),
  /** End date (required for active cycles). */
  end_date: dateString,
  id: planeId,
  /** Cycle display name. */
  name: z.string(),
  /** Cycle progress snapshot (percentage per bucket). */
  progress_snapshot: z.record(z.number()).nullable().optional(),
  /** Project this cycle belongs to. */
  project: planeId,
  /** Start date (required for active cycles). */
  start_date: dateString,
  /** Number of started issues. */
  started_issues: z.number().int().optional(),
  /** Cycle progress status. */
  status: CycleStatusSchema,
  /** Total issues assigned to this cycle. */
  total_issues: z.number().int().optional(),
  /** Number of unstarted issues. */
  unstarted_issues: z.number().int().optional(),
  updated_at: dateTime,
  /** Workspace slug. */
  workspace: z.string(),
});
export type Cycle = z.infer<typeof CycleSchema>;

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

/**
 * A logical grouping of issues within a project, similar to a feature area or
 * epic. Modules span cycles and provide an alternative organization axis.
 */
export const ModuleSchema = z.object({
  /** Number of completed issues. */
  completed_issues: z.number().int().optional(),
  created_at: dateTime,
  /** Module description (HTML). */
  description: z.string().nullable().optional(),
  /** Module description (plain text). */
  description_text: z.string().nullable().optional(),
  id: planeId,
  /** Module display name. */
  name: z.string(),
  /** Project this module belongs to. */
  project: planeId,
  /** Planned start date. */
  start_date: dateString.nullable().optional(),
  /** Module progress status. */
  status: ModuleStatusSchema,
  /** Planned target completion date. */
  target_date: dateString.nullable().optional(),
  /** Total issues in this module. */
  total_issues: z.number().int().optional(),
  updated_at: dateTime,
  /** Workspace slug. */
  workspace: z.string(),
});
export type Module = z.infer<typeof ModuleSchema>;

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * A Plane workspace — the top-level organizational unit. Contains projects and
 * their associated issues, cycles, and modules.
 */
export const WorkspaceSchema = z.object({
  created_at: dateTime,
  /** Workspace description. */
  description: z.string().nullable().optional(),
  id: planeId,
  /** URL to the workspace logo. */
  logo_url: z.string().url().nullable().optional(),
  /** Workspace display name. */
  name: z.string(),
  /** Owner user detail. */
  owner: PlaneUserSchema.optional(),
  /** URL-friendly identifier (used in API paths). */
  slug: z.string(),
  /** Total number of projects in this workspace. */
  total_projects: z.number().int().optional(),
  updated_at: dateTime,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

// ---------------------------------------------------------------------------
// ProjectMember
// ---------------------------------------------------------------------------

/**
 * A member of a plane project with assigned role.
 */
export const ProjectMemberSchema = z.object({
  /** Avatar URL. */
  avatar: z.string().url().nullable().optional(),
  created_at: dateTime,
  /** Display name of the member. */
  display_name: z.string(),
  id: planeId,
  /** User UUID. */
  member: planeId,
  /** Project this membership belongs to. */
  project: planeId,
  /** Numeric role level. */
  role: z.number().int(),
  /** Role label derived from numeric value. */
  role_label: MemberRoleSchema,
  updated_at: dateTime,
  /** Workspace slug. */
  workspace: z.string().optional(),
});
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;

// ---------------------------------------------------------------------------
// PageInfo — pagination metadata from list endpoints
// ---------------------------------------------------------------------------

/**
 * Pagination metadata returned by Plane's list endpoints.
 */
export const PageInfoSchema = z.object({
  next_cursor: z.string().nullable(),
  next_page_results: z.boolean(),
  prev_cursor: z.string().nullable(),
  prev_page_results: z.boolean().optional(),
  total_count: z.number().int().optional(),
  total_pages: z.number().int().optional(),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a Plane numeric role to its named label.
 *
 * @param role - Numeric role (2/5/10/15).
 * @returns The matching MemberRole, or 'viewer' as default fallback.
 *
 * @example
 * ```ts
 * const label = numericRoleToMemberRole(2); // 'admin'
 * const label = numericRoleToMemberRole(99); // 'viewer' (fallback)
 * ```
 */
export function numericRoleToMemberRole(role: number): MemberRole {
  return roleNumberToLabel[role] ?? 'viewer';
}

/**
 * Build an issue display ID from project identifier and sequence id.
 *
 * @param identifier - Project identifier (e.g. "PROJ").
 * @param sequenceId - Issue sequence number (e.g. 42).
 * @returns Formatted display ID (e.g. "PROJ-42").
 *
 * @example
 * ```ts
 * const displayId = issueDisplayId('PROJ', 42); // 'PROJ-42'
 * ```
 */
export function issueDisplayId(identifier: string, sequenceId: number): string {
  return `${identifier}-${sequenceId}`;
}

// ---------------------------------------------------------------------------
// Paginated response envelope
// ---------------------------------------------------------------------------

/**
 * Generic paginated response wrapper used by Plane list endpoints.
 *
 * @remarks
 * Plane's API wraps list results in `{ results: T[], ...pageInfo }`. This schema
 * captures the pagination envelope for typed list responses.
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    next_cursor: z.string().nullable(),
    next_page_results: z.boolean(),
    prev_cursor: z.string().nullable(),
    prev_page_results: z.boolean().optional(),
    results: z.array(itemSchema),
    total_count: z.number().int().optional(),
    total_pages: z.number().int().optional(),
  });
}
