/**
 * @module api.bolt-tabs.logs
 *
 * Cloudflare Workers Tail proxy for the bolt.diy editor "Logs" tab.
 *
 * - `GET ?project={project}` creates (or refreshes) a tail session for the
 *   given Worker script and returns the list of active tail tokens. Recent
 *   log lines are not buffered server-side; the client connects directly to
 *   the tail WebSocket using the returned token.
 *
 * Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/logs?project=project-sites'
 */
import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

interface CfEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface TailRecord {
  id: string;
  url?: string;
  expires_at?: string;
}

interface CfListResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
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
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    return fail('missing_credentials', 'Cloudflare API token or account ID not configured', 401);
  }

  const url = new URL(request.url);
  const project = url.searchParams.get('project');

  if (!project) {
    return fail('missing_param', 'project query param is required', 400);
  }

  const base = `${CF_API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(project)}/tails`;

  try {
    // List existing tails first; if none, create one.
    let tails: TailRecord[] = [];

    try {
      tails = await cfFetch<TailRecord[]>(base, { method: 'GET' }, token);
    } catch (listError) {
      console.warn('[api.bolt-tabs.logs] list tails failed, attempting create', listError);
    }

    if (!Array.isArray(tails) || tails.length === 0) {
      const created = await cfFetch<TailRecord>(base, { method: 'POST', body: '{}' }, token);
      tails = [created];
    }

    return json({
      project,
      tails: tails.map((t) => ({
        id: t.id,
        url: t.url,
        expires_at: t.expires_at,
      })),
      note: 'Connect to the tail WebSocket URL for live logs. Server-side buffering is not enabled.',
    });
  } catch (error) {
    console.warn('[api.bolt-tabs.logs] tail provisioning failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}
