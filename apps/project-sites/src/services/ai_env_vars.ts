/**
 * @module services/ai_env_vars
 * @description Customizable per-org/per-site/per-MCP key-value store that the
 * AI and MCP-connectable surfaces can read at inference time. Values are
 * encrypted at rest via AES-GCM using the existing `MCP_ENCRYPTION_KEY` (see
 * {@link ./ai_crypto.ts}).
 *
 * ## Scope precedence
 *
 * Resolved at LLM/tool-dispatch time by {@link resolveEnvVarsForAI}:
 *
 *   org → site (overrides org) → mcp (overrides org+site)
 *
 * Only rows with `exposed_to_ai = 1` flow into the AI context. Rows with
 * `exposed_to_ai = 0` stay backend-only (e.g. MCP-specific overrides used
 * inside `mcp_client.ts` but never surfaced to the LLM).
 *
 * ## Usage from LLM dispatch
 *
 * ```ts
 * import { resolveEnvVarsForAI, injectIntoSystemPrompt } from './ai_env_vars.js';
 *
 * const resolved = await resolveEnvVarsForAI(env, { orgId, siteId });
 * const augmented = injectIntoSystemPrompt(systemPrompt, resolved);
 * ```
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';
import { encrypt, decrypt } from './ai_crypto.js';
import { dbQuery, dbQueryOne, dbExecute } from './db.js';

/** Scope an env var applies at. */
export type EnvVarScope = 'org' | 'site' | 'mcp';

