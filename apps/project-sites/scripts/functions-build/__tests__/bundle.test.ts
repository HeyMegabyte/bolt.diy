/**
 * Stage 1.1 — esbuild bundler integration test.
 * Proves the full chain: a real `functions/` fixture -> codegen -> esbuild ->
 * ONE self-contained Worker whose default export dispatches real requests.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stop } from 'esbuild';
import { bundleFunctions, listFunctionFiles } from '../bundle.js';

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fns-'));
  mkdirSync(join(dir, 'api', 'users'), { recursive: true });
  writeFileSync(
    join(dir, 'api', 'hello.ts'),
    `export const onRequestGet = () => new Response('hi from hello');\n`,
  );
  writeFileSync(
    join(dir, 'api', 'users', '[id].ts'),
    `export const onRequest = (ctx: any) => new Response('user:' + ctx.params.id);\n`,
  );
  // underscore-prefixed + .d.ts must be ignored by the router glob
  writeFileSync(join(dir, 'api', '_helper.ts'), `export const x = 1;\n`);
  writeFileSync(join(dir, 'api', 'types.d.ts'), `export type T = string;\n`);
  return dir;
}

/** Execute a CJS-format bundle in-process and return its default export. */
function runBundle(script: string): { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> } {
  const mod = { exports: {} as Record<string, unknown> };
  const req = () => {
    throw new Error('unexpected require in self-contained bundle');
  };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', script)(mod, mod.exports, req);
  return mod.exports.default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
}

describe('functions bundler', () => {
  let dir: string;
  beforeAll(() => {
    dir = makeFixture();
  });
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await stop(); // shut down esbuild's shared build service so Jest exits cleanly
  });

  it('globs only routable handler files (skips _helpers + .d.ts)', () => {
    const files = listFunctionFiles(dir);
    expect(files).toContain('api/hello.ts');
    expect(files).toContain('api/users/[id].ts');
    expect(files).not.toContain('api/_helper.ts');
    expect(files).not.toContain('api/types.d.ts');
  });

  it('bundles into one script that lists the routes', async () => {
    const { script, routes } = await bundleFunctions({ functionsDir: dir });
    const patterns = routes.map((r: { pattern: string }) => r.pattern);
    expect(patterns).toEqual(expect.arrayContaining(['/api/hello', '/api/users/:id']));
    expect(script).toContain('/api/users/:id');
    expect(script).toContain('hi from hello'); // user handler body was inlined
  });

  it('produces a runnable Worker that dispatches GET + dynamic params', async () => {
    const { script } = await bundleFunctions({ functionsDir: dir, format: 'cjs' });
    const worker = runBundle(script);
    const ctx = { waitUntil() {}, passThroughOnException() {} };

    const hello = await worker.fetch(new Request('https://s.dev/api/hello'), {}, ctx);
    expect(hello.status).toBe(200);
    expect(await hello.text()).toBe('hi from hello');

    const user = await worker.fetch(new Request('https://s.dev/api/users/42'), {}, ctx);
    expect(await user.text()).toBe('user:42');

    const miss = await worker.fetch(new Request('https://s.dev/api/nope'), {}, ctx);
    expect(miss.status).toBe(404);

    const wrongMethod = await worker.fetch(
      new Request('https://s.dev/api/hello', { method: 'POST' }),
      {},
      ctx,
    );
    expect(wrongMethod.status).toBe(405);
  });
});
