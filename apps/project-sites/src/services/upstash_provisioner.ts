/**
 * @module services/upstash_provisioner
 *
 * @description
 * Thin wrapper around the Upstash Redis REST API used by the Apps tab
 * provisioner. Creates per-instance Redis databases on demand and tears
 * them down on destroy.
 *
 * Auth uses HTTP Basic with `UPSTASH_EMAIL:UPSTASH_API_KEY`.
 *
 * ## Missing key surface
 *
 * If either credential is absent we throw `MissingUpstashKeyError` carrying
 * the deeplink. The route layer surfaces this as
 * `{ error: 'missing_env', service: 'upstash', deeplink }`.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

const UPSTASH_API_BASE = 'https://api.upstash.com/v2';
const UPSTASH_DEEPLINK = 'https://console.upstash.com/account/api';

export interface UpstashProvisionResult {
  readonly databaseId: string;
  readonly restUrl: string;
  readonly restToken: string;
  readonly redisUrl: string;
}

export class MissingUpstashKeyError extends Error {
  readonly code = 'missing_env';
  readonly service = 'upstash';
  readonly deeplink = UPSTASH_DEEPLINK;
  constructor() {
    super(
      `UPSTASH_EMAIL + UPSTASH_API_KEY are not configured. Mint a key at ${UPSTASH_DEEPLINK} then \`wrangler secret put UPSTASH_API_KEY --env production\` + \`wrangler secret put UPSTASH_EMAIL --env production\`.`,
    );
  }
}

function upstashAuthHeader(env: Env): string {
  const email = (env as unknown as { UPSTASH_EMAIL?: string }).UPSTASH_EMAIL;
  const key = (env as unknown as { UPSTASH_API_KEY?: string }).UPSTASH_API_KEY;
  if (!email || !key) throw new MissingUpstashKeyError();
  return `Basic ${btoa(`${email.trim()}:${key.trim()}`)}`;
}

interface UpstashCreateDbResponse {
  database_id?: string;
  endpoint?: string;
  port?: number;
  password?: string;
  rest_token?: string;
  message?: string;
}

/**
 * Provision a new Upstash Redis database in the requested region. Returns
 * both the REST URL/token (used by Cloudflare-style clients) and the
 * native `redis://` connection string for apps that speak the binary
 * protocol.
 */
export async function createDatabase(
  env: Env,
  name: string,
  region: string = 'us-east-1',
): Promise<UpstashProvisionResult> {
  const auth = upstashAuthHeader(env);
  const res = await fetch(`${UPSTASH_API_BASE}/redis/database`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      name: name.slice(0, 32),
      region,
      tls: true,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as UpstashCreateDbResponse;
  if (!res.ok || !json.database_id) {
    throw new Error(`Upstash createDatabase failed: ${res.status} ${json.message ?? JSON.stringify(json).slice(0, 200)}`);
  }
  const endpoint = json.endpoint ?? '';
  const port = json.port ?? 6379;
  const password = json.password ?? '';
  return {
    databaseId: json.database_id,
    restUrl: `https://${endpoint}`,
    restToken: json.rest_token ?? password,
    redisUrl: `rediss://default:${encodeURIComponent(password)}@${endpoint}:${port}`,
  };
}

/**
 * Hard-delete an Upstash Redis database. Idempotent — a 404 is treated as
 * success.
 */
export async function deleteDatabase(env: Env, databaseId: string): Promise<void> {
  const auth = upstashAuthHeader(env);
  const res = await fetch(`${UPSTASH_API_BASE}/redis/database/${encodeURIComponent(databaseId)}`, {
    method: 'DELETE',
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`Upstash deleteDatabase failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
