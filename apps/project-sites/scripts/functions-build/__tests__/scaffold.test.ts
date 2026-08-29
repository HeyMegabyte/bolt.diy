/**
 * Stage 1.2 — the shipped `functions/` scaffold conforms to the Stage 1.1
 * router/bundler. The canonical starter lives at apps/project-sites/scaffold/
 * functions/ (copied verbatim into template.projectsites.dev/functions/). This
 * bundles it with the real bundler and executes the example handlers, so the
 * starter can never drift out of the file-based convention.
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { stop } from 'esbuild';
import { bundleFunctions } from '../bundle.js';

const SCAFFOLD = resolve(process.cwd(), 'scaffold/functions');

function runBundle(script: string): {
  fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
} {
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', script)(mod, mod.exports, () => {
    throw new Error('unexpected require in self-contained bundle');
  });
  return mod.exports.default as {
    fetch: (r: Request, e: unknown, c: unknown) => Promise<Response>;
  };
}

describe('functions scaffold (template starter)', () => {
  afterAll(async () => {
    await stop();
  });

  it('ships api/hello.ts + README.md', () => {
    expect(existsSync(resolve(SCAFFOLD, 'api/hello.ts'))).toBe(true);
    expect(existsSync(resolve(SCAFFOLD, 'README.md'))).toBe(true);
  });

  it('bundles to /api/hello and dispatches the example GET + POST', async () => {
    const { script, routes } = await bundleFunctions({ functionsDir: SCAFFOLD, format: 'cjs' });
    expect(routes.map((r: { pattern: string }) => r.pattern)).toContain('/api/hello');

    const worker = runBundle(script);
    const ctx = { waitUntil() {}, passThroughOnException() {} };

    const get = await worker.fetch(new Request('https://s.dev/api/hello?name=Ada'), {}, ctx);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(expect.objectContaining({ ok: true, message: 'Hello, Ada!' }));

    const post = await worker.fetch(
      new Request('https://s.dev/api/hello', {
        method: 'POST',
        body: JSON.stringify({ a: 1 }),
        headers: { 'content-type': 'application/json' },
      }),
      {},
      ctx,
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(expect.objectContaining({ ok: true, youSent: { a: 1 } }));
  });
});
