/**
 * @module api.bolt-tabs.storage
 *
 * Cloudflare R2 browser proxy for the bolt.diy editor "Storage" tab.
 *
 * - `GET ?action=list-buckets` lists R2 buckets on the account.
 * - `GET ?bucket={b}&prefix={p}` lists objects in a bucket, optionally
 *   filtered by prefix.
 *
 * Soft-fails on missing R2 scope (returns 200 + `{ buckets: [], scope_warning }`)
 * so the UI can degrade gracefully when the token lacks R2 permissions.
 *
 * Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/storage?action=list-buckets'
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/storage?bucket=project-sites-production&prefix=sites/'
 */
import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

interface CfEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface CfResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

interface R2Bucket {
  name: string;
  creation_date?: string;
  location?: string;
  storage_class?: string;
}

interface R2BucketsResult {
  buckets?: R2Bucket[];
}

interface R2Object {
  key: string;
  size?: number;
  etag?: string;
  uploaded?: string;
  http_metadata?: { contentType?: string };
}

interface R2ObjectsResult {
  objects?: R2Object[];
  truncated?: boolean;
  cursor?: string | null;
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

async function cfFetch<T>(url: string, init: RequestInit, token: string): Promise<{ data: CfResponse<T>; status: number }> {
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
    const data = (await res.json().catch(() => ({ success: false, errors: [] }))) as CfResponse<T>;

    return { data, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function isScopeError(status: number, data: CfResponse<unknown>): boolean {
  if (status === 401 || status === 403) {
    return true;
  }

  const msg = (data.errors ?? []).map((e) => e.message).join(' ').toLowerCase();

  return msg.includes('not authorized') || msg.includes('scope') || msg.includes('permission');
}

export async function loader({ request, context }: LoaderFunctionArgs): Promise<Response> {
  const env = readEnv(context);
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return fail('missing_credentials', 'Cloudflare API token or account ID not configured', 401);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const bucket = url.searchParams.get('bucket');
  const prefix = url.searchParams.get('prefix') ?? '';

  try {
    if (action === 'list-buckets' || (!bucket && !action)) {
      const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/r2/buckets`;
      const { data, status } = await cfFetch<R2BucketsResult>(endpoint, { method: 'GET' }, token);

      if (!data.success) {
        if (isScopeError(status, data)) {
          return json({ buckets: [], scope_warning: 'API token lacks R2 read scope' });
        }

        const msg = data.errors?.[0]?.message ?? `Cloudflare API error: ${status}`;
        throw new Error(msg);
      }

      return json({ buckets: data.result?.buckets ?? [] });
    }

    if (!bucket) {
      return fail('missing_param', 'bucket query param is required', 400);
    }

    const params = new URLSearchParams({ per_page: '100' });

    if (prefix) {
      params.set('prefix', prefix);
    }

    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects?${params.toString()}`;
    const { data, status } = await cfFetch<R2ObjectsResult>(endpoint, { method: 'GET' }, token);

    if (!data.success) {
      if (isScopeError(status, data)) {
        return json({ bucket, prefix, objects: [], scope_warning: 'API token lacks R2 read scope' });
      }

      const msg = data.errors?.[0]?.message ?? `Cloudflare API error: ${status}`;
      throw new Error(msg);
    }

    return json({
      bucket,
      prefix,
      objects: data.result?.objects ?? [],
      truncated: data.result?.truncated ?? false,
      cursor: data.result?.cursor ?? null,
    });
  } catch (error) {
    console.warn('[api.bolt-tabs.storage] r2 fetch failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}
