/**
 * @module api.bolt-tabs.kv
 *
 * Cloudflare KV browser proxy for the bolt.diy editor "KV" tab.
 *
 * - `GET ?action=list-namespaces` lists KV namespaces.
 * - `GET ?namespace={id}&prefix={p}` lists keys (prefix optional).
 * - `GET ?namespace={id}&key={k}` reads a single key's value.
 * - `POST { namespace, key, value, ttl? }` writes a key.
 *
 * Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/kv?action=list-namespaces'
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/kv?namespace=abc&prefix=site:'
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/kv?namespace=abc&key=site:home'
 * curl -X POST 'https://editor.projectsites.dev/api/bolt-tabs/kv' \
 *   -H 'content-type: application/json' \
 *   -d '{"namespace":"abc","key":"hello","value":"world","ttl":3600}'
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';

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

interface KvNamespace {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

interface KvKey {
  name: string;
  expiration?: number;
  metadata?: Record<string, unknown>;
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

interface CfFetchOptions {
  json?: boolean;
}

async function cfFetchJson<T>(
  url: string,
  init: RequestInit,
  token: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json()) as CfResponse<T>;

    if (!res.ok || !data.success) {
      const msg = data.errors?.[0]?.message ?? `Cloudflare API error: ${res.status}`;
      throw new Error(msg);
    }

    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function cfFetchRaw(url: string, init: RequestInit, token: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const body = await res.text();

    if (!res.ok) {
      throw new Error(`Cloudflare API error: ${res.status} ${res.statusText}`);
    }

    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
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
  const namespace = url.searchParams.get('namespace');
  const key = url.searchParams.get('key');
  const prefix = url.searchParams.get('prefix') ?? '';

  try {
    if (action === 'list-namespaces' || (!namespace && !action)) {
      const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces?per_page=100`;
      const namespaces = await cfFetchJson<KvNamespace[]>(endpoint, { method: 'GET' }, token);

      return json({ namespaces });
    }

    if (!namespace) {
      return fail('missing_param', 'namespace query param is required', 400);
    }

    if (key) {
      const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespace)}/values/${encodeURIComponent(key)}`;
      const { body } = await cfFetchRaw(endpoint, { method: 'GET' }, token);

      return json({ namespace, key, value: body });
    }

    const params = new URLSearchParams({ limit: '100' });

    if (prefix) {
      params.set('prefix', prefix);
    }

    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespace)}/keys?${params.toString()}`;
    const keys = await cfFetchJson<KvKey[]>(endpoint, { method: 'GET' }, token);

    return json({ namespace, prefix, keys });
  } catch (error) {
    console.warn('[api.bolt-tabs.kv] read failed', error);

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

  let body: { namespace?: string; key?: string; value?: string; ttl?: number };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('invalid_json', 'Request body must be valid JSON', 400);
  }

  const { namespace, key, value, ttl } = body;

  if (!namespace || !key || typeof value !== 'string') {
    return fail('invalid_params', 'namespace, key, and value (string) are required', 400);
  }

  try {
    const params = new URLSearchParams();

    if (typeof ttl === 'number' && ttl > 0) {
      params.set('expiration_ttl', String(ttl));
    }

    const qs = params.toString();
    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespace)}/values/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;
    const { status } = await cfFetchRaw(
      endpoint,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: value,
      },
      token,
    );

    return json({ namespace, key, written: true, status });
  } catch (error) {
    console.warn('[api.bolt-tabs.kv] write failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}
