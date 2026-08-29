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
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateFunctionsWorkerEntry } from '../../src/services/functions/codegen.js';

const CODE_EXT = /\.(?:ts|js|mts|cts|mjs|cjs)$/;
const SKIP_BASENAME = /(?:\.d\.ts|\.test\.ts|\.spec\.ts)$/;

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
  const runtimePath = resolve(
    opts.runtimePath ?? resolve(process.cwd(), 'src/services/functions/runtime.ts'),
  );
  const format = opts.format ?? 'esm';

  if (opts.install && existsSync(join(functionsDir, 'package.json'))) {
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: functionsDir,
      stdio: 'inherit',
    });
  }

  const files = listFunctionFiles(functionsDir);
  const { source, routes } = generateFunctionsWorkerEntry(files, { runtimeImportPath: runtimePath });

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
  return { script, routes };
}
