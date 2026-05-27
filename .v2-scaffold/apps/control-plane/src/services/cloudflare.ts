/**
 * Cloudflare API wrapper — D1 provisioning, Custom Hostname attach, Workers binding
 * inheritance. Used by /sites/from-search to spin a per-tenant D1 + bind to the
 * tenant-runtime Worker template.
 */

import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
}

function cfHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    'content-type': 'application/json',
  };
}

async function cfFetch<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...cfHeaders(env), ...(init.headers ?? {}) },
  });
  const json = (await res.json()) as CfResponse<T>;
  if (!res.ok || !json.success) {
    throw new AppError(
      ErrorCode.DOMAIN_PROVISIONING_ERROR,
      `Cloudflare API ${path} failed: ${JSON.stringify(json.errors)}`,
    );
  }
  return json.result;
}

export interface D1Provision {
  id: string;
  name: string;
  created_at: string;
}

/** Create a new D1 database for a tenant site. */
export async function provisionTenantD1(
  env: Env,
  args: { databaseName: string },
): Promise<D1Provision> {
  return cfFetch<D1Provision>(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: args.databaseName }),
  });
}

export interface CustomHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status: string };
}

/** Attach a custom hostname via Cloudflare for SaaS. */
export async function attachCustomHostname(
  env: Env,
  args: { hostname: string },
): Promise<CustomHostname> {
  return cfFetch<CustomHostname>(
    env,
    `/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames`,
    {
      method: 'POST',
      body: JSON.stringify({
        hostname: args.hostname,
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
      }),
    },
  );
}

/** Detach a custom hostname. */
export async function detachCustomHostname(
  env: Env,
  args: { cfHostnameId: string },
): Promise<void> {
  await cfFetch(
    env,
    `/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${args.cfHostnameId}`,
    { method: 'DELETE' },
  );
}

/** Read the latest status of a custom hostname (for polling). */
export async function readCustomHostname(
  env: Env,
  args: { cfHostnameId: string },
): Promise<CustomHostname> {
  return cfFetch<CustomHostname>(
    env,
    `/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${args.cfHostnameId}`,
  );
}
