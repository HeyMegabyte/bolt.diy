// Unit tests for the write-side FE↔worker contract-drift guard.
// Positives are the class it catches (a FE body key the worker consumes nowhere →
// 400 every submit); negatives encode the prefer-false-negatives discipline (any
// worker mention clears the key) + the extraction edge cases (shorthand, spread,
// computed, quoted, empty, variable, multi-line, generic type param).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitTopLevel,
  extractObjectKeys,
  extractRequestBodyKeys,
  scanRequestKey,
} from '../check-request-key-presence.mjs';

// ── splitTopLevel respects nesting + strings ──
test('splitTopLevel splits on top-level commas only', () => {
  assert.deepEqual(
    splitTopLevel('a: 1, b: {x: 2, y: 3}, c: [1, 2], d: f(1, 2)').map((s) => s.trim()),
    ['a: 1', 'b: {x: 2, y: 3}', 'c: [1, 2]', 'd: f(1, 2)'],
  );
});

// ── extractObjectKeys: explicit / shorthand / quoted; skips spread + computed ──
test('extractObjectKeys pulls keys, skips spread + computed', () => {
  assert.deepEqual(
    extractObjectKeys("{ alert_kind: v, notify_email, ...base, 'quoted': 2, [dyn]: 3 }"),
    ['alert_kind', 'notify_email', 'quoted'],
  );
});

// ── extractRequestBodyKeys: real FE call shapes ──
test('extractRequestBodyKeys pulls inline body keys from post/put/patch', () => {
  const src = `
    this.api.post('/spend-alerts', { alert_kind: k, notify_email: e });
    this.api.patch<{ var: X }>('/env-vars/' + id, { exposedToAi: next });
    this.api.post('/onboarding/dismiss', {});          // empty → no keys
    this.api.post('/batch', payload);                   // variable → skipped
  `;
  const keys = extractRequestBodyKeys(src).map((f) => f.key).sort();
  assert.deepEqual(keys, ['alert_kind', 'exposedToAi', 'notify_email']);
});

test('extractRequestBodyKeys handles a multi-line body + generic type param', () => {
  const src = `
    this.api.post<{ data: PaymentIntentResponse }>('/billing/payment-intent', {
      site_id: s,
      amount_cents: n,
    });
  `;
  assert.deepEqual(
    extractRequestBodyKeys(src).map((f) => f.key).sort(),
    ['amount_cents', 'site_id'],
  );
});

// ── scanRequestKey: the dead-write decision ──
test('FLAGS a body key the worker consumes nowhere', () => {
  assert.equal(scanRequestKey('alert_kind', new Set(['trigger', 'email'])).flagged, true);
});

test('does NOT flag a key the worker consumes (Zod key OR body.KEY read)', () => {
  assert.equal(scanRequestKey('trigger', new Set(['trigger', 'email'])).flagged, false);
});

test('does NOT flag an allowlisted meta/client-only key', () => {
  assert.equal(scanRequestKey('silent', new Set()).flagged, false);
});
