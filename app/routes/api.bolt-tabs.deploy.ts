/**
 * @module api.bolt-tabs.deploy
 *
 * Cloudflare Pages deployments proxy for the bolt.diy editor "Deploy" tab.
 *
 * - `GET ?project={projectName}` lists the last 20 deployments for a Pages project.
 * - `POST { deployment_id, action: 'rollback' }` rolls back to a prior deployment.
 *
 * Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/deploy?project=bolt-diy'
 * curl -X POST 'https://editor.projectsites.dev/api/bolt-tabs/deploy' \
 *   -H 'content-type: application/json' \
 *   -d '{"project":"bolt-diy","deployment_id":"abc","action":"rollback"}'
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';

interface CfEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface CfDeployment {
  id: string;
  short_id?: string;
  project_name?: string;
  environment?: string;
  url?: string;
  created_on?: string;
  modified_on?: string;
  latest_stage?: { name?: string; status?: string; ended_on?: string | null };
  deployment_trigger?: { type?: string; metadata?: Record<string, unknown> };
  source?: { type?: string; config?: Record<string, unknown> };
  aliases?: string[] | null;
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

  try {
    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}/deployments?per_page=20`;
    const deployments = await cfFetch<CfDeployment[]>(endpoint, { method: 'GET' }, token);

    return json({ project, deployments: deployments.slice(0, 20) });
  } catch (error) {
    console.warn('[api.bolt-tabs.deploy] list failed', error);

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

  let body: { project?: string; deployment_id?: string; action?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('invalid_json', 'Request body must be valid JSON', 400);
  }

  const { project, deployment_id: deploymentId, action: cmd } = body;

  if (!project || !deploymentId || cmd !== 'rollback') {
    return fail('invalid_params', 'project, deployment_id, and action="rollback" are required', 400);
  }

  try {
    const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}/deployments/${encodeURIComponent(deploymentId)}/rollback`;
    const result = await cfFetch<CfDeployment>(endpoint, { method: 'POST' }, token);

    return json({ project, rollback: result });
  } catch (error) {
    console.warn('[api.bolt-tabs.deploy] rollback failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('cloudflare_error', message, 502);
  }
}
