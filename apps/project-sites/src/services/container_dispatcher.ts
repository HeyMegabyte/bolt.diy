/**
 * @module services/container_dispatcher
 *
 * @description
 * Dispatcher routing app-lifecycle calls from the worker → the per-instance
 * `AppRuntimeContainer` Durable Object. Sits between `routes/apps.ts`
 * (HTTP) and the DO (HTTP-over-RPC via `stub.fetch`).
 *
 * ## Contract
 *
 * Every lifecycle function returns `{ ok: boolean; detail?: string }` so
 * the route layer can persist `status='starting'|'error'` without caring
 * about transport details. When `env.APP_RUNTIME` is missing (e.g. preview
 * deploys before the binding is added) every call degrades to a logged
 * no-op so the API surface stays usable.
 *
 * Once the AppRuntimeContainer DO is bound, requests are dispatched via
 * `binding.idFromName(instanceId).get().fetch(...)` matching the URLs the
 * DO exposes (`/start`, `/stop`, `/restart`, `/logs`, `/logs/stream`,
 * `/status`, `/proxy/*`).
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

/** Payload sent to the Container DO when starting an instance. */
export interface StartContainerOptions {
  readonly instanceId: string;
  readonly image: string;
  readonly port: number;
  readonly memoryMB: number;
  readonly env: Record<string, string>;
  readonly volumeMB?: number;
  readonly entrypoint?: readonly string[];
  /**
   * Catalog slug — drives the per-image binding lookup. When the slug is one
   * of the supported top-10, the dispatcher routes to the dedicated
   * `APP_RUNTIME_*` binding (which boots the real upstream image). Otherwise
   * falls back to the generic `APP_RUNTIME` "coming soon" placeholder.
   */
  readonly appSlug?: string;
}

/**
 * Catalog-slug → DO-binding-name map. Kept in lockstep with
 * `src/durable_objects/app_runtime_subclasses.ts` + the
 * `[[env.production.durable_objects.bindings]]` entries in wrangler.toml.
 */
const BINDING_BY_SLUG: Readonly<Record<string, keyof Env>> = {
  umami: 'APP_RUNTIME_UMAMI',
  outline: 'APP_RUNTIME_OUTLINE',
  n8n: 'APP_RUNTIME_N8N',
  vaultwarden: 'APP_RUNTIME_VAULTWARDEN',
  'uptime-kuma': 'APP_RUNTIME_UPTIME_KUMA',
  nocodb: 'APP_RUNTIME_NOCODB',
  listmonk: 'APP_RUNTIME_LISTMONK',
  memos: 'APP_RUNTIME_MEMOS',
  pocketbase: 'APP_RUNTIME_POCKETBASE',
  'open-webui': 'APP_RUNTIME_OPEN_WEBUI',
};

/** Status snapshot mirror — kept loose so older DO versions stay compatible. */
export interface ContainerStatus {
  readonly state: 'idle' | 'booting' | 'running' | 'crashed' | 'stopped';
  readonly uptime_seconds: number;
  readonly memory_mb_used: number;
  readonly last_error?: string;
  readonly restart_count?: number;
  readonly image?: string;
}

/** Stub binding shape — matches the runtime `env.APP_RUNTIME` namespace. */
interface AppRuntimeBinding {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
  };
}

/**
 * Resolve the DO binding for a given catalog slug. Returns the per-image
 * binding when the slug is supported AND the binding is wired in
 * wrangler.toml; otherwise falls back to the generic `APP_RUNTIME`
 * placeholder. Returns `null` only when no binding at all is present
 * (preview deploys before the first migration tag is applied).
 */
function getBinding(env: Env, appSlug?: string): AppRuntimeBinding | null {
  const envAny = env as unknown as Record<string, AppRuntimeBinding | undefined>;
  if (appSlug) {
    const bindingKey = BINDING_BY_SLUG[appSlug];
    if (bindingKey) {
      const perImage = envAny[bindingKey as string];
      if (perImage) return perImage;
    }
  }
  const generic = envAny.APP_RUNTIME;
  return generic ?? null;
}

function logWarn(action: string, instanceId: string, extra: Record<string, unknown> = {}): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      service: 'container_dispatcher',
      action,
      instance_id: instanceId,
      ...extra,
    }),
  );
}

async function callDo(
  env: Env,
  instanceId: string,
  path: string,
  init: RequestInit = {},
  appSlug?: string,
): Promise<{ ok: boolean; detail?: string; body?: unknown }> {
  const binding = getBinding(env, appSlug);
  if (!binding) {
    logWarn('binding_missing', instanceId, { path, app_slug: appSlug });
    return { ok: true, detail: 'stub_no_op' };
  }
  try {
    const id = binding.idFromName(instanceId);
    const stub = binding.get(id);
    const res = await stub.fetch(`https://app-runtime${path}`, init);
    let body: unknown = undefined;
    try {
      body = await res.clone().json();
    } catch {
      // non-JSON response (e.g. SSE) — fall through.
    }
    if (!res.ok) {
      const detail = typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `status_${res.status}`;
      logWarn('do_call_failed', instanceId, { path, status: res.status, detail });
      return { ok: false, detail, body };
    }
    return { ok: true, body };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'dispatch_failed';
    logWarn('do_call_threw', instanceId, { path, detail });
    return { ok: false, detail };
  }
}

