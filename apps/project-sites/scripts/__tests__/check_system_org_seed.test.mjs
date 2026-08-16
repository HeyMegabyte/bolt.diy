// Unit tests for the sentinel-org FK detector (check-system-org-seed.mjs).
// Shapes the real bug (iter-121: writeAuditLog({org_id:'system'}) → FK drop, fixed by
// seeding the system org in 0613) into the positive, and the false-positive classes
// (real org ids, non-system org seeds, unrelated migrations) into the negatives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeUsesSystemOrgSentinel,
  migrationSeedsSystemOrg,
  classifySystemOrgSeed,
} from '../check-system-org-seed.mjs';

// ── codeUsesSystemOrgSentinel ──
test('detects the writeAuditLog object-literal sentinel org_id', () => {
  const src = `await writeAuditLog(env, { org_id: 'system', action: 'auth.magic_link_requested' });`;
  assert.equal(codeUsesSystemOrgSentinel(src), true);
});

test('detects the SQL form org_id = \'system\'', () => {
  const src = `SELECT * FROM audit_logs WHERE org_id = 'system' ORDER BY created_at DESC`;
  assert.equal(codeUsesSystemOrgSentinel(src), true);
});

test('does NOT flag a real (variable / non-sentinel) org_id', () => {
  const src = `await writeAuditLog(env, { org_id: orgId, action: 'site.created' });
    await dbInsert(db, 'audit_logs', { org_id: 'org_7f3a91', action: 'billing.charged' });`;
  assert.equal(codeUsesSystemOrgSentinel(src), false);
});

// ── migrationSeedsSystemOrg ──
test('detects the system-org seed INSERT (the 0613 fix)', () => {
  const sql = `INSERT OR IGNORE INTO orgs (id, name, slug, created_at, updated_at, deleted_at)
    VALUES ('system', 'System (internal)', 'system', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');`;
  assert.equal(migrationSeedsSystemOrg(sql), true);
});

test('does NOT count an orgs INSERT for a different (non-system) org', () => {
  const sql = `INSERT INTO orgs (id, name, slug) VALUES ('demo-org', 'Demo Co', 'demo-co');`;
  assert.equal(migrationSeedsSystemOrg(sql), false);
});

test('does NOT count an unrelated migration (no orgs insert)', () => {
  const sql = `CREATE TABLE IF NOT EXISTS widgets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    ALTER TABLE sites ADD COLUMN system_flag INTEGER NOT NULL DEFAULT 0;`;
  assert.equal(migrationSeedsSystemOrg(sql), false);
});

// ── classifySystemOrgSeed (the repo-level invariant) ──
test('FLAGS the FK-drop bug: sentinel written, system org NOT seeded', () => {
  assert.equal(classifySystemOrgSeed({ codeUses: true, migrationSeeds: false }).flagged, true);
});

test('does NOT flag the fixed state: sentinel written AND system org seeded', () => {
  assert.equal(classifySystemOrgSeed({ codeUses: true, migrationSeeds: true }).flagged, false);
});

test('does NOT flag when no sentinel is used, regardless of seed presence', () => {
  assert.equal(classifySystemOrgSeed({ codeUses: false, migrationSeeds: false }).flagged, false);
  assert.equal(classifySystemOrgSeed({ codeUses: false, migrationSeeds: true }).flagged, false);
});
