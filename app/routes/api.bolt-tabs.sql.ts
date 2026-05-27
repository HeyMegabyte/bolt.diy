/**
 * @module api.bolt-tabs.sql
 *
 * Cloudflare D1 SQL console proxy for the bolt.diy editor "SQL" tab.
 *
 * - `GET ?account={a}` lists D1 databases for the account (defaults to
 *   `CLOUDFLARE_ACCOUNT_ID` env var).
 * - `POST { database_id, sql, params? }` executes a single query and returns
 *   the D1 query result.
 *
 * Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/sql'
 * curl -X POST 'https://editor.projectsites.dev/api/bolt-tabs/sql' \
 *   -H 'content-type: application/json' \
 *   -d '{"database_id":"abc","sql":"SELECT 1"}'
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';

interface CfEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface CfListResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

interface D1Database {
  uuid: string;
  name?: string;
  version?: string;
  created_at?: string;
  num_tables?: number;
  file_size?: number;
}

interface D1QueryResult {
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

const CF_API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;

function readEnv(context: unknown): CfEnv {
  const env = (context as { cloudflare?: { env?: CfEnv } } | undefined)?.cloudflare?.env ?? {};

  return env;
}

function fail(code: string, message: string, status: number): Response {
  const body: ErrorEnvelope = { error: { code, message } };

  return json(body, { status });
}

async function cfFetch<T>(url: string, init: RequestInit, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json()) as CfListResponse<T>;

    if (!res.ok || !data.success) {
      const msg = data.errors?.[0]?.message ?? `Cloudflare API error: ${res.status}`;
      throw new Error(msg);
    }

    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loader({ request, context }: LoaderFunctionArgs): Promise<Response> {
  const env = readEnv(context);
  const token = env.CLOUDFLARE_API_TOKEN;
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account') || env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return fail('missing_credentials', 'Cloudflare API token or account ID not configured', 401);
  }

  try {
    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/d1/database?per_page=50`;
    const databases = await cfFetch<D1Database[]>(endpoint, { method: 'GET' }, token);

    return json({ account: accountId, databases });
  } catch (error) {
    console.warn('[api.bolt-tabs.sql] list databases failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}

export async function action({ request, context }: ActionFunctionArgs): Promise<Response> {
  if (request.method !== 'POST') {
    return fail('method_not_allowed', `Method ${request.method} not allowed`, 405);
  }

  const env = readEnv(context);
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return fail('missing_credentials', 'Cloudflare API token or account ID not configured', 401);
  }

  let body: { database_id?: string; sql?: string; params?: unknown[] };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('invalid_json', 'Request body must be valid JSON', 400);
  }

  const { database_id: databaseId, sql, params } = body;

  if (!databaseId || !sql) {
    return fail('invalid_params', 'database_id and sql are required', 400);
  }

  try {
    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
    const result = await cfFetch<D1QueryResult[]>(
      endpoint,
      {
        method: 'POST',
        body: JSON.stringify({ sql, params: Array.isArray(params) ? params : [] }),
      },
      token,
    );

    return json({ database_id: databaseId, result });
  } catch (error) {
    console.warn('[api.bolt-tabs.sql] query failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}
