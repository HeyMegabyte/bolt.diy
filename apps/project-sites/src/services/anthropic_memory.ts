/**
 * @module services/anthropic_memory
 * @description Server-side persistent Memory tool backing the Anthropic SDK.
 *
 * Implements the Memory primitive surfaced by Claude as a built-in tool:
 * a scoped key/value store the model can read, write, list, and delete to
 * persist facts across turns and sessions. Backed by D1 table
 * `anthropic_memory` (see migration `0044_anthropic_memory.sql`).
 *
 * ## Scopes
 *
 * | `scope_kind`   | `scope_id`         | Lifetime                          |
 * | -------------- | ------------------ | --------------------------------- |
 * | `org`          | `orgId`            | Forever (org-wide settings)       |
 * | `site`         | `siteId`           | Forever (per-site facts)          |
 * | `voice_agent`  | callId / sessionId | Per call (TTL set by caller)      |
 * | `user`         | `userId`           | Forever (per-user preferences)    |
 *
 * ## Tool surface
 *
 * The returned tool definition follows Anthropic's standard `input_schema`
 * shape so it can be dropped straight into a `messages.create({tools})`
 * call. {@link executeMemoryTool} dispatches one `tool_use` block to the
 * appropriate CRUD action and returns a stringified `tool_result` payload.
 *
 * @packageDocumentation
 */

import { dbExecute, dbQuery, dbQueryOne } from './db.js';
import type { Env } from '../types/env.js';

/** Anthropic Memory tool scope binding. Pairs a kind with the entity id. */
export interface MemoryScope {
  kind: 'org' | 'site' | 'voice_agent' | 'user';
  id: string;
}

/** Single row returned by {@link listMemory} and used internally. */
export interface MemoryEntry {
  key: string;
  value: string;
  metadata: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

interface MemoryRow {
  id: string;
  scope_kind: string;
  scope_id: string;
  key: string;
  value: string;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

const nowMs = (): number => Date.now();

const rowToEntry = (row: MemoryRow): MemoryEntry => ({
  key: row.key,
  value: row.value,
  metadata: row.metadata_json ? safeJsonParse(row.metadata_json) : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  expires_at: row.expires_at,
});

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isExpired(row: { expires_at: number | null }): boolean {
  return row.expires_at !== null && row.expires_at <= nowMs();
}

/**
 * Read a single memory entry by key.
 *
 * @remarks
 * Returns `null` when the key does not exist OR when it has expired.
 * Expired rows are intentionally NOT auto-deleted here — that's the cron's
 * job — they just read as missing.
 *
 * @example
 * ```ts
 * const tz = await getMemory(env, { kind: 'org', id: orgId }, 'timezone');
 * if (!tz) await setMemory(env, scope, 'timezone', 'America/New_York');
 * ```
 */
export async function getMemory(
  env: Env,
  scope: MemoryScope,
  key: string,
): Promise<string | null> {
  const row = await dbQueryOne<MemoryRow>(
    env.DB,
    'SELECT * FROM anthropic_memory WHERE scope_kind = ? AND scope_id = ? AND key = ?',
    [scope.kind, scope.id, key],
  );
  if (!row || isExpired(row)) return null;
  return row.value;
}

/**
 * Upsert a memory entry.
 *
 * @remarks
 * Atomic via `INSERT … ON CONFLICT(scope_kind, scope_id, key) DO UPDATE`.
 * Supply `opts.ttlSeconds` for ephemeral entries (e.g. per-call voice
 * agent scratchpad) — the cron sweeper deletes expired rows.
 *
 * @example
 * ```ts
 * await setMemory(env, { kind: 'voice_agent', id: callId },
 *   'last_caller_name', 'Mary', { ttlSeconds: 3600 });
 * ```
 */
export async function setMemory(
  env: Env,
  scope: MemoryScope,
  key: string,
  value: string,
  opts: { ttlSeconds?: number; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const now = nowMs();
  const id = crypto.randomUUID();
  const expiresAt = opts.ttlSeconds ? now + opts.ttlSeconds * 1000 : null;
  const metaJson = opts.metadata ? JSON.stringify(opts.metadata) : null;

  const { error } = await dbExecute(
    env.DB,
    `INSERT INTO anthropic_memory
       (id, scope_kind, scope_id, key, value, metadata_json, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
       value = excluded.value,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at,
       expires_at = excluded.expires_at`,
    [id, scope.kind, scope.id, key, value, metaJson, now, now, expiresAt],
  );

  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'anthropic_memory',
        message: 'set_memory_failed',
        scope_kind: scope.kind,
        scope_id: scope.id,
        key,
        error,
      }),
    );
    throw new Error(`anthropic_memory.set failed: ${error}`);
  }
}

/**
 * List every non-expired memory entry within a scope.
 *
 * @remarks
 * Ordered by `updated_at DESC`. Filters out expired rows in-memory so the
 * tool surface never returns stale entries to the model.
 *
 * @example
 * ```ts
 * const entries = await listMemory(env, { kind: 'user', id: userId });
 * for (const e of entries) console.warn(e.key, '=', e.value);
 * ```
 */
export async function listMemory(
  env: Env,
  scope: MemoryScope,
): Promise<MemoryEntry[]> {
  const { data } = await dbQuery<MemoryRow>(
    env.DB,
    'SELECT * FROM anthropic_memory WHERE scope_kind = ? AND scope_id = ? ORDER BY updated_at DESC',
    [scope.kind, scope.id],
  );
  return data.filter((r) => !isExpired(r)).map(rowToEntry);
}

