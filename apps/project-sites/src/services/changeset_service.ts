/**
 * @module services/changeset_service
 * @description Reversible changeset engine for the **conversational_editing**
 * feature module.
 *
 * Every natural-language edit that lands on a site is recorded as a *changeset*
 * — a parent-chained, append-only record of which files changed (with before/
 * after content hashes) and the operation each performed. Undo is **forward-only**:
 * reverting a changeset creates a NEW changeset of status `reverted` whose parent
 * is the original. History is never mutated — this preserves a complete, auditable
 * edit timeline and mirrors the git-style snapshot model in {@link services/git}.
 *
 * ## D1 tables (migration 0519)
 *
 * | Table              | Role                                          |
 * | ------------------ | --------------------------------------------- |
 * | `site_changesets`  | One row per applied/reverted edit             |
 * | `changeset_files`  | One row per file touched, with content hashes |
 *
 * ## R2 persistence
 *
 * The full post-edit file bundle is written to
 * `sites/{slug}/changesets/{id}/files.json` via `env.SITES_BUCKET` so a
 * changeset can be checked out/inspected independently of the live build.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from './db.js';
import {
  ChangesetStatusSchema,
  EditOperationKindSchema,
  type ChangesetFileDiff,
  type ChangesetStatus,
  type ChangesetSummary,
  type EditFile,
  type EditOperationKind,
} from '../../libs/features/conversational_editing/feature.schemas.js';

const FEATURE_SLUG = 'conversational_editing';

/** SHA-256 hex digest of a string — content-addressable file fingerprint. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface SiteRow {
  slug: string;
}

interface ChangesetRow {
  id: string;
  site_id: string;
  chat_id: string | null;
  created_by: string | null;
  prompt: string | null;
  status: string;
  parent_changeset_id: string | null;
  r2_bundle_key: string | null;
  revert_reason: string | null;
  applied_at: string | null;
  reverted_at: string | null;
}

interface ChangesetFileRow {
  file_path: string;
  before_hash: string | null;
  after_hash: string | null;
  op_kind: string | null;
}

function toSummary(row: ChangesetRow): ChangesetSummary {
  const status: ChangesetStatus = ChangesetStatusSchema.catch('applied').parse(row.status);
  return {
    id: row.id,
    siteId: row.site_id,
    chatId: row.chat_id,
    createdBy: row.created_by,
    prompt: row.prompt,
    status,
    parentChangesetId: row.parent_changeset_id,
    revertReason: row.revert_reason,
    appliedAt: row.applied_at,
    revertedAt: row.reverted_at,
  };
}

/** Resolve a site's slug from its id (slug drives all R2 paths). */
async function resolveSlug(env: Env, siteId: string): Promise<string | null> {
  const row = await dbQueryOne<SiteRow>(
    env.DB,
    'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return row?.slug ?? null;
}

/** Return the current (newest, non-deleted) changeset id for a site, or null. */
export async function getHeadChangesetId(env: Env, siteId: string): Promise<string | null> {
  const row = await dbQueryOne<{ id: string }>(
    env.DB,
    `SELECT id FROM site_changesets
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY applied_at DESC, rowid DESC
     LIMIT 1`,
    [siteId],
  );
  return row?.id ?? null;
}

/**
 * Persist the post-edit file bundle to R2 under the changeset's namespace.
 *
 * Writes a single JSON document containing every file's path + content to
 * `sites/{slug}/changesets/{changesetId}/files.json`. This is a real R2 put —
 * NOT a stub — so a changeset can be checked out independently of the live build.
 *
 * @returns The R2 object key written.
 */
export async function persistFiles(
  env: Env,
  slug: string,
  changesetId: string,
  files: EditFile[],
): Promise<string> {
  const key = `sites/${slug}/changesets/${changesetId}/files.json`;
  await env.SITES_BUCKET.put(key, JSON.stringify({ changesetId, files }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return key;
}

/** Options for {@link createChangeset}. */
export interface CreateChangesetOptions {
  siteId: string;
  chatId?: string | null;
  userId: string;
  prompt: string;
  files: EditFile[];
  /** Optional per-file operation kinds (file path → kind). Defaults to `replace`. */
  operationKinds?: Record<string, EditOperationKind>;
}

/**
 * Create an `applied` changeset from the post-edit file set.
 *
 * Computes before/after SHA-256 hashes per file (before = the file's content in
 * the previous changeset bundle, if any), writes one `site_changesets` row +
 * one `changeset_files` row per file, parents it to the current HEAD changeset,
 * and persists the bundle to R2.
 *
 * @returns The new changeset id.
 * @throws {Error} If the changeset row fails to insert.
 */
export async function createChangeset(env: Env, opts: CreateChangesetOptions): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const parentId = await getHeadChangesetId(env, opts.siteId);

  // Build a map of the previous bundle's file hashes for before-hash computation.
  const beforeHashes = await previousFileHashes(env, parentId);

  const slug = await resolveSlug(env, opts.siteId);
  let r2BundleKey: string | null = null;
  if (slug) {
    r2BundleKey = await persistFiles(env, slug, id, opts.files);
  }

  const { error } = await dbInsert(env.DB, 'site_changesets', {
    id,
    site_id: opts.siteId,
    chat_id: opts.chatId ?? null,
    created_by: opts.userId,
    prompt: opts.prompt,
    status: 'applied',
    parent_changeset_id: parentId,
    r2_bundle_key: r2BundleKey,
    revert_reason: null,
    applied_at: now,
    reverted_at: null,
  });
  if (error) {
    throw new Error(`Failed to insert changeset for feature ${FEATURE_SLUG}: ${error}`);
  }

  for (const file of opts.files) {
    const afterHash = await sha256Hex(file.content);
    const beforeHash = beforeHashes.get(file.path) ?? null;
    const opKind: EditOperationKind = EditOperationKindSchema.catch('replace').parse(
      opts.operationKinds?.[file.path] ?? (beforeHash ? 'replace' : 'insert'),
    );
    await dbInsert(env.DB, 'changeset_files', {
      id: crypto.randomUUID(),
      changeset_id: id,
      file_path: file.path,
      before_hash: beforeHash,
      after_hash: afterHash,
      op_kind: opKind,
    });
  }

  return id;
}

/** Read the after-hashes from a changeset's file rows (path → after_hash). */
async function previousFileHashes(
  env: Env,
  changesetId: string | null,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!changesetId) return map;
  const { data } = await dbQuery<ChangesetFileRow>(
    env.DB,
    'SELECT file_path, before_hash, after_hash, op_kind FROM changeset_files WHERE changeset_id = ?',
    [changesetId],
  );
  for (const row of data) {
    if (row.after_hash) map.set(row.file_path, row.after_hash);
  }
  return map;
}

/** Options for {@link revertChangeset}. */
export interface RevertChangesetOptions {
  siteId: string;
  changesetId: string;
  userId: string;
  reason?: string;
}

/**
 * Revert a changeset by creating a NEW changeset (status `reverted`) chained to
 * the original. History is preserved — the original row is left intact and only
 * stamped with `reverted_at`. Undo is forward-only.
 *
 * @returns The new revert-changeset id.
 * @throws {Error} If the target changeset is not found or already reverted.
 */
export async function revertChangeset(env: Env, opts: RevertChangesetOptions): Promise<string> {
  const original = await dbQueryOne<ChangesetRow>(
    env.DB,
    'SELECT * FROM site_changesets WHERE id = ? AND site_id = ? AND deleted_at IS NULL',
    [opts.changesetId, opts.siteId],
  );
  if (!original) {
    throw new Error(`Changeset not found: ${opts.changesetId}`);
  }
  if (original.status === 'reverted') {
    throw new Error(`Changeset already reverted: ${opts.changesetId}`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error } = await dbInsert(env.DB, 'site_changesets', {
    id,
    site_id: opts.siteId,
    chat_id: original.chat_id,
    created_by: opts.userId,
    prompt: `Revert of changeset ${opts.changesetId.substring(0, 8)}`,
    status: 'reverted',
    parent_changeset_id: opts.changesetId,
    r2_bundle_key: original.r2_bundle_key,
    revert_reason: opts.reason ?? null,
    applied_at: now,
    reverted_at: now,
  });
  if (error) {
    throw new Error(`Failed to insert revert changeset for feature ${FEATURE_SLUG}: ${error}`);
  }

  // Stamp the original as reverted (history preserved — row not deleted).
  await dbUpdate(
    env.DB,
    'site_changesets',
    { reverted_at: now },
    'id = ?',
    [opts.changesetId],
  );

  return id;
}

/**
 * Ordered changeset history for a site (newest first).
 *
 * @returns Array of {@link ChangesetSummary}, applied_at DESC.
 */
export async function getHistory(env: Env, siteId: string): Promise<ChangesetSummary[]> {
  const { data } = await dbQuery<ChangesetRow>(
    env.DB,
    `SELECT id, site_id, chat_id, created_by, prompt, status, parent_changeset_id,
            revert_reason, applied_at, reverted_at
     FROM site_changesets
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY applied_at DESC, rowid DESC`,
    [siteId],
  );
  return data.map(toSummary);
}

/** The full diff payload for one changeset. */
export interface ChangesetDiff {
  changeset: ChangesetSummary;
  files: ChangesetFileDiff[];
}

/**
 * Per-file before/after hashes + operation descriptions for one changeset.
 *
 * @returns The changeset summary plus its file diffs, or `null` if not found.
 */
export async function getChangesetDiff(
  env: Env,
  changesetId: string,
): Promise<ChangesetDiff | null> {
  const row = await dbQueryOne<ChangesetRow>(
    env.DB,
    `SELECT id, site_id, chat_id, created_by, prompt, status, parent_changeset_id,
            revert_reason, applied_at, reverted_at
     FROM site_changesets
     WHERE id = ? AND deleted_at IS NULL`,
    [changesetId],
  );
  if (!row) return null;

  const { data } = await dbQuery<ChangesetFileRow>(
    env.DB,
    'SELECT file_path, before_hash, after_hash, op_kind FROM changeset_files WHERE changeset_id = ? ORDER BY file_path ASC',
    [changesetId],
  );

  const files: ChangesetFileDiff[] = data.map((f) => ({
    filePath: f.file_path,
    beforeHash: f.before_hash,
    afterHash: f.after_hash,
    opKind: f.op_kind ? EditOperationKindSchema.catch('replace').parse(f.op_kind) : null,
  }));

  return { changeset: toSummary(row), files };
}
