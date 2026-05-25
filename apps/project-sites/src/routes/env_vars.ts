/**
 * @module routes/env_vars
 * @description AI Environment Variables CRUD + import/export.
 *
 *   GET    /api/env-vars                 list (masked values)
 *   POST   /api/env-vars                 create / upsert
 *   PATCH  /api/env-vars/:id             update fields (value/desc/flags)
 *   DELETE /api/env-vars/:id             soft delete
 *   POST   /api/env-vars/import          bulk import dotenv text
 *   GET    /api/env-vars/export          dotenv text (owner-gated when values requested)
 *
 * Auth: every endpoint requires `c.get('orgId')` populated by
 * {@link ../middleware/auth.ts}. Plaintext exports additionally require the
 * caller to hold an `owner` membership row in the active org.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne } from '../services/db.js';
import {
  setEnvVar,
  listEnvVars,
  deleteEnvVar,
  type EnvVarScope,
  type SetEnvVarArgs,
} from '../services/ai_env_vars.js';
import * as auditService from '../services/audit.js';

export const envVarsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const IMPORT_CAP = 100;

/** Standard error envelope matching the rest of the worker. */
function errorJson(code: string, message: string, requestId?: string) {
  return { error: { code, message, request_id: requestId } };
}

/** Parse `'org'|'site'|'mcp'` from a query string with fallback to undefined. */
function parseScope(raw: string | undefined): EnvVarScope | undefined {
  if (raw === 'org' || raw === 'site' || raw === 'mcp') return raw;
  return undefined;
}

/**
 * Parse a `.env`-formatted blob into key/value pairs. Supports `#` comments,
 * blank lines, surrounding single/double quotes, `export ` prefix, and the
 * `\n`/`\t`/`\r`/`\\` escape sequences inside double-quoted values.
 *
 * Returns `[]` for unparseable input (caller surfaces count=0).
 */
function parseDotenv(input: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const lines = input.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let work = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
    const eqIdx = work.indexOf('=');
    if (eqIdx === -1) continue;
    const key = work.slice(0, eqIdx).trim();
    if (!key) continue;
    let value = work.slice(eqIdx + 1).trim();
    // Strip trailing inline comment ONLY when value is unquoted.
    if (value.length > 0 && value[0] !== '"' && value[0] !== "'") {
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trimEnd();
    }
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
        if (first === '"') {
          value = value
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\\\/g, '\\');
        }
      }
    }
    out.push({ key, value });
  }
  return out;
}

/**
 * Returns true when the caller is an owner of the given org. Mirrors the
 * membership-lookup pattern already used elsewhere in the worker
 * (see `mcp_oauth.ts` neighbours).
 */
async function isOrgOwner(env: Env, orgId: string, userId: string): Promise<boolean> {
  const row = await dbQueryOne<{ role: string }>(
    env.DB,
    `SELECT role FROM memberships
      WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL`,
    [orgId, userId],
  );
  return row?.role === 'owner';
}

// ────────────────────────────────────────────────────────────
// GET /api/env-vars
// ────────────────────────────────────────────────────────────
envVarsRoutes.get('/api/env-vars', async (c) => {
  const orgId = c.get('orgId');
  const requestId = c.get('requestId');
  if (!orgId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);

  const scope = parseScope(c.req.query('scope'));
  const siteId = c.req.query('siteId') ?? c.req.query('site_id') ?? undefined;
  const mcpProvider = c.req.query('mcpProvider') ?? c.req.query('mcp_provider') ?? undefined;

  try {
    const vars = await listEnvVars(c.env, orgId, { scope, siteId, mcpProvider });
    return c.json({ vars });
  } catch (err) {
    console.warn(JSON.stringify({
      service: 'env_vars',
      event: 'list_failed',
      orgId,
      error: err instanceof Error ? err.message : String(err),
    }));
    return c.json(
      errorJson('INTERNAL_ERROR', err instanceof Error ? err.message : 'list failed', requestId),
      500,
    );
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/env-vars
// ────────────────────────────────────────────────────────────
envVarsRoutes.post('/api/env-vars', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const requestId = c.get('requestId');
  if (!orgId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);

  let body: Partial<SetEnvVarArgs>;
  try {
    body = (await c.req.json()) as Partial<SetEnvVarArgs>;
  } catch {
    return c.json(errorJson('BAD_REQUEST', 'invalid JSON body', requestId), 400);
  }

  const scope = parseScope(body.scope);
  if (!scope) return c.json(errorJson('VALIDATION_ERROR', 'scope must be org|site|mcp', requestId), 400);

  try {
    const stored = await setEnvVar(c.env, {
      orgId,
      scope,
      siteId: body.siteId,
      mcpProvider: body.mcpProvider,
      key: body.key as string,
      value: body.value as string,
      description: body.description,
      isSecret: body.isSecret,
      exposedToAi: body.exposedToAi,
      createdBy: userId,
    });
    c.executionCtx.waitUntil(
      auditService.writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: userId ?? null,
        action: 'env_var.upsert',
        message: `env var ${stored.key} (${stored.scope}) upserted`,
        target_type: 'ai_env_var',
        target_id: stored.id,
        metadata_json: {
          scope: stored.scope,
          key: stored.key,
          site_id: stored.site_id,
          mcp_provider: stored.mcp_provider,
        },
        request_id: requestId,
      }),
    );
    return c.json({ var: stored });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'upsert failed';
    return c.json(errorJson('VALIDATION_ERROR', msg, requestId), 400);
  }
});