/** Raw D1 row shape (numeric booleans as stored). */
interface EnvVarRow {
  id: string;
  org_id: string;
  scope: EnvVarScope;
  site_id: string | null;
  mcp_provider: string | null;
  key: string;
  value_encrypted: string;
  description: string | null;
  is_secret: number;
  exposed_to_ai: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Public-facing env var shape returned by `listEnvVars` (never includes plaintext). */
export interface EnvVar {
  id: string;
  org_id: string;
  scope: EnvVarScope;
  site_id: string | null;
  mcp_provider: string | null;
  key: string;
  /** Always returned. `••••` + last 4 chars when `is_secret=1`, plaintext when `is_secret=0`. */
  value_masked: string;
  /** Only present when `opts.unmask === true` was passed. */
  value?: string;
  description: string | null;
  is_secret: boolean;
  exposed_to_ai: boolean;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

/** Arguments to {@link setEnvVar}. */
export interface SetEnvVarArgs {
  orgId: string;
  scope: EnvVarScope;
  siteId?: string;
  mcpProvider?: string;
  key: string;
  value: string;
  description?: string;
  isSecret?: boolean;
  exposedToAi?: boolean;
  createdBy?: string;
}

/** Arguments to {@link listEnvVars}. */
export interface ListEnvVarsOpts {
  scope?: EnvVarScope;
  siteId?: string;
  mcpProvider?: string;
  /**
   * When `true`, also returns the decrypted plaintext `value` on each row.
   * SERVER-SIDE ONLY — never expose to a browser-facing endpoint.
   */
  unmask?: boolean;
}

/** Arguments to {@link resolveEnvVarsForAI}. */
export interface ResolveEnvVarsArgs {
  orgId: string;
  siteId?: string;
  mcpProvider?: string;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_KEY_LEN = 128;
const MAX_VALUE_LEN = 64 * 1024; // 64 KiB ciphertext-input cap

/**
 * Validate and normalise the per-scope required fields. Throws a descriptive
 * `Error` whose message is safe to surface in a route JSON envelope.
 */
function validateScopeFields(args: Pick<SetEnvVarArgs, 'scope' | 'siteId' | 'mcpProvider' | 'key' | 'value'>): void {
  if (args.scope !== 'org' && args.scope !== 'site' && args.scope !== 'mcp') {
    throw new Error(`invalid scope: ${args.scope}`);
  }
  if (args.scope === 'site' && !args.siteId) {
    throw new Error('siteId required when scope=site');
  }
  if (args.scope === 'mcp' && !args.mcpProvider) {
    throw new Error('mcpProvider required when scope=mcp');
  }
  if (!args.key || typeof args.key !== 'string') {
    throw new Error('key required');
  }
  if (args.key.length > MAX_KEY_LEN) {
    throw new Error(`key too long (max ${MAX_KEY_LEN})`);
  }
  if (!KEY_PATTERN.test(args.key)) {
    throw new Error('key must match /^[A-Za-z_][A-Za-z0-9_]*$/');
  }
  if (typeof args.value !== 'string') {
    throw new Error('value required (string)');
  }
  if (args.value.length > MAX_VALUE_LEN) {
    throw new Error(`value too long (max ${MAX_VALUE_LEN})`);
  }
}

/**
 * Mask a secret value as `••••` + last 4 plaintext characters. Returns the
 * plaintext unchanged when the value is short enough that masking would leak
 * more than it hides (≤4 chars).
 */
function maskValue(plaintext: string): string {
  if (plaintext.length <= 4) return '••••';
  return `••••${plaintext.slice(-4)}`;
}

/**
 * Translate a raw DB row into the public {@link EnvVar} shape. Decrypts the
 * value when needed for masking / unmasking.
 */
async function rowToEnvVar(env: Env, row: EnvVarRow, unmask: boolean): Promise<EnvVar> {
  const isSecret = row.is_secret === 1;
  let plaintext: string;
  try {
    plaintext = await decrypt(env, row.value_encrypted);
  } catch (err) {
    console.warn(JSON.stringify({
      service: 'ai_env_vars',
      event: 'decrypt_failed',
      id: row.id,
      error: err instanceof Error ? err.message : String(err),
    }));
    plaintext = '';
  }
  const masked = isSecret ? maskValue(plaintext) : plaintext;
  const out: EnvVar = {
    id: row.id,
    org_id: row.org_id,
    scope: row.scope,
    site_id: row.site_id,
    mcp_provider: row.mcp_provider,
    key: row.key,
    value_masked: masked,
    description: row.description,
    is_secret: isSecret,
    exposed_to_ai: row.exposed_to_ai === 1,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (unmask) out.value = plaintext;
  return out;
}

/**
 * Upsert an env var. The unique key is `(org_id, scope, site_id, mcp_provider, key)`
 * — re-setting the same tuple replaces the value + description in place.
 *
 * @returns The masked {@link EnvVar} representation of the stored row.
 */
export async function setEnvVar(env: Env, args: SetEnvVarArgs): Promise<EnvVar> {
  validateScopeFields(args);
  const now = Date.now();
  const id = crypto.randomUUID();
  const valueEncrypted = await encrypt(env, args.value);
  const isSecret = args.isSecret === undefined ? 1 : args.isSecret ? 1 : 0;
  const exposedToAi = args.exposedToAi === undefined ? 1 : args.exposedToAi ? 1 : 0;
  const siteId = args.scope === 'site' ? (args.siteId ?? null) : null;
  const mcpProvider = args.scope === 'mcp' ? (args.mcpProvider ?? null) : null;

  const sql = `
    INSERT INTO ai_env_vars
      (id, org_id, scope, site_id, mcp_provider, key, value_encrypted, description,
       is_secret, exposed_to_ai, created_by, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(org_id, scope, COALESCE(site_id, ''), COALESCE(mcp_provider, ''), key) DO UPDATE SET
      value_encrypted = excluded.value_encrypted,
      description = excluded.description,
      is_secret = excluded.is_secret,
      exposed_to_ai = excluded.exposed_to_ai,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `;
  const { error } = await dbExecute(env.DB, sql, [
    id,
    args.orgId,
    args.scope,
    siteId,
    mcpProvider,
    args.key,
    valueEncrypted,
    args.description ?? null,
    isSecret,
    exposedToAi,
    args.createdBy ?? null,
    now,
    now,
  ]);
  if (error) throw new Error(`setEnvVar failed: ${error}`);

  // Re-fetch the canonical row (may be the upsert target, not the new id).
  const row = await dbQueryOne<EnvVarRow>(
    env.DB,
    `SELECT * FROM ai_env_vars
       WHERE org_id = ? AND scope = ?
         AND COALESCE(site_id, '') = COALESCE(?, '')
         AND COALESCE(mcp_provider, '') = COALESCE(?, '')
         AND key = ?
         AND deleted_at IS NULL`,
    [args.orgId, args.scope, siteId, mcpProvider, args.key],
  );
  if (!row) throw new Error('setEnvVar: stored row not found after upsert');
  return rowToEnvVar(env, row, false);
}

/**
 * List env vars for an org, optionally filtered by scope/site/mcp. NEVER
 * returns plaintext unless `opts.unmask === true` is explicitly passed
 * (server-side only — see {@link ListEnvVarsOpts.unmask}).
 *
 * Order: scope rank (org→site→mcp), then key alphabetical.
 */
export async function listEnvVars(env: Env, orgId: string, opts: ListEnvVarsOpts = {}): Promise<EnvVar[]> {
  const where: string[] = ['org_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [orgId];
  if (opts.scope) {
    where.push('scope = ?');
    params.push(opts.scope);
  }
  if (opts.siteId) {
    where.push('site_id = ?');
    params.push(opts.siteId);
  }
  if (opts.mcpProvider) {
    where.push('mcp_provider = ?');
    params.push(opts.mcpProvider);
  }
  const sql = `
    SELECT * FROM ai_env_vars
     WHERE ${where.join(' AND ')}
     ORDER BY CASE scope WHEN 'org' THEN 0 WHEN 'site' THEN 1 WHEN 'mcp' THEN 2 ELSE 3 END,
              key ASC
  `;
  const { data } = await dbQuery<EnvVarRow>(env.DB, sql, params);
  const out: EnvVar[] = [];
  for (const row of data) {
    out.push(await rowToEnvVar(env, row, opts.unmask === true));
  }
  return out;
}

/**
 * Fetch a single env var by id, returning the decrypted plaintext.
 * SERVER-SIDE ONLY — for use inside resolver/dispatcher code paths.
 */
export async function getEnvVar(env: Env, orgId: string, id: string): Promise<{ envVar: EnvVar; value: string } | null> {
  const row = await dbQueryOne<EnvVarRow>(
    env.DB,
    `SELECT * FROM ai_env_vars WHERE org_id = ? AND id = ? AND deleted_at IS NULL`,
    [orgId, id],
  );
  if (!row) return null;
  const envVar = await rowToEnvVar(env, row, true);
  return { envVar, value: envVar.value ?? '' };
}

/**
 * Soft-delete an env var (`deleted_at = now`). Returns true when a row was
 * actually flipped (id present + not already deleted), false otherwise.
 */
export async function deleteEnvVar(env: Env, orgId: string, id: string): Promise<boolean> {
  const now = Date.now();
  const { error, changes } = await dbExecute(
    env.DB,
    `UPDATE ai_env_vars SET deleted_at = ?, updated_at = ?
       WHERE org_id = ? AND id = ? AND deleted_at IS NULL`,
    [now, now, orgId, id],
  );
  if (error) throw new Error(`deleteEnvVar failed: ${error}`);
  return changes > 0;
}

/**
 * Resolve the effective env-var set for an AI/LLM call. Merges in priority
 * order: `org → site → mcp` (later scopes override earlier). Only rows with
 * `exposed_to_ai = 1` and `deleted_at IS NULL` are included. Values are
 * decrypted.
 *
 * Call this inside any LLM/tool-call dispatch path (see
 * {@link ../services/external_llm.ts} and {@link ../services/mcp_client.ts})
 * to surface user-defined env vars to the AI.
 */
export async function resolveEnvVarsForAI(env: Env, args: ResolveEnvVarsArgs): Promise<Record<string, string>> {
  // Pull all candidate rows in one query — keeps the merge in-memory.
  const conds: string[] = [
    'org_id = ?',
    'deleted_at IS NULL',
    'exposed_to_ai = 1',
    `(scope = 'org'`
      + (args.siteId ? ` OR (scope = 'site' AND site_id = ?)` : '')
      + (args.mcpProvider ? ` OR (scope = 'mcp' AND mcp_provider = ?)` : '')
      + `)`,
  ];
  const params: unknown[] = [args.orgId];
  if (args.siteId) params.push(args.siteId);
  if (args.mcpProvider) params.push(args.mcpProvider);

  const sql = `SELECT * FROM ai_env_vars WHERE ${conds.join(' AND ')}`;
  const { data } = await dbQuery<EnvVarRow>(env.DB, sql, params);

  // Merge in scope-precedence order: org < site < mcp.
  const merged: Record<string, string> = {};
  const byScope: Record<EnvVarScope, EnvVarRow[]> = { org: [], site: [], mcp: [] };
  for (const row of data) byScope[row.scope].push(row);
  for (const scope of ['org', 'site', 'mcp'] as const) {
    for (const row of byScope[scope]) {
      try {
        merged[row.key] = await decrypt(env, row.value_encrypted);
      } catch (err) {
        console.warn(JSON.stringify({
          service: 'ai_env_vars',
          event: 'resolve_decrypt_failed',
          id: row.id,
          scope: row.scope,
          key: row.key,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  }
  return merged;
}

/**
 * Append a `## Custom environment` block to a system prompt listing each
 * resolved key as `KEY=VALUE`. Returns the augmented system prompt unchanged
 * when `resolved` is empty (so callers can chain unconditionally).
 *
 * The format is deliberately bash-compatible so the LLM can quote values
 * verbatim into tool calls or code snippets.
 */
export function injectIntoSystemPrompt(systemPrompt: string, resolved: Record<string, string>): string {
  const keys = Object.keys(resolved);
  if (keys.length === 0) return systemPrompt;
  const lines = keys
    .sort()
    .map((k) => `${k}=${resolved[k]}`)
    .join('\n');
  const block = `\n\n## Custom environment\n${lines}`;
  return `${systemPrompt}${block}`;
}
