/**
 * Stage 2.2d — bolt-editor publish → functions deploy.
 *
 * extractFunctionsFiles filters a bolt `files[]` payload to the `functions/`
 * subtree (path-traversal-safe, keeps the prefix). bundleFunctionsViaContainer
 * POSTs those sources to the container's /bundle-functions endpoint and returns
 * the container's FunctionsBuildResult verbatim; it NEVER throws — every fault
 * degrades to `{ok:false}` so the caller keeps last-good + the static publish is
 * unaffected. The SITE_BUILDER DO is a plain fake here (no real container).
 */
import {
  extractFunctionsFiles,
  bundleFunctionsViaContainer,
  type BoltFile,
} from '../services/functions_bolt_bundle.js';
import type { Env } from '../types/env.js';

function fakeBuilder(fetchImpl: (req: unknown) => Promise<Response>) {
  return {
    idFromName: (n: string) => ({ name: n }),
    get: () => ({ fetch: (_url: string, _opts: unknown) => fetchImpl(_opts) }),
  };
}

describe('extractFunctionsFiles', () => {
  const files: BoltFile[] = [
    { path: 'index.html', content: '<html>' },
    { path: 'functions/api/hello.ts', content: 'export const onRequestGet = () => {}' },
    { path: 'functions/api/[id].ts', content: 'x' },
    { path: './functions/lib/util.ts', content: 'y' },
    { path: 'assets/app.js', content: 'z' },
  ];

  it('keeps only the functions/ subtree (prefix preserved), drops the rest', () => {
    const out = extractFunctionsFiles(files);
    expect(out.map((f) => f.path).sort()).toEqual(
      ['./functions/lib/util.ts', 'functions/api/[id].ts', 'functions/api/hello.ts'].sort(),
    );
  });

  it('drops path-traversal entries', () => {
    const out = extractFunctionsFiles([
      { path: 'functions/../../../etc/passwd', content: 'bad' },
      { path: 'functions/api/ok.ts', content: 'good' },
    ]);
    expect(out.map((f) => f.path)).toEqual(['functions/api/ok.ts']);
  });

  it('tolerates a null/empty payload + malformed entries', () => {
    expect(extractFunctionsFiles(undefined as unknown as BoltFile[])).toEqual([]);
    expect(extractFunctionsFiles([])).toEqual([]);
    expect(
      extractFunctionsFiles([{ path: 'functions/x.ts' } as BoltFile, null as unknown as BoltFile]),
    ).toEqual([]);
  });
});

describe('bundleFunctionsViaContainer', () => {
  const fn: BoltFile[] = [
    { path: 'functions/api/hello.ts', content: 'export const onRequestGet=()=>new Response("hi")' },
  ];

  it('empty subtree → {ok:true, empty:true} (no container call)', async () => {
    const env = {} as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', []);
    expect(out).toEqual({ ok: true, empty: true });
  });

  it('no SITE_BUILDER binding → {ok:false} (fail-soft)', async () => {
    const env = {} as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', fn);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/container unavailable/i);
  });

  it('container 200 → returns the FunctionsBuildResult verbatim', async () => {
    const builder = fakeBuilder(
      async () =>
        new Response(JSON.stringify({ ok: true, script: 'export default {}' }), { status: 200 }),
    );
    const env = { SITE_BUILDER: builder } as unknown as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', fn);
    expect(out).toEqual({ ok: true, script: 'export default {}' });
  });

  it('container relays a build error ({ok:false}) verbatim', async () => {
    const builder = fakeBuilder(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'Reserved path' }), { status: 200 }),
    );
    const env = { SITE_BUILDER: builder } as unknown as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', fn);
    expect(out).toEqual({ ok: false, error: 'Reserved path' });
  });

  it('container non-200 → {ok:false} (fail-soft, keeps last-good)', async () => {
    const builder = fakeBuilder(async () => new Response('boom', { status: 500 }));
    const env = { SITE_BUILDER: builder } as unknown as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', fn);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/container 500/);
  });

  it('container fetch throws → {ok:false} (never propagates)', async () => {
    const builder = fakeBuilder(async () => {
      throw new Error('DO unreachable');
    });
    const env = { SITE_BUILDER: builder } as unknown as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', fn);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/fetch failed.*DO unreachable/i);
  });

  it('malformed container JSON → {ok:false} (never uploads garbage)', async () => {
    const builder = fakeBuilder(
      async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 }),
    );
    const env = { SITE_BUILDER: builder } as unknown as Env;
    const out = await bundleFunctionsViaContainer(env, 'site-1', 'v1', fn);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/malformed/i);
  });
});
