/**
 * Unit coverage for the container dispatcher
 * (`src/services/container_dispatcher.ts`) — the routing layer between the
 * worker's `routes/apps.ts` HTTP handlers and the per-instance
 * `AppRuntimeContainer` Durable Object.
 *
 * Strategy: NOT Miniflare. The dispatcher is a pure-function module whose only
 * runtime dependency is the DO binding namespace shape
 * (`idFromName` → `get` → `fetch`). We hand-roll a `FakeBinding` that records
 * the URL + init each `stub.fetch` receives and returns a controllable
 * `Response`, then assert the EXTRACTABLE LOGIC directly: per-slug binding
 * selection (`BINDING_BY_SLUG` → `APP_RUNTIME_*` vs generic `APP_RUNTIME`),
 * stub URL + method + body mapping per lifecycle endpoint, JSON / non-JSON
 * response handling, error + non-ok + throw paths, the missing-binding
 * stub-no-op degradation, SSE log streaming, status snapshot mapping, and the
 * raw proxy forward. The real container plumbing (the DO's own fetch handler)
 * is out of scope — that part is genuinely Miniflare-only.
 */

import {
  startContainer,
  stopContainer,
  restartContainer,
  destroyContainer,
  getContainerLogs,
  tailContainerLogs,
  getContainerStatus,
  proxyToContainer,
  type StartContainerOptions,
  type ContainerStatus,
} from '../services/container_dispatcher.js';
import type { Env } from '../types/env.js';

// ── DO binding double ──────────────────────────────────────────────────────
//
// Mirrors the `idFromName(name) → get(id) → fetch(req, init)` shape of the
// runtime `env.APP_RUNTIME` namespace. Records every fetch so we can assert
// the dispatcher built the right URL + init, and lets each test drive the
// Response the stub returns (or make fetch throw).

interface FetchCall {
  input: Request | string;
  init?: RequestInit;
}

class FakeBinding {
  readonly idCalls: string[] = [];
  readonly fetchCalls: FetchCall[] = [];
  responder: (call: FetchCall) => Response | Promise<Response>;

  constructor(responder?: (call: FetchCall) => Response | Promise<Response>) {
    this.responder = responder ?? (() => new Response('{}', { status: 200 }));
  }

  idFromName = jest.fn((name: string) => {
    this.idCalls.push(name);
    return { name } as unknown as DurableObjectId;
  });

  get = jest.fn((_id: DurableObjectId) => ({
    fetch: jest.fn((input: Request | string, init?: RequestInit) => {
      const call: FetchCall = { input, init };
      this.fetchCalls.push(call);
      return Promise.resolve(this.responder(call));
    }),
  }));

  /** URL string of the most recent fetch. */
  lastUrl(): string {
    const c = this.fetchCalls[this.fetchCalls.length - 1];
    return typeof c.input === 'string' ? c.input : c.input.url;
  }
}

function makeEnv(bindings: Record<string, FakeBinding>): Env {
  return bindings as unknown as Env;
}

