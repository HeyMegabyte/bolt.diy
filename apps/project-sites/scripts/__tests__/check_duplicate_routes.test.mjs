// Unit tests for the duplicate-route detector (extractRoutes + findDuplicates).
// Positive + false-positive coverage per validator-precision-discipline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRoutes, findDuplicates, ALLOWLIST } from '../check-duplicate-routes.mjs';

// --- extractRoutes: real registrations captured ---
test('captures a direct app.get registration', () => {
  assert.deepEqual(extractRoutes(`app.get('/api/foo', async (c) => {})`), [
    { method: 'GET', path: '/api/foo', line: 1 },
  ]);
});

test('captures a router registration on any identifier + method', () => {
  const rows = extractRoutes(`voiceRoutes.post('/api/voice/x', h)\naiAdmin.delete('/api/y', h)`);
  assert.deepEqual(rows, [
    { method: 'POST', path: '/api/voice/x', line: 1 },
    { method: 'DELETE', path: '/api/y', line: 2 },
  ]);
});

// --- extractRoutes: false positives that must NOT be captured ---
test('does NOT capture a // comment line', () => {
  assert.deepEqual(extractRoutes(`  // app.get('/api/foo', h)`), []);
});

test('does NOT capture a JSDoc star line', () => {
  assert.deepEqual(extractRoutes(` * api.post('/api/foo') is the handler`), []);
});

test('does NOT capture a JSDoc {@link …} reference (mentions .post in prose)', () => {
  assert.deepEqual(extractRoutes(`   * @see {@link aiAdmin.post('/api/billing/credits/topup')}`), []);
});

test('does NOT capture a .route() mount or .use() middleware', () => {
  assert.deepEqual(extractRoutes(`app.route('/', apps)\napp.use('/api/*', mw)`), []);
});

test('does NOT capture a relative (non-slash) string arg', () => {
  assert.deepEqual(extractRoutes(`thing.get('foo')`), []);
});

// --- findDuplicates: grouping ---
test('flags the same METHOD+path registered at two sites', () => {
  const dups = findDuplicates([
    { file: 'a.ts', method: 'GET', path: '/api/x', line: 1 },
    { file: 'b.ts', method: 'GET', path: '/api/x', line: 9 },
  ]);
  assert.deepEqual(Object.keys(dups), ['GET /api/x']);
  assert.equal(dups['GET /api/x'].length, 2);
});

test('does NOT flag same path with DIFFERENT methods (GET vs POST is not a shadow)', () => {
  const dups = findDuplicates([
    { file: 'a.ts', method: 'GET', path: '/api/x', line: 1 },
    { file: 'a.ts', method: 'POST', path: '/api/x', line: 2 },
  ]);
  assert.deepEqual(Object.keys(dups), []);
});

test('does NOT flag a single registration', () => {
  assert.deepEqual(findDuplicates([{ file: 'a.ts', method: 'GET', path: '/api/x', line: 1 }]), {});
});

// --- ALLOWLIST is the documented grandfather set ---
test('ALLOWLIST grandfathers the known intentional overrides', () => {
  assert.equal(ALLOWLIST['POST /api/domains/purchase'], 'intentional');
  assert.equal(ALLOWLIST['GET /api/apps/catalog'], 'intentional');
  // Every entry is classified either intentional or review.
  for (const reason of Object.values(ALLOWLIST)) {
    assert.ok(reason === 'intentional' || reason === 'review', `bad reason: ${reason}`);
  }
});
