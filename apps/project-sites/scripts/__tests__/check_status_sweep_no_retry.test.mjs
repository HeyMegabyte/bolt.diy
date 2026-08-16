// Unit tests for the premature-terminal / no-retry detector (classifyStatusSweep).
// Positive + false-positive coverage per validator-precision-discipline: the two
// real bugs (iters 115/116) shape the positives; the two false positives caught
// during authoring (E2E result objects, an event-sourced reducer) shape the negatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatusSweep } from '../check-status-sweep-no-retry.mjs';

// ── POSITIVE: a real sweep that fails-terminal on the first error, no guard ──
test('FLAGS a WHERE status=pending sweep that writes a terminal status with no guard', () => {
  const src = `
    const { data: rows } = await dbQuery(env.DB,
      \`SELECT id FROM outbox WHERE status = 'pending' ORDER BY created_by ASC LIMIT ?\`, [max]);
    for (const r of rows) {
      try { await dispatch(r); }
      catch { await dbUpdate(env.DB, 'outbox', { status: 'failed' }, 'id = ?', [r.id]); }
    }`;
  assert.equal(classifyStatusSweep(src).flagged, true);
});

// ── NEGATIVE: guarded by a grace period on created_at (the domains.ts fix) ──
test('does NOT flag a sweep guarded by a created_at grace period', () => {
  const src = `
    const { data: rows } = await dbQuery(env.DB,
      \`SELECT id, created_at FROM hostnames WHERE status = 'pending'\`, []);
    for (const r of rows) {
      const ageMs = Date.now() - new Date(r.created_at).getTime();
      const next = errors && ageMs > VERIFY_GRACE_MS ? 'verification_failed' : 'pending';
      await dbUpdate(env.DB, 'hostnames', { status: next }, 'id = ?', [r.id]);
    }`;
  assert.equal(classifyStatusSweep(src).flagged, false);
});

// ── NEGATIVE: guarded by re-reading retryable-terminal rows (the event_bus.ts fix) ──
test('does NOT flag a sweep that re-reads retryable failed rows (attempts < MAX)', () => {
  const src = `
    const { data } = await dbQuery(env.DB,
      \`SELECT * FROM outbox WHERE status = 'pending' OR (status = 'failed' AND attempts < ?)\`, [MAX]);
    await dbExecute(env.DB, \`UPDATE outbox SET status = 'failed', attempts = attempts + 1 WHERE id = ?\`, [id]);`;
  assert.equal(classifyStatusSweep(src).flagged, false);
});

// ── NEGATIVE (FP class #1): in-memory result objects carrying status:'failed' ──
test('does NOT flag E2E/result objects that merely carry a status field (no SQL sweep)', () => {
  const src = `
    function runCheck(): { detail: string; status: string } {
      if (!ok) return { detail: 'HTTP 500', status: 'failed' };
      return { detail: 'ok', status: 'passed' };
    }`;
  assert.equal(classifyStatusSweep(src).flagged, false);
});

// ── NEGATIVE (FP class #2): an event-sourced reducer (no WHERE sweep) ──
test('does NOT flag an event-sourced reducer that transitions status in memory', () => {
  const src = `
    function applyEvent(s, ev) {
      if (ev.type === 'fail') return { ...s, status: 'failed', attempts: s.attempts + 1 };
      return { ...s, status: 'pending' };
    }`;
  assert.equal(classifyStatusSweep(src).flagged, false);
});

// ── NEGATIVE: an aggregate projection (a COUNT, not a row sweep) ──
test('does NOT flag a SUM(CASE WHEN status=pending) aggregate + an unrelated failed write', () => {
  const src = `
    const row = await dbQueryOne(env.DB,
      \`SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending FROM subscriptions WHERE org_id = ?\`, [org]);
    await dbUpdate(env.DB, 'subscriptions', { status: 'failed' }, 'id = ?', [id]);`;
  assert.equal(classifyStatusSweep(src).flagged, false);
});
