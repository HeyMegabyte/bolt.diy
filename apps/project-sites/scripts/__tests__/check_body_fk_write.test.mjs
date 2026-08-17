// Unit tests for the body-FK-write triage tripwire (scanText / untriaged / ALLOWLIST).
// The tripwire enumerates `X_id: body.X_id` stores and flags any field NOT in the triaged
// ALLOWLIST — the class of the calendar EVENTS (iter-162) + BOOKINGS (iter-177) cross-owner
// FK IDORs. Prefers false-negatives: allowlisted fields + self-scope + local-var stores
// never fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, untriaged, ALLOWLIST } from '../check-body-fk-write.mjs';

test('scanText finds a body-supplied *_id store', () => {
  const hits = scanText(`await dbInsert(db, 't', { calendar_id: body.calendar_id ?? null });`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].field, 'calendar_id');
});

test('scanText matches data / parsed / input forms too', () => {
  assert.equal(scanText(`{ folder_id: data.folder_id }`)[0].field, 'folder_id');
  assert.equal(scanText(`{ campaign_id: parsed.campaign_id }`)[0].field, 'campaign_id');
  assert.equal(scanText(`{ list_id: input.list_id }`)[0].field, 'list_id');
});

test('scanText SKIPS self-scope columns (org_id/user_id are the x-org-id class, a different guard)', () => {
  assert.equal(scanText(`{ org_id: body.org_id, user_id: body.user_id }`).length, 0);
});

test('scanText does NOT match a store from a LOCAL var (the gated / ownership-checked shape)', () => {
  // The events/bookings creates read body.calendar_id into a local AFTER an ownership SELECT,
  // then store the LOCAL (`calendar_id: calendarId`) — so the raw `X_id: body.X_id` object
  // pattern does not match a gated handler (no false positive on the fix).
  assert.equal(
    scanText(`let calendarId = body.calendar_id; { calendar_id: calendarId }`).length,
    0,
  );
});

test('untriaged FLAGS a NEW field not in the ALLOWLIST (a fresh body-FK to review)', () => {
  const flagged = untriaged(`await dbInsert(db, 'x', { parent_id: body.parent_id ?? null });`);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].field, 'parent_id');
});

test('untriaged does NOT flag an allowlisted (triaged) field', () => {
  assert.equal(untriaged(`{ calendar_id: body.calendar_id }`).length, 0);
  assert.equal(untriaged(`{ thread_id: body.thread_id }`).length, 0);
  assert.equal(untriaged(`{ commit_id: body.commit_id }`).length, 0);
});

test('ALLOWLIST documents the calendar FK the two fixed IDORs are about', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(ALLOWLIST, 'calendar_id'));
  // Every allowlist entry carries a non-empty reason (the triage note).
  for (const [field, reason] of Object.entries(ALLOWLIST)) {
    assert.ok(reason.length > 20, `allowlist ${field} needs a real reason`);
  }
});