/**
 * Delete a memory entry by key (no-op when missing).
 *
 * @example
 * ```ts
 * await deleteMemory(env, { kind: 'voice_agent', id: callId }, 'last_caller_name');
 * ```
 */
export async function deleteMemory(
  env: Env,
  scope: MemoryScope,
  key: string,
): Promise<void> {
  const { error } = await dbExecute(
    env.DB,
    'DELETE FROM anthropic_memory WHERE scope_kind = ? AND scope_id = ? AND key = ?',
    [scope.kind, scope.id, key],
  );
  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'anthropic_memory',
        message: 'delete_memory_failed',
        scope_kind: scope.kind,
        scope_id: scope.id,
        key,
        error,
      }),
    );
  }
}

// ─── Anthropic Tool integration ─────────────────────────────────

/**
 * Anthropic `tool_use` input shape we accept from {@link executeMemoryTool}.
 *
 * Mirrors the JSON schema returned by {@link buildMemoryToolDef}. Strongly
 * typed so route handlers consuming `messages.create` responses can pass
 * `block.input` directly.
 */
export interface MemoryToolInput {
  action: 'read' | 'write' | 'delete' | 'list';
  key?: string;
  value?: string;
  ttl_seconds?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Build the Anthropic tool definition for the Memory tool.
 *
 * @remarks
 * The `scope` is closed over via the executor — it is NOT serialized into
 * the tool definition so the model can never spoof a different tenant's
 * memory. Drop the returned object into
 * `client.messages.create({ tools: [buildMemoryToolDef(scope), ...] })`.
 *
 * @example
 * ```ts
 * const scope = { kind: 'voice_agent', id: callId } as const;
 * const tools = [buildMemoryToolDef(scope)];
 * const reply = await anthropic.messages.create({ model, tools, messages });
 * ```
 */
export function buildMemoryToolDef(scope: MemoryScope): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: 'memory',
    description: [
      'Persistent key/value memory scoped to this',
      scope.kind === 'voice_agent' ? 'call' : scope.kind,
      '. Use `read` to recall a fact, `write` to remember a new one,',
      '`delete` to forget, and `list` to enumerate everything you have',
      'stored. Use sparingly: store only durable facts, not chat noise.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'delete', 'list'],
          description: 'CRUD verb',
        },
        key: {
          type: 'string',
          description:
            'Snake_case identifier (omit for list). Example: "caller_preferred_name".',
        },
        value: {
          type: 'string',
          description: 'String value to store. Required for `write`.',
        },
        ttl_seconds: {
          type: 'integer',
          minimum: 1,
          description:
            'Optional expiration in seconds. Use for short-lived facts (call-scope reminders, hold-music intent, etc.).',
        },
        metadata: {
          type: 'object',
          description: 'Optional small JSON object for context tagging.',
          additionalProperties: true,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  };
}

/**
 * Execute a single Memory `tool_use` block and return a stringified
 * `tool_result` content payload.
 *
 * @remarks
 * Catches every error so the model always receives a structured response
 * instead of a connection failure. Result strings are JSON so downstream
 * tooling can parse them programmatically.
 *
 * @example
 * ```ts
 * // Inside the tool dispatch loop:
 * const out = await executeMemoryTool(env, scope, { input: block.input });
 * messages.push({ role: 'user', content: [{ type: 'tool_result',
 *   tool_use_id: block.id, content: out }] });
 * ```
 */
export async function executeMemoryTool(
  env: Env,
  scope: MemoryScope,
  toolUse: { input: MemoryToolInput | Record<string, unknown> },
): Promise<string> {
  const input = (toolUse.input ?? {}) as MemoryToolInput;
  try {
    switch (input.action) {
      case 'read': {
        if (!input.key) return JSON.stringify({ ok: false, error: 'missing_key' });
        const value = await getMemory(env, scope, input.key);
        return JSON.stringify({ ok: true, key: input.key, value });
      }
      case 'write': {
        if (!input.key) return JSON.stringify({ ok: false, error: 'missing_key' });
        if (typeof input.value !== 'string') {
          return JSON.stringify({ ok: false, error: 'missing_value' });
        }
        await setMemory(env, scope, input.key, input.value, {
          ttlSeconds: input.ttl_seconds,
          metadata: input.metadata,
        });
        return JSON.stringify({ ok: true, key: input.key, action: 'wrote' });
      }
      case 'delete': {
        if (!input.key) return JSON.stringify({ ok: false, error: 'missing_key' });
        await deleteMemory(env, scope, input.key);
        return JSON.stringify({ ok: true, key: input.key, action: 'deleted' });
      }
      case 'list': {
        const entries = await listMemory(env, scope);
        return JSON.stringify({
          ok: true,
          count: entries.length,
          entries: entries.map((e) => ({
            key: e.key,
            value: e.value,
            updated_at: e.updated_at,
          })),
        });
      }
      default:
        return JSON.stringify({
          ok: false,
          error: 'unknown_action',
          action: (input as { action?: string }).action ?? null,
        });
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'anthropic_memory',
        message: 'execute_tool_failed',
        action: input.action,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return JSON.stringify({
      ok: false,
      error: 'execution_failed',
      detail: err instanceof Error ? err.message : 'unknown',
    });
  }
}
