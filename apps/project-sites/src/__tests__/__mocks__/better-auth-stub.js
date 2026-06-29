/**
 * Jest stub for `src/auth/better-auth.ts`.
 *
 * The real module imports the `better-auth` npm package, which pulls a deep
 * ESM-only dependency tree (kysely → better-call → rou3 → @noble/hashes → …)
 * that @swc/jest cannot transcompile — so ANY suite importing `middleware/auth.ts`
 * (which imports `makeAuth` from better-auth.ts at module load) crashed with
 * "Cannot use import statement outside a module", failing the worker-deploy unit
 * gate. The `better_auth` flag is OFF by default, so `makeAuth` is never actually
 * invoked on the tested legacy-auth path — a no-op stub is behavior-faithful for
 * tests and changes ZERO runtime code. Wired via moduleNameMapper in jest.config.cjs.
 */
module.exports = {
  makeAuth: () => ({
    handler: async () => new Response(null, { status: 404 }),
    api: {},
  }),
  ensureBetterAuthSchema: async () => {},
  _resetAuthCache: () => {},
};
