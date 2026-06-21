/**
 * Pure-builder coverage for the live-pipeline smoke probe. Run:
 *   node --test scripts/__tests__/tinybird-smoke.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfig,
  buildSmokeEvent,
  eventsDailyHasRow,
  smokeDeleteCondition,
} from '../tinybird-smoke.mjs';

test('resolveConfig mirrors the worker token chain + trims host', () => {
  assert.deepEqual(resolveConfig({ TINYBIRD_API_HOST: 'https://h/', TINYBIRD_PASSWORD: 'p' }), {
    host: 'https://h',
    token: 'p',
  });
  assert.equal(resolveConfig({ TINYBIRD_PASSWORD: 'p' }), null); // no host
});

test('buildSmokeEvent matches the dispatchOutboxEvent shape under the sentinel tenant', () => {
  const e = buildSmokeEvent('2026-06-20 21:00:00', 'X');
  assert.equal(e.tenant_id, '_smoke'); // never a real org
  assert.equal(e.event, 'site.published');
  assert.equal(e.event_id, 'smoke-X');
  assert.deepEqual(Object.keys(e).sort(), [
    'event',
    'event_id',
    'payload',
    'producer',
    'site_id',
    'tenant_id',
    'timestamp',
    'trace_id',
  ]);
  // payload is a JSON string carrying source (exercises the JSONExtract path)
  assert.equal(JSON.parse(e.payload).source, 'smoke-test');
});

test('smokeDeleteCondition scopes deletion to the sentinel tenant only', () => {
  assert.equal(smokeDeleteCondition(), "tenant_id = '_smoke'");
  // must never match a real tenant
  assert.doesNotMatch(smokeDeleteCondition(), /org|tenant_id\s*!=|OR/i);
});

test('eventsDailyHasRow matches the sentinel publish row, ignores others', () => {
  assert.equal(
    eventsDailyHasRow([{ tenant_id: '_smoke', event: 'site.published', events: 1 }], 'x'),
    true,
  );
  assert.equal(eventsDailyHasRow([{ tenant_id: 'org-1', event: 'site.published' }], 'x'), false);
  assert.equal(eventsDailyHasRow([{ tenant_id: '_smoke', event: 'site.created' }], 'x'), false);
  assert.equal(eventsDailyHasRow([], 'x'), false);
});
