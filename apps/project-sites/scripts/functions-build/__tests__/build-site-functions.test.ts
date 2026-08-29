/**
 * Stage 2.2a — container-side `buildSiteFunctions` bridge (ADR-0035 §5).
 *
 * Proves the exact FunctionsBuildResult shape the WORKER's `deploySiteFunctions`
 * consumes: no functions/ → empty; helpers-only → empty; a valid functions/ →
 * { ok, script }; a reserved-path collision → { ok: false, error }. Runs the real
 * esbuild bundler (never throws — a functions failure must not fail the publish).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stop } from 'esbuild';
import { buildSiteFunctions } from '../build-site-functions.js';

describe('buildSiteFunctions (container bundle-on-publish)', () => {
  const dirs: string[] = [];
  const site = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'site-'));
    dirs.push(d);
    return d;
  };
  afterAll(async () => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    await stop(); // shut down esbuild's shared service so Jest exits cleanly
  });

  it('returns empty when the site has no functions/ folder', async () => {
    const build = await buildSiteFunctions(site(), { install: false });
    expect(build).toEqual({ ok: true, empty: true });
  });

  it('returns empty when functions/ has no routable handler files', async () => {
    const s = site();
    mkdirSync(join(s, 'functions', 'api'), { recursive: true });
    writeFileSync(join(s, 'functions', 'api', '_helper.ts'), `export const x = 1;\n`);
    writeFileSync(join(s, 'functions', 'api', 'types.d.ts'), `export type T = string;\n`);
    const build = await buildSiteFunctions(s, { install: false });
    expect(build).toEqual({ ok: true, empty: true });
  });

  it('bundles a valid functions/ into { ok: true, script }', async () => {
    const s = site();
    mkdirSync(join(s, 'functions', 'api'), { recursive: true });
    writeFileSync(
      join(s, 'functions', 'api', 'hello.ts'),
      `export const onRequestGet = (ctx) => new Response('hi ' + (ctx.params.name ?? ''));\n`,
    );
    const build = await buildSiteFunctions(s, { install: false });
    expect(build.ok).toBe(true);
    if (build.ok && 'script' in build) {
      expect(build.script.length).toBeGreaterThan(0);
      expect(build.script).toContain('/api/hello');
    } else {
      throw new Error('expected a script build, got ' + JSON.stringify(build));
    }
  });

  it('surfaces a reserved-path collision as { ok: false, error }', async () => {
    const s = site();
    // functions/api/contact-form/x.ts → /api/contact-form/x — a reserved platform prefix.
    mkdirSync(join(s, 'functions', 'api', 'contact-form'), { recursive: true });
    writeFileSync(
      join(s, 'functions', 'api', 'contact-form', 'x.ts'),
      `export const onRequestGet = () => new Response('nope');\n`,
    );
    const build = await buildSiteFunctions(s, { install: false });
    expect(build.ok).toBe(false);
    if (!build.ok) expect(build.error.toLowerCase()).toContain('reserved');
  });
});