const baseStart: StartContainerOptions = {
  instanceId: 'inst-123',
  image: 'umami:postgresql-latest',
  port: 3000,
  memoryMB: 512,
  env: { DATABASE_URL: 'postgres://x', SECRET: 'shh' },
  volumeMB: 2048,
  entrypoint: ['/bin/sh', '-c', 'app'],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Binding selection ────────────────────────────────────────────────────

describe('container_dispatcher — binding selection', () => {
  it('routes a supported slug to its dedicated APP_RUNTIME_* binding', async () => {
    const perImage = new FakeBinding();
    const generic = new FakeBinding();
    const env = makeEnv({ APP_RUNTIME_UMAMI: perImage, APP_RUNTIME: generic });

    await stopContainer(env, 'inst-1', 'umami');

    expect(perImage.idFromName).toHaveBeenCalledWith('inst-1');
    expect(perImage.fetchCalls).toHaveLength(1);
    expect(generic.fetchCalls).toHaveLength(0);
  });

  it('falls back to generic APP_RUNTIME when the per-image binding is unwired', async () => {
    const generic = new FakeBinding();
    // No APP_RUNTIME_OUTLINE present even though "outline" is a known slug.
    const env = makeEnv({ APP_RUNTIME: generic });

    await stopContainer(env, 'inst-2', 'outline');

    expect(generic.idFromName).toHaveBeenCalledWith('inst-2');
    expect(generic.fetchCalls).toHaveLength(1);
  });

  it('falls back to generic APP_RUNTIME for an unknown slug', async () => {
    const generic = new FakeBinding();
    const env = makeEnv({ APP_RUNTIME: generic });

    await stopContainer(env, 'inst-3', 'not-a-real-app');

    expect(generic.fetchCalls).toHaveLength(1);
  });

  it('uses generic APP_RUNTIME when no slug is supplied', async () => {
    const generic = new FakeBinding();
    const env = makeEnv({ APP_RUNTIME: generic });

    await stopContainer(env, 'inst-4');

    expect(generic.fetchCalls).toHaveLength(1);
  });

  it('maps every known catalog slug to a distinct binding key', async () => {
    const slugs = [
      'umami',
      'outline',
      'n8n',
      'vaultwarden',
      'uptime-kuma',
      'nocodb',
      'listmonk',
      'memos',
      'pocketbase',
      'open-webui',
    ];
    const keys = [
      'APP_RUNTIME_UMAMI',
      'APP_RUNTIME_OUTLINE',
      'APP_RUNTIME_N8N',
      'APP_RUNTIME_VAULTWARDEN',
      'APP_RUNTIME_UPTIME_KUMA',
      'APP_RUNTIME_NOCODB',
      'APP_RUNTIME_LISTMONK',
      'APP_RUNTIME_MEMOS',
      'APP_RUNTIME_POCKETBASE',
      'APP_RUNTIME_OPEN_WEBUI',
    ];
    for (let i = 0; i < slugs.length; i++) {
      const target = new FakeBinding();
      const generic = new FakeBinding();
      const env = makeEnv({ [keys[i]]: target, APP_RUNTIME: generic });
      await stopContainer(env, `inst-${slugs[i]}`, slugs[i]);
      expect(target.fetchCalls).toHaveLength(1);
      expect(generic.fetchCalls).toHaveLength(0);
    }
  });
});

// ── Missing-binding degradation ──────────────────────────────────────────

describe('container_dispatcher — missing-binding stub no-op', () => {
  it('startContainer returns ok stub_no_op when no binding exists', async () => {
    const env = makeEnv({});
    const res = await startContainer(env, baseStart);
    expect(res).toEqual({ ok: true, detail: 'stub_no_op' });
  });

  it('stopContainer degrades to a logged no-op', async () => {
    const res = await stopContainer(makeEnv({}), 'inst-x', 'umami');
    expect(res.ok).toBe(true);
    expect(res.detail).toBe('stub_no_op');
    expect(console.warn).toHaveBeenCalled();
  });

  it('getContainerLogs returns ok + empty lines when unbound', async () => {
    const res = await getContainerLogs(makeEnv({}), 'inst-x');
    expect(res).toEqual({ ok: true, lines: [] });
  });

  it('getContainerStatus returns ok stub_no_op (no status) when unbound', async () => {
    const res = await getContainerStatus(makeEnv({}), 'inst-x');
    expect(res.ok).toBe(true);
    expect(res.status).toBeUndefined();
  });

  it('tailContainerLogs emits a single info SSE event when unbound', async () => {
    const res = await tailContainerLogs(makeEnv({}), 'inst-x', 50);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toMatch(/event: info/);
    expect(body).toContain('not yet provisioned');
    expect(body).toContain('inst-x');
  });

  it('proxyToContainer 503s when unbound', async () => {
    const res = await proxyToContainer(makeEnv({}), 'inst-x', new Request('https://x/'));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/not yet available/i);
  });
});

// ── startContainer ────────────────────────────────────────────────────────

