// Unit tests for the i18n-parity gate (flattenKeys + classifyMissing).
// The positive is the class it fails the build on (a USED en key with no es
// translation → untranslated on ES); the negatives encode the discipline: an
// en-only key that's UNUSED is advisory-only (dead/built-ahead), and a key
// present in es is fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenKeys, classifyMissing } from '../check-i18n-parity.mjs';

test('flattenKeys produces dotted leaf keys', () => {
  assert.deepEqual(
    flattenKeys({ hero: { title: 'x', sub: 'y' }, nav: { home: 'z' } }).sort(),
    ['hero.sub', 'hero.title', 'nav.home'],
  );
});

test('FLAGS a USED en key missing from es (untranslated on ES)', () => {
  const enKeys = ['hero.title', 'admin.search.placeholder'];
  const esKeys = new Set(['hero.title']); // admin.search.placeholder missing
  const used = new Set(['admin.search.placeholder']); // it IS referenced in a component
  const { usedMissing, unusedMissing } = classifyMissing(enKeys, esKeys, (k) => used.has(k));
  assert.deepEqual(usedMissing, ['admin.search.placeholder']);
  assert.deepEqual(unusedMissing, []);
});

test('does NOT flag an UNUSED en-only key (advisory, dead/built-ahead)', () => {
  const enKeys = ['hero.title', 'admin.fab.title'];
  const esKeys = new Set(['hero.title']); // admin.fab.title missing
  const { usedMissing, unusedMissing } = classifyMissing(enKeys, esKeys, () => false); // nothing used
  assert.deepEqual(usedMissing, []);
  assert.deepEqual(unusedMissing, ['admin.fab.title']);
});

test('does NOT flag a key present in es', () => {
  const { usedMissing } = classifyMissing(['hero.title'], new Set(['hero.title']), () => true);
  assert.deepEqual(usedMissing, []);
});