// ────────────────────────────────────────────────────────────
// PATCH /api/env-vars/:id
// ────────────────────────────────────────────────────────────
envVarsRoutes.patch('/api/env-vars/:id', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const requestId = c.get('requestId');
  if (!orgId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);

  const id = c.req.param('id');
  if (!id) return c.json(errorJson('BAD_REQUEST', 'id required', requestId), 400);

  let body: { value?: string; description?: string | null; isSecret?: boolean; exposedToAi?: boolean };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(errorJson('BAD_REQUEST', 'invalid JSON body', requestId), 400);
  }

  // Fetch current row to merge against.
  const row = await dbQueryOne<{
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
  }>(
    c.env.DB,
    `SELECT id, org_id, scope, site_id, mcp_provider, key, value_encrypted,
            description, is_secret, exposed_to_ai
       FROM ai_env_vars
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [id, orgId],
  );
  if (!row) return c.json(errorJson('NOT_FOUND', 'env var not found', requestId), 404);

  let valueToStore: string;
  if (typeof body.value === 'string') {
    valueToStore = body.value;
  } else {
    // Keep the existing plaintext by re-encrypting on next upsert path. We
    // bypass the encrypt round-trip by reading the value back via the service
    // (cheaper to just decrypt + re-set so flags can update atomically).
    const { decrypt } = await import('../services/ai_crypto.js');
    try {
      valueToStore = await decrypt(c.env, row.value_encrypted);
    } catch (err) {
      return c.json(
        errorJson('INTERNAL_ERROR', `decrypt failed: ${err instanceof Error ? err.message : String(err)}`, requestId),
        500,
      );
    }
  }

  try {
    const stored = await setEnvVar(c.env, {
      orgId,
      scope: row.scope,
      siteId: row.site_id ?? undefined,
      mcpProvider: row.mcp_provider ?? undefined,
      key: row.key,
      value: valueToStore,
      description: body.description === undefined ? (row.description ?? undefined) : body.description ?? undefined,
      isSecret: body.isSecret === undefined ? row.is_secret === 1 : body.isSecret,
      exposedToAi: body.exposedToAi === undefined ? row.exposed_to_ai === 1 : body.exposedToAi,
      createdBy: userId,
    });
    c.executionCtx.waitUntil(
      auditService.writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: userId ?? null,
        action: 'env_var.patch',
        message: `env var ${stored.key} patched`,
        target_type: 'ai_env_var',
        target_id: stored.id,
        metadata_json: {
          fields: Object.keys(body),
          scope: stored.scope,
          key: stored.key,
        },
        request_id: requestId,
      }),
    );
    return c.json({ var: stored });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'patch failed';
    return c.json(errorJson('VALIDATION_ERROR', msg, requestId), 400);
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /api/env-vars/:id
// ────────────────────────────────────────────────────────────
envVarsRoutes.delete('/api/env-vars/:id', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const requestId = c.get('requestId');
  if (!orgId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);

  const id = c.req.param('id');
  if (!id) return c.json(errorJson('BAD_REQUEST', 'id required', requestId), 400);

  try {
    const ok = await deleteEnvVar(c.env, orgId, id);
    if (!ok) return c.json(errorJson('NOT_FOUND', 'env var not found', requestId), 404);
    c.executionCtx.waitUntil(
      auditService.writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: userId ?? null,
        action: 'env_var.delete',
        message: `env var ${id} deleted`,
        target_type: 'ai_env_var',
        target_id: id,
        metadata_json: { id },
        request_id: requestId,
      }),
    );
    return c.json({ deleted: true });
  } catch (err) {
    return c.json(
      errorJson('INTERNAL_ERROR', err instanceof Error ? err.message : 'delete failed', requestId),
      500,
    );
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/env-vars/import
// ────────────────────────────────────────────────────────────
envVarsRoutes.post('/api/env-vars/import', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const requestId = c.get('requestId');
  if (!orgId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);

  let body: { scope?: EnvVarScope; siteId?: string; mcpProvider?: string; dotenv?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(errorJson('BAD_REQUEST', 'invalid JSON body', requestId), 400);
  }
  const scope = parseScope(body.scope);
  if (!scope) return c.json(errorJson('VALIDATION_ERROR', 'scope must be org|site|mcp', requestId), 400);
  if (typeof body.dotenv !== 'string') {
    return c.json(errorJson('VALIDATION_ERROR', 'dotenv (string) required', requestId), 400);
  }
  const pairs = parseDotenv(body.dotenv);
  if (pairs.length === 0) {
    return c.json({ imported: 0, failed: 0, errors: [] });
  }
  if (pairs.length > IMPORT_CAP) {
    return c.json(
      errorJson('PAYLOAD_TOO_LARGE', `import cap is ${IMPORT_CAP} vars per request`, requestId),
      413,
    );
  }

  let imported = 0;
  let failed = 0;
  const errors: { key: string; reason: string }[] = [];
  for (const { key, value } of pairs) {
    try {
      await setEnvVar(c.env, {
        orgId,
        scope,
        siteId: body.siteId,
        mcpProvider: body.mcpProvider,
        key,
        value,
        createdBy: userId,
      });
      imported++;
    } catch (err) {
      failed++;
      errors.push({ key, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId ?? null,
      action: 'env_var.import',
      message: `env var import: ${imported} ok / ${failed} failed`,
      target_type: 'ai_env_var',
      metadata_json: {
        scope,
        site_id: body.siteId ?? null,
        mcp_provider: body.mcpProvider ?? null,
        imported,
        failed,
      },
      request_id: requestId,
    }),
  );

  return c.json({ imported, failed, errors });
});

// ────────────────────────────────────────────────────────────
// GET /api/env-vars/export
// ────────────────────────────────────────────────────────────
envVarsRoutes.get('/api/env-vars/export', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const requestId = c.get('requestId');
  if (!orgId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);

  const scope = parseScope(c.req.query('scope'));
  const siteId = c.req.query('siteId') ?? c.req.query('site_id') ?? undefined;
  const mcpProvider = c.req.query('mcpProvider') ?? c.req.query('mcp_provider') ?? undefined;
  const includeValues = c.req.query('include_values') === '1';

  // Plaintext export requires org-owner role.
  if (includeValues) {
    if (!userId) return c.json(errorJson('UNAUTHORIZED', 'auth required', requestId), 401);
    const owner = await isOrgOwner(c.env, orgId, userId);
    if (!owner) {
      return c.json(errorJson('FORBIDDEN', 'org owner required for plaintext export', requestId), 403);
    }
  }

  let vars;
  try {
    vars = await listEnvVars(c.env, orgId, { scope, siteId, mcpProvider, unmask: includeValues });
  } catch (err) {
    return c.json(
      errorJson('INTERNAL_ERROR', err instanceof Error ? err.message : 'export failed', requestId),
      500,
    );
  }

  const now = new Date().toISOString();
  const header = [
    '# DO NOT COMMIT — projectsites.dev AI env var export',
    `# generated_at=${now}`,
    `# org_id=${orgId}`,
    `# scope=${scope ?? 'all'}`,
    siteId ? `# site_id=${siteId}` : null,
    mcpProvider ? `# mcp_provider=${mcpProvider}` : null,
    includeValues ? '# include_values=1 (plaintext)' : '# include_values=0 (values masked)',
    '',
  ].filter((line) => line !== null).join('\n');

  const body = vars
    .map((v) => {
      const valRaw = includeValues ? (v.value ?? '') : v.value_masked;
      const needsQuotes = /[\s"'#=]/.test(valRaw);
      const escaped = valRaw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const valOut = needsQuotes ? `"${escaped}"` : escaped;
      const prefix = v.description ? `# ${v.description.replace(/\n/g, ' ')}\n` : '';
      const scopeTag = `# scope=${v.scope}`
        + (v.site_id ? ` site_id=${v.site_id}` : '')
        + (v.mcp_provider ? ` mcp_provider=${v.mcp_provider}` : '')
        + ` exposed_to_ai=${v.exposed_to_ai ? '1' : '0'}`;
      return `${prefix}${scopeTag}\n${v.key}=${valOut}`;
    })
    .join('\n\n');

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId ?? null,
      action: 'env_var.export',
      message: `env var export (${vars.length} vars, values=${includeValues})`,
      target_type: 'ai_env_var',
      metadata_json: {
        scope: scope ?? null,
        site_id: siteId ?? null,
        mcp_provider: mcpProvider ?? null,
        include_values: includeValues,
        count: vars.length,
      },
      request_id: requestId,
    }),
  );

  return new Response(`${header}\n${body}\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
});
