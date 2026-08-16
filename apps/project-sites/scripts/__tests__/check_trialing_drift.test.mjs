// Unit tests for the trialing-drift detector (check-trialing-drift.mjs).
// Shapes the 6 real bug sites (CHAOS pass-16 + the sibling sweep: active-only plan gates
// that dropped trialing paid subs to free) into the positives, and the false-positive
// classes (the fixed trialing-inclusive gate, the SSOT SQL, unrelated status checks,
// object-literal row shapes, resolveActiveOrgPlan calls) into the negatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTrialingDriftGates } from '../check-trialing-drift.mjs';

// ── POSITIVES: the exact active-only idioms that were the 6 bug sites ──

test('flags Form A (ternary): site_serving/site-generation `plan === paid && status === active`', () => {
  const src = `const plan = subRow?.plan === 'paid' && subRow.status === 'active' ? 'paid' : 'free';`;
  const hits = findTrialingDriftGates(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].form, 'A');
  assert.equal(hits[0].line, 1);
});

test('flags Form B (guard): getOrgEntitlements/getOrgTier `plan !== paid || status !== active`', () => {
  const src = `  if (!sub || sub.plan !== 'paid' || sub.status !== 'active') return 'free';`;
  const hits = findTrialingDriftGates(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].form, 'B');
});

test('flags the frontend r.data active-only variant', () => {
  const src = `this.plan.set(r.data?.plan === 'paid' && r.data?.status === 'active' ? 'paid' : 'free');`;
  assert.equal(findTrialingDriftGates(src).length, 1);
});

test('reports every offending line across a multi-gate file', () => {
  const src = [
    `const a = x.plan === 'paid' && x.status === 'active';`,
    `const ok = true;`,
    `if (s.plan !== 'paid' || s.status !== 'active') return 'free';`,
  ].join('\n');
  const hits = findTrialingDriftGates(src);
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((h) => h.line),
    [1, 3],
  );
});

// ── NEGATIVES: the fixed state + false-positive classes ──

test('does NOT flag the FIXED trialing-inclusive gate (worker)', () => {
  const src = `getEntitlements(orgId, (await resolveActiveOrgPlan(db, orgId)) === 'paid' ? 'paid' : 'free');`;
  assert.equal(findTrialingDriftGates(src).length, 0);
});

test('does NOT flag the FIXED trialing-inclusive gate (frontend, names trialing)', () => {
  const src = `r.data?.plan === 'paid' && (r.data?.status === 'active' || r.data?.status === 'trialing')`;
  assert.equal(findTrialingDriftGates(src).length, 0);
});

test('does NOT flag the SSOT SQL (IN active,trialing — names trialing, no === gate)', () => {
  const src = `"SELECT plan FROM subscriptions WHERE org_id = ? AND status IN ('active', 'trialing')"`;
  assert.equal(findTrialingDriftGates(src).length, 0);
});

test('does NOT flag an unrelated status check with no plan idiom (hostname/site/MCP status)', () => {
  const src = [
    `if (hostname.status === 'active') { serve(); }`,
    `const connected = m.status === 'active' || m.status === 'connected';`,
    `.filter((c) => c.status === 'active')`,
  ].join('\n');
  assert.equal(findTrialingDriftGates(src).length, 0);
});

test('does NOT flag object-literal row shapes / test mocks (`:` not `===`)', () => {
  const src = `mockQueryOne.mockResolvedValue({ plan: 'paid', status: 'active' });`;
  assert.equal(findTrialingDriftGates(src).length, 0);
});

test('does NOT flag a webhook WRITE that sets status active', () => {
  const src = `await dbUpdate(db, 'subscriptions', { plan: 'paid', status: 'active' }, 'id = ?', [id]);`;
  assert.equal(findTrialingDriftGates(src).length, 0);
});
