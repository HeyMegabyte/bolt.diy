// Jest stub for the `cloudflare:workers` runtime virtual module.
//
// `cloudflare:workers` only exists inside the Workers runtime; under Jest it
// resolves to nothing ("Cannot find module 'cloudflare:workers'"). Any suite that
// imports `../index` pulls in `@cloudflare/containers`, which `import`s
// `DurableObject` (+ friends) from here. Mapping it to this stub (see
// jest.config.cjs moduleNameMapper) lets those modules load without the real
// runtime — tests that exercise DO/Container behavior mock it further per-suite.
//
// `__esModule: true` so @swc/jest's interop resolves the named imports directly.

class WorkersStub {}

module.exports = {
  __esModule: true,
  DurableObject: WorkersStub,
  WorkflowEntrypoint: WorkersStub,
  WorkerEntrypoint: WorkersStub,
  RpcTarget: WorkersStub,
  env: {},
};
