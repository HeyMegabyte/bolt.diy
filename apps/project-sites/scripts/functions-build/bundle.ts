/**
 * esbuild bundler for a site's `functions/` folder (Stage 1.1, ADR-0035 §2).
 *
 * NODE-ONLY build tooling — runs in the build container at publish time, NEVER
 * inside the edge Worker (esbuild needs a native binary + filesystem). It lives
 * under scripts/ so it is excluded from the Worker's TS project + bundle.
 *
 * Pipeline: glob handler files -> codegen the router entry (shared pure code in
 * src/services/functions/codegen.ts) -> esbuild-bundle into ONE self-contained
 * Worker script that default-exports a fetch handler. If a `functions/
 * package.json` declares deps, run `npm install` first so esbuild can resolve
 * them.
 */
import { build } from 'esbuild';
import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateFunctionsWorkerEntry } from '../../src/services/functions/codegen.js';

const CODE_EXT = /\.(?:ts|js|mts|cts|mjs|cjs)$/;
const SKIP_BASENAME = /(?:\.d\.ts|\.test\.ts|\.spec\.ts)$/;
const SCHEDULED_BASENAMES = [
  '_scheduled.ts',
  '_scheduled.js',
  '_scheduled.mts',
  '_scheduled.cts',
  '_scheduled.mjs',
  '_scheduled.cjs',
];

/**
 * Find the site's scheduled module (`functions/_scheduled.*`) at the functions ROOT
 * (a top-level convention, like Pages `_middleware.ts`) — the `functions/`-relative
 * basename, or null when absent. Stage 6.1.
 */
export function findScheduledFile(functionsDir: string): string | null {
  for (const base of SCHEDULED_BASENAMES) {
    if (existsSync(join(functionsDir, base))) return base;
  }
  return null;
}

/**
 * Extract the cron expression(s) a `_scheduled` module declares — `export const
 * cron = '…'` (single) and/or `export const crons = ['…', '…']` (array). Pure regex
 * (the module isn't executed at extract time). Deduped, empties dropped. Stage 6.1.
 *
 * @example extractCrons("export const cron = '0 * * * *'") // ['0 * * * *']
 */
export function extractCrons(source: string): string[] {
  const crons: string[] = [];
  const arr = source.match(/export\s+const\s+crons\s*=\s*\[([^\]]*)\]/);
  if (arr) {
    for (const m of arr[1].matchAll(/['"`]([^'"`]+)['"`]/g)) crons.push(m[1]);
  }
  const single = source.match(/export\s+const\s+cron\s*=\s*['"`]([^'"`]+)['"`]/);
  if (single) crons.push(single[1]);
  return [...new Set(crons.map((c) => c.trim()).filter(Boolean))];
}

/** esbuild plugin: resolve the repo's `./foo.js` import convention to `foo.ts`. */
const jsToTsResolve = {
  name: 'js-to-ts-ext',
  setup(pluginBuild: {
    onResolve(
      opts: { filter: RegExp },
      cb: (args: { path: string; resolveDir: string }) => { path: string } | undefined,
    ): void;
  }) {
    pluginBuild.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, (args) => {
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      return existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

export interface BundleOptions {
  /** Absolute path to the site's `functions/` directory. */
  functionsDir: string;
  /** Absolute path to runtime.ts (default: `<cwd>/src/services/functions/runtime.ts`). */
  runtimePath?: string;
  /** When set, also write the bundle to disk. */
  outfile?: string;
  /** Run `npm install` when a `functions/package.json` exists. */
  install?: boolean;
  /** Output module format (default 'esm'; 'cjs' for in-process test execution). */
  format?: 'esm' | 'cjs';
}

export interface BundleResult {
  script: string;
  routes: { file: string; pattern: string }[];
  /** Stage 6.1 — cron expression(s) declared in `functions/_scheduled.*` (empty when none). */
  crons: string[];
}

/** List routable handler files under a `functions/` dir, relative + posix-style. */
export function listFunctionFiles(functionsDir: string): string[] {
  const entries = readdirSync(functionsDir, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      functionsDir;
    const abs = join(parent, entry.name);
    const rel = relative(functionsDir, abs).split('\\').join('/');
    if (rel.startsWith('node_modules/')) continue;
    if (!CODE_EXT.test(rel) || SKIP_BASENAME.test(rel)) continue;
    // underscore-prefixed basenames are helpers/reserved (e.g. _scheduled), not HTTP routes
    if (entry.name.startsWith('_')) continue;
    files.push(rel);
  }
  return files.sort();
}

/**
 * Bundle a `functions/` folder into one Worker script string.
 *
 * @param opts - see {@link BundleOptions}
 * @returns the bundled `script` plus the resolved `routes`
 * @throws {import('../../src/services/functions/codegen.js').FunctionsBuildError} on route collision
 * @example const { script } = await bundleFunctions({ functionsDir: '/site/functions' })
 */
export async function bundleFunctions(opts: BundleOptions): Promise<BundleResult> {
  const functionsDir = resolve(opts.functionsDir);
  // The container COPYs the runtime to a FIXED absolute path; prefer it, else fall back to cwd
  // for local/test runs. Bug #3 (2026-08-30): cli.ts spawns with cwd=<site build dir> (template
  // clone, no src/services/functions) so the old process.cwd() default resolved INTO the build
  // dir → esbuild "Could not resolve <buildDir>/src/services/..." → functionsBuild {ok:false}.
  // Bug #3b: import.meta.url is unreliable under tsx-CJS (cwd-relative, not the file's real path)
  // and __dirname doesn't typecheck in ESM — so probe the known container path with existsSync.
  const CONTAINER_RUNTIME = '/home/cuser/src/services/functions/runtime.ts';
  const runtimePath = resolve(
    opts.runtimePath ??
      (existsSync(CONTAINER_RUNTIME)
        ? CONTAINER_RUNTIME
        : resolve(process.cwd(), 'src/services/functions/runtime.ts')),
  );
  const format = opts.format ?? 'esm';

  if (opts.install && existsSync(join(functionsDir, 'package.json'))) {
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: functionsDir,
      stdio: 'inherit',
    });
  }

  const files = listFunctionFiles(functionsDir);
  // Stage 6.1 — wire a scheduled module (functions/_scheduled.*) + extract its cron(s).
  const scheduledFile = findScheduledFile(functionsDir);
  let crons: string[] = [];
  if (scheduledFile) {
    try {
      crons = extractCrons(readFileSync(join(functionsDir, scheduledFile), 'utf-8'));
    } catch {
      crons = [];
    }
  }
  const { source, routes } = generateFunctionsWorkerEntry(files, {
    runtimeImportPath: runtimePath,
    scheduledFile: scheduledFile ?? undefined,
  });

  const result = await build({
    stdin: { contents: source, resolveDir: functionsDir, loader: 'ts', sourcefile: '_functions_entry.ts' },
    bundle: true,
    write: false,
    format,
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [jsToTsResolve],
  });

  const script = result.outputFiles?.[0]?.text ?? '';

  if (opts.outfile) {
    mkdirSync(dirname(resolve(opts.outfile)), { recursive: true });
    writeFileSync(resolve(opts.outfile), script);
  }
  return { script, routes, crons };
}
