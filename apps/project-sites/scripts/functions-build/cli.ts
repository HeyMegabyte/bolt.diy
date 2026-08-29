/**
 * Container CLI for bundle-on-publish (Stage 2.2a-wiring, ADR-0035 §5).
 *
 * `tsx cli.ts <buildDir>` bundles the built site's `functions/` folder and prints
 * the {@link FunctionsBuildResult} as JSON on stdout — the shape the worker's
 * `deploySiteFunctions` consumes. `container-server.mjs` (a `.mjs`) spawns this
 * after a build (mirroring how `run-validators.mjs` spawns `tsx` for
 * `build_validators.ts`) and carries the JSON in its HMAC build callback.
 *
 * Wrapped in an async IIFE (NOT top-level await): `tsx` transforms a `.ts` as CJS
 * when the nearest `package.json` isn't `type:module`, and CJS rejects top-level
 * await — verified in a minimal container. An IIFE runs under both CJS and ESM.
 * Prints the result JSON and exits 0 even on a BUILD error (the error is inside the
 * JSON: `{ok:false,error}`) so the caller always gets a parseable result; exit 1 is
 * reserved for a usage/internal fault (no dir / crash).
 *
 * esbuild resolvability: `bundle.ts` does `import 'esbuild'`, so the caller MUST
 * run this where esbuild resolves — spawn with `cwd = <buildDir>` (the Vite
 * template has esbuild in its `node_modules`) or `NODE_PATH` set to the global
 * modules. Verified in a minimal container: valid `functions/` → `{ok,script}`,
 * reserved-path → `{ok:false,error}`.
 */
import { buildSiteFunctions } from './build-site-functions.js';

const buildDir = process.argv[2];
if (!buildDir) {
  process.stderr.write('usage: tsx cli.ts <buildDir>\n');
  process.exit(1);
}

void (async () => {
  try {
    const result = await buildSiteFunctions(buildDir);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    // buildSiteFunctions never throws, but guard the CLI boundary anyway: emit a
    // parseable error result (not a crash) so the caller's JSON.parse always works.
    process.stdout.write(
      JSON.stringify({ ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) }),
    );
  }
})();
