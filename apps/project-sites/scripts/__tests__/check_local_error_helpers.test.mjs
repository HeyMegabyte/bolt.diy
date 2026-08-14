// Unit tests for the local-error-helper detector (isLocalErrorHelperDef).
// Positive + false-positive coverage per validator-precision-discipline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalErrorHelperDef } from '../check-local-error-helpers.mjs';

// --- positives: a feature handler re-defining a canonical helper locally ---
test('flags a local const unauthorized def', () => {
  assert.equal(isLocalErrorHelperDef(`const unauthorized = (c) => c.json({}, 401);`), true);
});

test('flags an indented local const notFound def', () => {
  assert.equal(isLocalErrorHelperDef(`  const notFound = (c: Context<AppContext>) =>`), true);
});

// --- negatives: legit uses that must NOT flag ---
test('does NOT flag an import of unauthorized/notFound from feature_guard', () => {
  assert.equal(
    isLocalErrorHelperDef(`import { unauthorized, notFound } from '../../../src/lib/feature_guard.js';`),
    false,
  );
});

test('does NOT flag a call site', () => {
  assert.equal(isLocalErrorHelperDef(`  if (!userId) return unauthorized(c);`), false);
});

test('does NOT flag a similarly-named const (notFoundHandler)', () => {
  assert.equal(isLocalErrorHelperDef(`const notFoundHandler = (c) => c.json({}, 404);`), false);
});

test('does NOT flag a local badRequest (intentionally not gated — message varies)', () => {
  assert.equal(isLocalErrorHelperDef(`const badRequest = (c, m) => c.json({}, 400);`), false);
});
