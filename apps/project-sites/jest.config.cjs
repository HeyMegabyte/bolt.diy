/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  // Recycle a worker once it crosses this heap ceiling. Without it, the v8
  // coverage run over 400 suites accumulates memory in long-lived workers and
  // OOM-crashes one on the CI runner (less RAM than dev) — surfacing as a
  // spurious "Test suite failed to run" on whichever heavy suite loads next
  // (consistently route_malformed_json_boundary, which imports the full worker
  // via ../index). Passes locally, failed CI Unit Tests repeatedly. Recycling
  // keeps per-worker heap bounded so the heavy import always has headroom.
  workerIdleMemoryLimit: '512MB',
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  collectCoverageFrom: ['**/src/**/*.{ts,tsx}', '!**/src/**/index.ts'],
  coverageProvider: 'v8',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '\\.wasm$': '<rootDir>/src/__tests__/__mocks__/wasm.js',
  },
};

module.exports = config;