// ── Public API ────────────────────────────────────────────────────────

/** Boot (or first-start) a container instance. Idempotent. */
export async function startContainer(
  env: Env,
  opts: StartContainerOptions,
): Promise<{ ok: boolean; detail?: string }> {
  return callDo(
    env,
    opts.instanceId,
    '/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: opts.image,
        port: opts.port,
        env: opts.env,
        volumeMB: opts.volumeMB,
        entrypoint: opts.entrypoint,
      }),
    },
    opts.appSlug,
  );
}

/** Graceful container stop (SIGTERM). Safe when already stopped. */
export async function stopContainer(
  env: Env,
  instanceId: string,
  appSlug?: string,
): Promise<{ ok: boolean; detail?: string }> {
  return callDo(env, instanceId, '/stop', { method: 'POST' }, appSlug);
}

/** Stop + start with the persisted opts. */
export async function restartContainer(
  env: Env,
  instanceId: string,
  appSlug?: string,
): Promise<{ ok: boolean; detail?: string }> {
  return callDo(env, instanceId, '/restart', { method: 'POST' }, appSlug);
}

/** Permanently tear down the container; DO storage (logs) survives. */
export async function destroyContainer(
  env: Env,
  instanceId: string,
  appSlug?: string,
): Promise<{ ok: boolean; detail?: string }> {
  // No dedicated DO endpoint — stop is sufficient. The DO row gets soft-
  // deleted by the caller, and CFC cleans the container on the next sweep.
  return stopContainer(env, instanceId, appSlug);
}

/** Fetch the last-N log lines as a JSON list. */
export async function getContainerLogs(
  env: Env,
  instanceId: string,
  tail = 100,
  appSlug?: string,
): Promise<{ ok: boolean; lines?: Array<{ ts: number; stream: string; line: string }>; detail?: string }> {
  const binding = getBinding(env, appSlug);
  if (!binding) {
    logWarn('binding_missing', instanceId, { path: '/logs', app_slug: appSlug });
    return { ok: true, lines: [] };
  }
  try {
    const id = binding.idFromName(instanceId);
    const stub = binding.get(id);
    const res = await stub.fetch(
      `https://app-runtime/logs?tail=${encodeURIComponent(String(tail))}`,
      { method: 'GET' },
    );
    if (!res.ok) return { ok: false, detail: `status_${res.status}` };
    const body = (await res.json()) as { lines?: Array<{ ts: number; stream: string; line: string }> };
    return { ok: true, lines: body.lines ?? [] };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'dispatch_failed' };
  }
}

/**
 * Stream SSE log lines straight from the DO. When the DO binding is
 * missing we emit a single `info` event so the EventSource client gets
 * a deterministic message instead of hanging.
 */
export async function tailContainerLogs(
  env: Env,
  instanceId: string,
  tail: number,
  appSlug?: string,
): Promise<Response> {
  const binding = getBinding(env, appSlug);
  if (!binding) {
    const body = `event: info\ndata: ${JSON.stringify({
      message: 'APP_RUNTIME binding not yet provisioned; logs unavailable.',
      instanceId,
    })}\n\n`;
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
  const id = binding.idFromName(instanceId);
  const stub = binding.get(id);
  // First, surface the current tail (the DO /logs/stream endpoint already
  // emits the tail as initial SSE events, so we just forward).
  return stub.fetch(`https://app-runtime/logs/stream?tail=${tail}`, { method: 'GET' });
}

/** Status snapshot used by `/api/apps/instances/:id/health`. */
export async function getContainerStatus(
  env: Env,
  instanceId: string,
  appSlug?: string,
): Promise<{ ok: boolean; status?: ContainerStatus; detail?: string }> {
  const r = await callDo(env, instanceId, '/status', { method: 'GET' }, appSlug);
  if (!r.ok) return { ok: false, detail: r.detail };
  return { ok: true, status: r.body as ContainerStatus };
}

/**
 * Proxy an inbound HTTP request to the container's `port`. The `appSlug`
 * routes to the per-image DO binding that's bound to the right upstream
 * image (Umami / Outline / n8n / etc.). When `appSlug` is missing or not
 * in the supported set we fall back to the generic `APP_RUNTIME`
 * placeholder image which serves the "coming soon" interstitial.
 */
export async function proxyToContainer(
  env: Env,
  instanceId: string,
  request: Request,
  appSlug?: string,
): Promise<Response> {
  const binding = getBinding(env, appSlug);
  if (!binding) {
    return new Response('App container runtime not yet available.', { status: 503 });
  }
  const id = binding.idFromName(instanceId);
  const stub = binding.get(id);
  // Forward the request as-is — the DO's default fetch handler proxies
  // straight to the container port.
  return stub.fetch(request);
}
