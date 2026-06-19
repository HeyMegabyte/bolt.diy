/**
 * @module services/neon_provisioner
 *
 * @description
 * Thin wrapper around the Neon REST API used by the Apps tab provisioner.
 * Creates per-instance Postgres projects on demand and tears them down on
 * destroy. All Neon objects we create live under the user-supplied
 * `NEON_API_KEY` so billing flows to the operator's Neon account, not ours.
 *
 * ## API
 *
 *  - `createProject(env, name)` → `{ projectId, connectionString }`
 *  - `deleteProject(env, projectId)` → `void`
 *
 * ## Missing key surface
 *
 * If `env.NEON_API_KEY` is absent we throw a structured `MissingNeonKeyError`
 * carrying the exact deeplink to mint a token. The route layer surfaces this
 * as `{ error: 'missing_env', service: 'neon', deeplink }` so the UI can
 * render a clickable CTA.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const NEON_DEEPLINK = 'https://console.neon.tech/app/settings/api-keys';

export interface NeonProvisionResult {
  readonly projectId: string;
  readonly connectionString: string;
  /**
   * The POOLED (PgBouncer) connection string — connections share a small
   * upstream pool, so many tenants/containers on one Neon instance don't exhaust
   * it. Opt-in per app: Neon's pooler is transaction-mode, so apps that need
   * session features (LISTEN/NOTIFY, advisory locks, cross-tx prepared
   * statements) must use {@link connectionString} (direct) instead.
   */
  readonly pooledConnectionString: string;
  readonly host: string;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export class MissingNeonKeyError extends Error {
  readonly code = 'missing_env';
  readonly service = 'neon';
  readonly deeplink = NEON_DEEPLINK;
  constructor() {
    super(
      `NEON_API_KEY is not configured. Mint a token at ${NEON_DEEPLINK} and run \`wrangler secret put NEON_API_KEY --env production\`.`,
    );
  }
}

function neonKey(env: Env): string {
  const raw = (env as unknown as { NEON_API_KEY?: string }).NEON_API_KEY;
  if (!raw || raw.trim().length === 0) throw new MissingNeonKeyError();
  return raw.trim();
}

interface NeonCreateProjectResponse {
  project?: { id: string };
  connection_uris?: Array<{ connection_uri: string }>;
  roles?: Array<{ name: string; password?: string }>;
  databases?: Array<{ name: string }>;
}

function parsePostgresUri(uri: string): {
  host: string;
  database: string;
  user: string;
  password: string;
} {
  // postgres://user:pass@host:port/db?sslmode=require
  const m = uri.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\/([^?]+)/);
  if (!m) {
    return { host: '', database: '', user: '', password: '' };
  }
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    database: m[4],
  };
}

/**
 * Convert a Neon connection string to its POOLED (PgBouncer) endpoint by
 * inserting `-pooler` into the endpoint id:
 *   ...@ep-cool-name-123.us-east-2.aws.neon.tech/db
 *   → ...@ep-cool-name-123-pooler.us-east-2.aws.neon.tech/db
 *
 * Pooling is how container apps share one Neon instance without exhausting
 * connections — the viable substitute for Cloudflare Hyperdrive, which is
 * Worker-binding-scoped and unreachable from a container connecting to Postgres
 * directly (see `docs/architecture/scale-to-zero-apps-routing.md` § Phase 3).
 *
 * Pure + idempotent: never double-inserts `-pooler`; preserves user/pass/port/
 * db/query; returns the input unchanged when it isn't a parseable postgres URI.
 *
 * @example
 * toPooledConnectionString('postgres://u:p@ep-x-1.us-east-2.aws.neon.tech/db?sslmode=require')
 * // → 'postgres://u:p@ep-x-1-pooler.us-east-2.aws.neon.tech/db?sslmode=require'
 */
export function toPooledConnectionString(uri: string): string {
  const m = uri.match(/^(postgres(?:ql)?:\/\/[^@]+@)([^/?]+)(.*)$/);
  if (!m) return uri;
  const [, prefix, hostPort, rest] = m;
  const [host, port] = hostPort.split(':');
  const dot = host.indexOf('.');
  const firstSeg = dot === -1 ? host : host.slice(0, dot);
  const tail = dot === -1 ? '' : host.slice(dot);
  if (firstSeg.endsWith('-pooler')) return uri; // already pooled — idempotent
  const pooledHost = `${firstSeg}-pooler${tail}`;
  return `${prefix}${pooledHost}${port ? `:${port}` : ''}${rest}`;
}

/**
 * Create a new Neon project + default branch + role + database. Returns the
 * resolved connection URI plus its parsed components for env-var sharding.
 */
export async function createProject(env: Env, name: string): Promise<NeonProvisionResult> {
  const key = neonKey(env);
  const res = await fetch(`${NEON_API_BASE}/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      project: {
        name: name.slice(0, 64),
        // Cheapest free-tier defaults; the operator can upgrade in the Neon
        // dashboard if they need higher limits.
        pg_version: 16,
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as NeonCreateProjectResponse & {
    message?: string;
  };
  if (!res.ok || !json.project?.id) {
    throw new Error(
      `Neon createProject failed: ${res.status} ${json.message ?? JSON.stringify(json).slice(0, 200)}`,
    );
  }
  const uri = json.connection_uris?.[0]?.connection_uri ?? '';
  const parts = parsePostgresUri(uri);
  return {
    projectId: json.project.id,
    connectionString: uri,
    pooledConnectionString: toPooledConnectionString(uri),
    host: parts.host,
    database: parts.database || 'neondb',
    user: parts.user || json.roles?.[0]?.name || '',
    password: parts.password || json.roles?.[0]?.password || '',
  };
}

/**
 * Hard-delete a Neon project. Used by the instance-destroy flow to avoid
 * orphaned billing. Idempotent — a 404 is treated as success.
 */
export async function deleteProject(env: Env, projectId: string): Promise<void> {
  const key = neonKey(env);
  const res = await fetch(`${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Neon deleteProject failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
