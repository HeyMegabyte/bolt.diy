/**
 * @module api.bolt-tabs.cicd
 *
 * GitHub Actions workflow-run proxy for the bolt.diy editor "CI/CD" tab.
 *
 * - `GET ?owner={o}&repo={r}` lists the last 20 workflow runs.
 * - `POST { owner, repo, workflow_run_id, action: 're-run' | 'cancel' }`
 *   re-runs or cancels a workflow run.
 *
 * Requires `GITHUB_TOKEN` on `context.cloudflare.env`.
 *
 * @example
 * curl 'https://editor.projectsites.dev/api/bolt-tabs/cicd?owner=stackblitz&repo=bolt.new'
 * curl -X POST 'https://editor.projectsites.dev/api/bolt-tabs/cicd' \
 *   -H 'content-type: application/json' \
 *   -d '{"owner":"stackblitz","repo":"bolt.new","workflow_run_id":12345,"action":"re-run"}'
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';

interface CiCdEnv {
  GITHUB_TOKEN?: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface WorkflowRun {
  id: number;
  name?: string | null;
  display_title?: string;
  head_branch?: string | null;
  head_sha?: string;
  status?: string | null;
  conclusion?: string | null;
  run_number?: number;
  event?: string;
  workflow_id?: number;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string;
  html_url?: string;
  actor?: { login?: string; avatar_url?: string };
}

interface RunsListResponse {
  total_count?: number;
  workflow_runs?: WorkflowRun[];
}

const GH_API = 'https://api.github.com';
const TIMEOUT_MS = 30_000;

function readEnv(context: unknown): CiCdEnv {
  const env = (context as { cloudflare?: { env?: CiCdEnv } } | undefined)?.cloudflare?.env ?? {};

  return env;
}

function fail(code: string, message: string, status: number): Response {
  const body: ErrorEnvelope = { error: { code, message } };

  return json(body, { status });
}

async function ghFetch<T>(url: string, init: RequestInit, token: string): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'bolt.diy-editor',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 204) {
      return { status: res.status, body: null };
    }

    const body = (await res.json().catch(() => null)) as T | null;

    if (!res.ok) {
      const msg =
        (body as { message?: string } | null)?.message ?? `GitHub API error: ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function loader({ request, context }: LoaderFunctionArgs): Promise<Response> {
  const env = readEnv(context);
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return fail('missing_credentials', 'GitHub token not configured', 401);
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get('owner');
  const repo = url.searchParams.get('repo');

  if (!owner || !repo) {
    return fail('missing_param', 'owner and repo query params are required', 400);
  }

  try {
    const endpoint = `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=20`;
    const { body } = await ghFetch<RunsListResponse>(endpoint, { method: 'GET' }, token);

    return json({
      owner,
      repo,
      total_count: body?.total_count ?? 0,
      workflow_runs: body?.workflow_runs ?? [],
    });
  } catch (error) {
    console.warn('[api.bolt-tabs.cicd] list failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('github_error', message, 502);
  }
}

export async function action({ request, context }: ActionFunctionArgs): Promise<Response> {
  if (request.method !== 'POST') {
    return fail('method_not_allowed', `Method ${request.method} not allowed`, 405);
  }

  const env = readEnv(context);
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return fail('missing_credentials', 'GitHub token not configured', 401);
  }

  let body: { owner?: string; repo?: string; workflow_run_id?: number | string; action?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('invalid_json', 'Request body must be valid JSON', 400);
  }

  const { owner, repo, workflow_run_id: runId, action: cmd } = body;

  if (!owner || !repo || !runId || (cmd !== 're-run' && cmd !== 'cancel')) {
    return fail(
      'invalid_params',
      'owner, repo, workflow_run_id, and action="re-run"|"cancel" are required',
      400,
    );
  }

  try {
    const path = cmd === 're-run' ? 'rerun' : 'cancel';
    const endpoint = `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(String(runId))}/${path}`;
    const { status } = await ghFetch<unknown>(endpoint, { method: 'POST' }, token);

    return json({ owner, repo, workflow_run_id: runId, action: cmd, status });
  } catch (error) {
    console.warn('[api.bolt-tabs.cicd] action failed', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return fail('github_error', message, 502);
  }
}
