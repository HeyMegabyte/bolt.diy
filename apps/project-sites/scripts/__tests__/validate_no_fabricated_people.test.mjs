// Unit tests for the fabricated-people detector (scanForFabricatedPeople).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanForFabricatedPeople } from '../validate-no-fabricated-people.mjs';

test('flags a persona name literal paired with a quote in the same object', () => {
  const out = scanForFabricatedPeople(`const t = [{ name: 'Jane D.', quote: 'Amazing service' }];`);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Jane D.');
});

test('flags the alumni-card shape: body alongside role/years', () => {
  const out = scanForFabricatedPeople(
    `{ name: 'John Smith', role: 'Alumnus', years: '2008', body: 'Best decision I ever made.' }`,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'John Smith');
});

test('flags an org-endorser token with a testimonial signal', () => {
  const out = scanForFabricatedPeople(
    `{ name: 'First National Bank', testimonial: 'A great partner.' }`,
  );
  assert.equal(out.length, 1);
});

test('does NOT flag a staff directory entry (name + role, no quote)', () => {
  assert.deepEqual(scanForFabricatedPeople(`{ name: 'Jane Doe', role: 'Executive Director' }`), []);
});

test('does NOT flag a dynamic name (no string literal)', () => {
  assert.deepEqual(scanForFabricatedPeople('{ name: t.name, quote: t.quote }'), []);
});

test('does NOT flag a confirmed voice (allow-listed)', () => {
  const src = `{ name: 'Jane D.', quote: 'Amazing service' }`;
  assert.deepEqual(scanForFabricatedPeople(src, ['Jane D.']), []);
});

test('does NOT flag a non-persona name (e.g. a section label) with a quote nearby', () => {
  // "Our Services" is not person-shaped → not a persona even near a quote.
  assert.deepEqual(
    scanForFabricatedPeople(`{ name: 'Services', quote: 'Browse our offerings' }`),
    [],
  );
});

test('catches multiple distinct personas', () => {
  const out = scanForFabricatedPeople(
    `[{ name: 'Jane D.', quote: 'A' }, { name: 'Bob Smith', reviewBody: 'B' }]`,
  );
  assert.equal(out.length, 2);
});
