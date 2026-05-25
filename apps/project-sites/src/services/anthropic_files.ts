/**
 * @module services/anthropic_files
 * @description Wrapper around the Anthropic Files API (beta).
 *
 * Uploads a file once to `https://api.anthropic.com/v1/files` (beta header
 * `anthropic-beta: files-api-2025-04-14`) and mirrors the vendor metadata in
 * D1 (`anthropic_files`). Other services then reference the file by
 * `anthropic_file_id` in subsequent `messages.create` calls via the
 * `document` content block helper {@link attachFileToMessage} — no need to
 * re-upload between turns.
 *
 * ## Lifecycle
 *
 * | Step    | Vendor                                  | D1                         |
 * | ------- | --------------------------------------- | -------------------------- |
 * | upload  | POST `/v1/files` (multipart)            | INSERT row                 |
 * | reference | content block `{ type: 'document' }` | (read-only)                |
 * | delete  | DELETE `/v1/files/{file_id}`            | UPDATE `expires_at = now`  |
 *
 * @packageDocumentation
 */

import { dbExecute, dbInsert, dbQueryOne } from './db.js';
import type { Env } from '../types/env.js';

const ANTHROPIC_FILES_BETA = 'files-api-2025-04-14';
const ANTHROPIC_BASE = 'https://api.anthropic.com';

/** Public shape returned by {@link uploadFile}. */
export interface UploadResult {
  /** Vendor-issued file id (`file_*`). */
  anthropicFileId: string;
  /** Our D1 row id (UUID). */
  dbId: string;
  /** Optional vendor-reported expiration. */
  expiresAt: number | null;
}

/** Row shape persisted to D1 + returned by {@link getFile}. */
export interface AnthropicFileRow {
  id: string;
  anthropic_file_id: string;
  org_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  purpose: string | null;
  uploaded_at: number;
  expires_at: number | null;
  metadata_json: string | null;
}

interface AnthropicFileApiResponse {
  id: string;
  type?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  created_at?: string | number;
  expires_at?: string | number;
}

function parseTimestamp(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Upload a file to Anthropic + record it in D1.
 *
 * @remarks
 * Reuses the existing `ANTHROPIC_API_KEY` worker secret. The file is
 * uploaded as a multipart form per the beta API spec. The caller owns the
 * org scoping; we never look at the bytes server-side beyond the multipart
 * frame.
 *
 * @example
 * ```ts
 * const { anthropicFileId } = await uploadFile(env, {
 *   orgId,
 *   file: { name: 'menu.pdf', bytes, mime: 'application/pdf' },
 *   purpose: 'voice_agent_reference',
 * });
 * ```
 *
 * @throws {Error} `ANTHROPIC_API_KEY not configured` when the secret is missing.
 * @throws {Error} `anthropic_files_upload_failed: <status> <body>` on non-2xx.
 */
export async function uploadFile(
  env: Env,
  opts: {
    orgId: string;
    file: { name: string; bytes: ArrayBuffer | Uint8Array; mime: string };
    purpose?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<UploadResult> {
  const apiKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const form = new FormData();
  const bytes =
    opts.file.bytes instanceof Uint8Array ? opts.file.bytes : new Uint8Array(opts.file.bytes);
  form.append('file', new Blob([bytes], { type: opts.file.mime }), opts.file.name);

  const res = await fetch(`${ANTHROPIC_BASE}/v1/files`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': ANTHROPIC_FILES_BETA,
    },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'anthropic_files',
        message: 'upload_failed',
        status: res.status,
        body: body.slice(0, 500),
      }),
    );
    throw new Error(`anthropic_files_upload_failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as AnthropicFileApiResponse;
  const expiresAt = parseTimestamp(json.expires_at);
  const uploadedAt = parseTimestamp(json.created_at) ?? Date.now();
  const dbId = crypto.randomUUID();

  await dbInsert(env.DB, 'anthropic_files', {
    id: dbId,
    anthropic_file_id: json.id,
    org_id: opts.orgId,
    filename: json.filename ?? opts.file.name,
    mime_type: json.mime_type ?? opts.file.mime,
    size_bytes: json.size_bytes ?? bytes.byteLength,
    purpose: opts.purpose ?? null,
    uploaded_at: uploadedAt,
    expires_at: expiresAt,
    metadata_json: opts.metadata ? JSON.stringify(opts.metadata) : null,
  });

  return { anthropicFileId: json.id, dbId, expiresAt };
}

/**
 * Look up a previously uploaded file by its D1 row id.
 *
 * @example
 * ```ts
 * const file = await getFile(env, dbId);
 * if (file) console.warn(file.anthropic_file_id);
 * ```
 */
export async function getFile(env: Env, dbId: string): Promise<AnthropicFileRow | null> {
  return dbQueryOne<AnthropicFileRow>(
    env.DB,
    'SELECT * FROM anthropic_files WHERE id = ?',
    [dbId],
  );
}

/**
 * Delete a file from Anthropic + soft-clear our D1 mirror.
 *
 * @remarks
 * On vendor 404 we still wipe the local row so dangling references stop
 * leaking into chat turns. Logs vendor errors via `console.warn` and
 * proceeds — the D1 cleanup is the authoritative state.
 *
 * @example
 * ```ts
 * await deleteFile(env, dbId);
 * ```
 */
export async function deleteFile(env: Env, dbId: string): Promise<void> {
  const row = await getFile(env, dbId);
  if (!row) return;
  const apiKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  if (apiKey) {
    try {
      const res = await fetch(`${ANTHROPIC_BASE}/v1/files/${row.anthropic_file_id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': ANTHROPIC_FILES_BETA,
        },
      });
      if (!res.ok && res.status !== 404) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'anthropic_files',
            message: 'vendor_delete_failed',
            status: res.status,
            file_id: row.anthropic_file_id,
          }),
        );
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'anthropic_files',
          message: 'vendor_delete_threw',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  await dbExecute(env.DB, 'DELETE FROM anthropic_files WHERE id = ?', [dbId]);
}

/**
 * Build an Anthropic `document` content block that references an uploaded
 * file by its vendor id. Drop into the `content` array of a `messages`
 * entry.
 *
 * @example
 * ```ts
 * const block = attachFileToMessage(file.anthropic_file_id);
 * await client.messages.create({
 *   model,
 *   messages: [{ role: 'user', content: [block, { type: 'text', text: 'Summarize' }] }],
 * });
 * ```
 */
export function attachFileToMessage(anthropicFileId: string): {
  type: 'document';
  source: { type: 'file'; file_id: string };
} {
  return {
    type: 'document',
    source: { type: 'file', file_id: anthropicFileId },
  };
}
