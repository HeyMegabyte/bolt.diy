// Unit tests for the lying-empty response-key-presence guard (scanResponseKey).
// The positive is the class the guard catches (a FE `res.KEY ?? []` whose KEY the
// worker produces NOWHERE → the panel is empty forever); the negatives encode the
// prefer-false-negatives discipline — any worker mention (c.json literal OR SELECT
// column, both land in the token set) clears the key, and structural/client-only
// keys are allowlisted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanResponseKey } from '../check-response-key-presence.mjs';

// ── POSITIVE: a fallback key the worker mentions nowhere → dead read ──
test('FLAGS a key the worker produces nowhere', () => {
  const workerTokens = new Set(['vars', 'items', 'rows']);
  assert.equal(scanResponseKey('bogus_never_returned', workerTokens).flagged, true);
});

// ── NEGATIVE: key returned as a c.json literal (`return c.json({ vars })`) ──
test('does NOT flag a key the worker returns as an object key', () => {
  const workerTokens = new Set(['vars', 'items']);
  assert.equal(scanResponseKey('vars', workerTokens).flagged, false);
});

// ── NEGATIVE: key produced only as a SELECT column (still lands in the token set) ──
test('does NOT flag a key sourced from a SELECT column', () => {
  // `latency_ms` / `credits_debited` appear only as SELECT columns in ai_admin.ts,
  // never as literal c.json keys — the token set still contains them.
  const workerTokens = new Set(['latency_ms', 'credits_debited', 'data']);
  assert.equal(scanResponseKey('latency_ms', workerTokens).flagged, false);
  assert.equal(scanResponseKey('credits_debited', workerTokens).flagged, false);
});

// ── NEGATIVE: structural envelope key is allowlisted even if absent ──
test('does NOT flag an allowlisted structural key', () => {
  assert.equal(scanResponseKey('data', new Set()).flagged, false);
  assert.equal(scanResponseKey('error', new Set()).flagged, false);
});

// ── NEGATIVE: allowlisted key that also happens to be present ──
test('does NOT flag an allowlisted key that is also produced', () => {
  assert.equal(scanResponseKey('results', new Set(['results'])).flagged, false);
});
