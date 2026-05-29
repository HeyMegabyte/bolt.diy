/**
 * @module libs/features/conversational_editing/schemas
 * @description Zod schemas for the Conversational Editing feature module.
 *
 * Single source of truth for every request/response/config shape the
 * conversational-editing surface validates. Colocated with the manifest per the
 * feature-module architecture rule — never duplicate these in `src/services/`.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * A single file the editor operates on. `content` is the full text body of the
 * file at the time the changeset is created.
 */
export const EditFileSchema = z.object({
  /** Relative file path (e.g. `index.html`, `src/App.tsx`). */
  path: z.string().min(1),
  /** Full text content of the file. */
  content: z.string(),
});

export type EditFile = z.infer<typeof EditFileSchema>;

/** The operation kind a single file-level edit performs. */
export const EditOperationKindSchema = z.enum(['replace', 'insert', 'delete']);

export type EditOperationKind = z.infer<typeof EditOperationKindSchema>;

/**
 * One operation the AI proposes against one file. `description` is a
 * human-readable summary of what the operation does (rendered in the diff UI).
 */
export const EditOperationSchema = z.object({
  /** Relative file path this operation targets. */
  file: z.string().min(1),
  /** What kind of change this operation performs. */
  kind: EditOperationKindSchema,
  /** Human-readable description of the change. */
  description: z.string().min(1),
});

export type EditOperation = z.infer<typeof EditOperationSchema>;

/**
 * The structured intent extracted from a natural-language edit request.
 * `confidence` is clamped to [0, 1].
 */
export const EditIntentSchema = z.object({
  /** Why the AI mapped the request to these operations. */
  rationale: z.string().min(1),
  /** Files the AI determined the request touches. */
  targetFiles: z.array(z.string()).default([]),
  /** Per-file operations the request implies. */
  operations: z.array(EditOperationSchema).default([]),
  /** Confidence in the extraction, 0-1. */
  confidence: z.number().min(0).max(1),
});

export type EditIntent = z.infer<typeof EditIntentSchema>;

/** Request body for `POST /api/conversational-edits/:siteId/intent`. */
export const ExtractIntentRequestSchema = z.object({
  /** Natural-language edit request (e.g. "make the hero darker"). */
  prompt: z.string().min(1).max(4000),
  /** List of file paths available to edit. */
  fileList: z.array(z.string()).default([]),
});

export type ExtractIntentRequest = z.infer<typeof ExtractIntentRequestSchema>;

/** Request body for `POST /api/conversational-edits/:siteId/apply`. */
export const ApplyChangesetRequestSchema = z.object({
  /** Chat/conversation this edit belongs to (nullable for one-off edits). */
  chatId: z.string().nullable().optional(),
  /** Natural-language edit request that produced these files. */
  prompt: z.string().min(1).max(4000),
  /** The full set of files after the edit was applied. */
  files: z.array(EditFileSchema).min(1),
});

export type ApplyChangesetRequest = z.infer<typeof ApplyChangesetRequestSchema>;

/** Request body for `POST /api/conversational-edits/:siteId/revert/:changesetId`. */
export const RevertChangesetRequestSchema = z.object({
  /** Optional human-readable reason for the revert. */
  reason: z.string().max(2000).optional(),
});

export type RevertChangesetRequest = z.infer<typeof RevertChangesetRequestSchema>;

/** Changeset lifecycle status persisted in D1. */
export const ChangesetStatusSchema = z.enum(['applied', 'reverted']);

export type ChangesetStatus = z.infer<typeof ChangesetStatusSchema>;

/** A changeset row as surfaced to the API. */
export const ChangesetSummarySchema = z.object({
  id: z.string(),
  siteId: z.string(),
  chatId: z.string().nullable(),
  createdBy: z.string().nullable(),
  prompt: z.string().nullable(),
  status: ChangesetStatusSchema,
  parentChangesetId: z.string().nullable(),
  revertReason: z.string().nullable(),
  appliedAt: z.string().nullable(),
  revertedAt: z.string().nullable(),
});

export type ChangesetSummary = z.infer<typeof ChangesetSummarySchema>;

/** A per-file diff entry within a changeset. */
export const ChangesetFileDiffSchema = z.object({
  filePath: z.string(),
  beforeHash: z.string().nullable(),
  afterHash: z.string().nullable(),
  opKind: EditOperationKindSchema.nullable(),
});

export type ChangesetFileDiff = z.infer<typeof ChangesetFileDiffSchema>;