describe('container_dispatcher — startContainer', () => {
  it('POSTs /start with the image/port/env/volume/entrypoint body', async () => {
    const b = new FakeBinding();
    const env = makeEnv({ APP_RUNTIME_UMAMI: b });

    const res = await startContainer(env, { ...baseStart, appSlug: 'umami' });

    expect(res.ok).toBe(true);
    expect(b.lastUrl()).toBe('https://app-runtime/start');
    const call = b.fetchCalls[0];
    expect(call.init?.method).toBe('POST');
    expect((call.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(call.init?.body as string);
    expect(body).toEqual({
      image: baseStart.image,
      port: baseStart.port,
      env: baseStart.env,
      volumeMB: baseStart.volumeMB,
      entrypoint: baseStart.entrypoint,
    });
  });

  it('keys the DO instance by opts.instanceId', async () => {
    const b = new FakeBinding();
    await startContainer(makeEnv({ APP_RUNTIME: b }), baseStart);
    expect(b.idCalls).toEqual(['inst-123']);
  });
});

// ── stop / restart / destroy ───────────────────────────────────────────────

describe('container_dispatcher — stop / restart / destroy', () => {
  it('stopContainer POSTs /stop with no body', async () => {
    const b = new FakeBinding();
    await stopContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(b.lastUrl()).toBe('https://app-runtime/stop');
    expect(b.fetchCalls[0].init?.method).toBe('POST');
    expect(b.fetchCalls[0].init?.body).toBeUndefined();
  });

  it('restartContainer POSTs /restart', async () => {
    const b = new FakeBinding();
    await restartContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(b.lastUrl()).toBe('https://app-runtime/restart');
    expect(b.fetchCalls[0].init?.method).toBe('POST');
  });

  it('destroyContainer delegates to stop (/stop endpoint)', async () => {
    const b = new FakeBinding();
    const res = await destroyContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9', 'n8n');
    expect(res.ok).toBe(true);
    expect(b.lastUrl()).toBe('https://app-runtime/stop');
  });
});

// ── callDo response mapping ────────────────────────────────────────────────

describe('container_dispatcher — DO response mapping', () => {
  it('returns ok:false with the DO error detail on a non-ok JSON response', async () => {
    const b = new FakeBinding(() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    const res = await stopContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('boom');
  });

  it('falls back to status_<code> detail when the body has no error field', async () => {
    const b = new FakeBinding(() => new Response('Bad Gateway', { status: 502 }));
    const res = await stopContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('status_502');
  });

  it('returns ok:false with the thrown message when stub.fetch throws', async () => {
    const b = new FakeBinding(() => {
      throw new Error('dispatch exploded');
    });
    const res = await stopContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('dispatch exploded');
  });

  it('coerces a non-Error throw to the generic dispatch_failed detail', async () => {
    const b = new FakeBinding(() => {
      throw 'string failure';
    });
    const res = await stopContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('dispatch_failed');
  });

  it('tolerates a non-JSON ok response (ok:true, no body)', async () => {
    const b = new FakeBinding(() => new Response('plain text', { status: 200 }));
    const res = await stopContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(true);
  });
});

// ── getContainerLogs ────────────────────────────────────────────────────────

describe('container_dispatcher — getContainerLogs', () => {
  it('GETs /logs with the tail query param and returns parsed lines', async () => {
    const lines = [{ ts: 1, stream: 'stdout', line: 'hello' }];
    const b = new FakeBinding(() => new Response(JSON.stringify({ lines }), { status: 200 }));
    const res = await getContainerLogs(makeEnv({ APP_RUNTIME: b }), 'inst-9', 25);
    expect(res.ok).toBe(true);
    expect(res.lines).toEqual(lines);
    expect(b.lastUrl()).toBe('https://app-runtime/logs?tail=25');
    expect(b.fetchCalls[0].init?.method).toBe('GET');
  });

  it('defaults tail to 100 when omitted', async () => {
    const b = new FakeBinding(() => new Response(JSON.stringify({ lines: [] }), { status: 200 }));
    await getContainerLogs(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(b.lastUrl()).toBe('https://app-runtime/logs?tail=100');
  });

  it('returns [] lines when the DO omits the lines field', async () => {
    const b = new FakeBinding(() => new Response(JSON.stringify({}), { status: 200 }));
    const res = await getContainerLogs(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.lines).toEqual([]);
  });

  it('returns ok:false status_<code> on a non-ok logs response', async () => {
    const b = new FakeBinding(() => new Response('nope', { status: 404 }));
    const res = await getContainerLogs(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('status_404');
  });

  it('returns ok:false with the thrown message when the logs fetch throws', async () => {
    const b = new FakeBinding(() => {
      throw new Error('socket reset');
    });
    const res = await getContainerLogs(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('socket reset');
  });

  it('routes log fetches through the per-image binding for a known slug', async () => {
    const perImage = new FakeBinding(() => new Response(JSON.stringify({ lines: [] }), { status: 200 }));
    const generic = new FakeBinding();
    await getContainerLogs(makeEnv({ APP_RUNTIME_N8N: perImage, APP_RUNTIME: generic }), 'inst-9', 10, 'n8n');
    expect(perImage.fetchCalls).toHaveLength(1);
    expect(generic.fetchCalls).toHaveLength(0);
  });
});

// ── tailContainerLogs (SSE forward) ──────────────────────────────────────────

describe('container_dispatcher — tailContainerLogs', () => {
  it('forwards GET /logs/stream with the tail to the bound DO', async () => {
    const sse = new Response('event: x\ndata: {}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const b = new FakeBinding(() => sse);
    const res = await tailContainerLogs(makeEnv({ APP_RUNTIME: b }), 'inst-9', 42);
    expect(res).toBe(sse);
    expect(b.lastUrl()).toBe('https://app-runtime/logs/stream?tail=42');
    expect(b.fetchCalls[0].init?.method).toBe('GET');
  });
});

// ── getContainerStatus ────────────────────────────────────────────────────────

describe('container_dispatcher — getContainerStatus', () => {
  it('GETs /status and maps the JSON body into a ContainerStatus', async () => {
    const status: ContainerStatus = {
      state: 'running',
      uptime_seconds: 120,
      memory_mb_used: 256,
      restart_count: 1,
      image: 'umami:postgresql-latest',
    };
    const b = new FakeBinding(() => new Response(JSON.stringify(status), { status: 200 }));
    const res = await getContainerStatus(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(true);
    expect(res.status).toEqual(status);
    expect(b.lastUrl()).toBe('https://app-runtime/status');
    expect(b.fetchCalls[0].init?.method).toBe('GET');
  });

  it('returns ok:false with the detail when the /status call fails', async () => {
    const b = new FakeBinding(() => new Response(JSON.stringify({ error: 'crashed' }), { status: 503 }));
    const res = await getContainerStatus(makeEnv({ APP_RUNTIME: b }), 'inst-9');
    expect(res.ok).toBe(false);
    expect(res.detail).toBe('crashed');
    expect(res.status).toBeUndefined();
  });
});

// ── proxyToContainer ──────────────────────────────────────────────────────────

describe('container_dispatcher — proxyToContainer', () => {
  it('forwards the inbound request as-is to the bound DO', async () => {
    const upstream = new Response('app body', { status: 200 });
    const b = new FakeBinding(() => upstream);
    const inbound = new Request('https://inst-9.app/dashboard?q=1');
    const res = await proxyToContainer(makeEnv({ APP_RUNTIME: b }), 'inst-9', inbound);
    expect(res).toBe(upstream);
    expect(b.idCalls).toEqual(['inst-9']);
    // Forwarded verbatim — the same Request instance reaches the stub.
    expect(b.fetchCalls[0].input).toBe(inbound);
  });

  it('routes the proxy through the per-image binding for a known slug', async () => {
    const perImage = new FakeBinding(() => new Response('ok', { status: 200 }));
    const generic = new FakeBinding();
    await proxyToContainer(
      makeEnv({ APP_RUNTIME_VAULTWARDEN: perImage, APP_RUNTIME: generic }),
      'inst-9',
      new Request('https://x/'),
      'vaultwarden',
    );
    expect(perImage.fetchCalls).toHaveLength(1);
    expect(generic.fetchCalls).toHaveLength(0);
  });
});
