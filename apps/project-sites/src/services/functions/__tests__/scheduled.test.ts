/**
 * Stage 6.1 — codegen wires `functions/_scheduled.*` into the worker entry, and the
 * runtime routes the reserved `/api/_ps/scheduled` fetch (the platform cron's
 * invocation channel) to the user's scheduled handler with the tenant-scoped env.
 */
import { generateFunctionsWorkerEntry } from '../codegen.js';
import { createFunctionsFetchHandler, SCHEDULED_DISPATCH_PATH } from '../runtime.js';

describe('codegen — scheduled wiring', () => {
  it('imports the scheduled module + passes it to the handler when scheduledFile is set', () => {
    const { source } = generateFunctionsWorkerEntry(['api/hello.ts'], {
      runtimeImportPath: '/rt.js',
      scheduledFile: '_scheduled.ts',
    });
    expect(source).toContain('import * as scheduledMod from "./_scheduled.ts"');
    expect(source).toContain('createFunctionsFetchHandler(manifest, { scheduled: scheduledMod })');
  });

  it('omits scheduled wiring when no scheduledFile (unchanged default export)', () => {
    const { source } = generateFunctionsWorkerEntry(['api/hello.ts'], {
      runtimeImportPath: '/rt.js',
    });
    expect(source).not.toContain('scheduledMod');
    expect(source).toContain('export default createFunctionsFetchHandler(manifest);');
  });
});

describe('runtime — scheduled invocation', () => {
  const fakeCtx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const req = (path: string, headers: Record<string, string> = {}) =>
    new Request('https://site/' + path.replace(/^\//, ''), { headers });

  it('runs the scheduled handler on the reserved path with the SCOPED env + cron', async () => {
    let ran: { cron?: string; hasSecrets?: boolean; leakedRaw?: boolean } = {};
    const scheduledMod = {
      scheduled: (
        controller: { cron: string },
        env: { SECRETS?: Record<string, string>; __PS_FN_TOKEN?: string },
      ) => {
        ran = {
          cron: controller.cron,
          hasSecrets: !!env.SECRETS,
          leakedRaw: '__PS_FN_TOKEN' in env, // raw __PS_* must be stripped
        };
      },
    };
    const h = createFunctionsFetchHandler([], { scheduled: scheduledMod });
    const res = await h.fetch(
      req(`${SCHEDULED_DISPATCH_PATH}?cron=${encodeURIComponent('0 * * * *')}`, {
        authorization: 'Bearer tok',
      }),
      { __PS_FN_TOKEN: 'tok', __PS_SECRETS_JSON: '{"A":"1"}' },
      fakeCtx,
    );
    expect(res.status).toBe(200);
    expect(ran.cron).toBe('0 * * * *');
    expect(ran.hasSecrets).toBe(true);
    expect(ran.leakedRaw).toBe(false);
  });

  it('403 when the presented token does not match the script token (fail closed)', async () => {
    const h = createFunctionsFetchHandler([], { scheduled: { scheduled: () => undefined } });
    const res = await h.fetch(
      req(SCHEDULED_DISPATCH_PATH, { authorization: 'Bearer wrong' }),
      { __PS_FN_TOKEN: 'tok' },
      fakeCtx,
    );
    expect(res.status).toBe(403);
  });

  it('accepts onSchedule + default.scheduled export shapes (no token configured → runs)', async () => {
    let a = false;
    let b = false;
    const h1 = createFunctionsFetchHandler([], {
      scheduled: {
        onSchedule: () => {
          a = true;
        },
      },
    });
    await h1.fetch(req(SCHEDULED_DISPATCH_PATH), {}, fakeCtx);
    const h2 = createFunctionsFetchHandler([], {
      scheduled: {
        default: {
          scheduled: () => {
            b = true;
          },
        },
      },
    } as never);
    await h2.fetch(req(SCHEDULED_DISPATCH_PATH), {}, fakeCtx);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it('does NOT intercept the reserved path when no scheduled module is present', async () => {
    const h = createFunctionsFetchHandler([]);
    const res = await h.fetch(req(SCHEDULED_DISPATCH_PATH), {}, fakeCtx);
    expect(res.status).toBe(404); // falls through to routing → no match
  });

  it('500 when the scheduled handler throws', async () => {
    const h = createFunctionsFetchHandler([], {
      scheduled: {
        scheduled: () => {
          throw new Error('boom');
        },
      },
    });
    const res = await h.fetch(req(SCHEDULED_DISPATCH_PATH), {}, fakeCtx);
    expect(res.status).toBe(500);
  });

  it('normal routes still work with a scheduled module present', async () => {
    const mod = { onRequestGet: () => new Response('hi') };
    const h = createFunctionsFetchHandler([{ pattern: '/api/hi', module: mod }], {
      scheduled: { scheduled: () => undefined },
    });
    const res = await h.fetch(req('/api/hi'), {}, fakeCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hi');
  });
});
