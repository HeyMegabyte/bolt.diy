// Unit tests for the hardcoded-admin-email detector (isHardcodedAdminCheck).
// Positive + false-positive coverage per validator-precision-discipline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHardcodedAdminCheck } from '../check-hardcoded-admin-email.mjs';

// --- positives: a hardcoded admin email used as a CHECK operand ---
test('flags `=== brian@` comparison', () => {
  assert.equal(isHardcodedAdminCheck(`  if (owner?.email === 'brian@megabyte.space') {`), true);
});

test('flags `.includes(hey@)` membership check', () => {
  assert.equal(
    isHardcodedAdminCheck(`  if (admins.includes('hey@megabyte.space')) return true;`),
    true,
  );
});

test('flags `!== brian@`', () => {
  assert.equal(
    isHardcodedAdminCheck(`  if (email !== 'brian@megabyte.space') return notFound(c);`),
    true,
  );
});

test('flags the email on the LEFT of ===', () => {
  assert.equal(isHardcodedAdminCheck(`  if ('brian@megabyte.space' === u.email) {`), true);
});

// --- negatives: legit uses that must NOT flag (false-positive discipline) ---
test('does NOT flag a manifest owner field', () => {
  assert.equal(isHardcodedAdminCheck(`  owner: 'brian@megabyte.space',`), false);
});

test('does NOT flag a mailto contact link', () => {
  assert.equal(
    isHardcodedAdminCheck(`<a href="mailto:hey@megabyte.space">hey@megabyte.space</a>`),
    false,
  );
});

test('does NOT flag a TEST_LOGIN_EMAIL assignment (single = , not a check)', () => {
  assert.equal(
    isHardcodedAdminCheck(`export const TEST_LOGIN_EMAIL = 'brian@megabyte.space';`),
    false,
  );
});

test('does NOT flag prose that merely mentions the email (unquoted)', () => {
  assert.equal(
    isHardcodedAdminCheck(`owner brian@megabyte.space reviews the sitemap plan.`),
    false,
  );
});
