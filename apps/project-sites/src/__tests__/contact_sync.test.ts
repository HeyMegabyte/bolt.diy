/**
 * @module __tests__/contact_sync
 * @description Unit tests for {@link services/contact_sync} — all pure,
 * no mocks, no I/O.
 */

import { mergeContacts, dedupeContacts, diffContacts } from '../services/contact_sync.js';
import type { Contact } from '../services/contact_sync.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const alice: Contact = {
  email: 'alice@example.com',
  name: 'Alice',
  source: 'listmonk',
  lastUpdated: 1000,
  attribs: { list_id: '3', city: 'Newark' },
};

const aliceNewer: Contact = {
  email: 'alice@example.com',
  name: 'Alice Updated',
  source: 'twenty',
  lastUpdated: 2000,
  attribs: { list_id: '3', company: 'Acme' },
};

const bob: Contact = {
  email: 'bob@example.com',
  name: 'Bob',
  source: 'twenty',
  lastUpdated: 1500,
  attribs: { role: 'admin' },
};

const charlie: Contact = {
  email: 'charlie@example.com',
  name: 'Charlie',
  source: 'projectsites',
  lastUpdated: 1200,
  attribs: { signup: 'organic' },
};

// ---------------------------------------------------------------------------
// mergeContacts
// ---------------------------------------------------------------------------
describe('mergeContacts', () => {
  it('returns newer record name when second arg is newer', () => {
    const merged = mergeContacts(alice, aliceNewer);
    expect(merged.name).toBe('Alice Updated');
    expect(merged.source).toBe('twenty');
    expect(merged.lastUpdated).toBe(2000);
  });

  it('returns newer record name when first arg is newer', () => {
    const merged = mergeContacts(aliceNewer, alice);
    expect(merged.name).toBe('Alice Updated');
    expect(merged.source).toBe('twenty');
    expect(merged.lastUpdated).toBe(2000);
  });

  it('deep-merges attribs with newer record keys preferred', () => {
    // alice has { list_id: '3', city: 'Newark' }
    // aliceNewer has { list_id: '3', company: 'Acme' }
    const merged = mergeContacts(alice, aliceNewer);
    expect(merged.attribs).toEqual({
      list_id: '3',
      city: 'Newark',
      company: 'Acme',
    });
  });

  it('sets email from first argument regardless of which is newer', () => {
    const merged = mergeContacts(alice, aliceNewer);
    expect(merged.email).toBe('alice@example.com');
  });

  it('handles equal lastUpdated — first arg is newer by rule', () => {
    const a: Contact = { ...alice, lastUpdated: 5000, name: 'A' };
    const b: Contact = { ...aliceNewer, lastUpdated: 5000, name: 'B' };
    const merged = mergeContacts(a, b);
    // a.lastUpdated >= b.lastUpdated → a is "newer"
    expect(merged.name).toBe('A');
  });

  it('does not mutate inputs', () => {
    const a = { ...alice };
    const b = { ...aliceNewer };
    const _merged = mergeContacts(a, b);
    expect(a.lastUpdated).toBe(1000);
    expect(b.lastUpdated).toBe(2000);
  });

  it('works when attribs are empty on both contacts', () => {
    const a: Contact = { ...alice, attribs: {} };
    const b: Contact = { ...aliceNewer, attribs: {} };
    const merged = mergeContacts(a, b);
    expect(merged.attribs).toEqual({});
    expect(merged.name).toBe('Alice Updated');
  });
});

// ---------------------------------------------------------------------------
// dedupeContacts
// ---------------------------------------------------------------------------
describe('dedupeContacts', () => {
  it('returns same list when no duplicates', () => {
    const result = dedupeContacts([alice, bob, charlie]);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'charlie@example.com',
    ]);
  });

  it('deduplicates by email keeping newest', () => {
    const result = dedupeContacts([alice, bob, aliceNewer]);
    expect(result).toHaveLength(2);
    const aliceResult = result.find((c) => c.email === 'alice@example.com')!;
    expect(aliceResult.name).toBe('Alice Updated');
    expect(aliceResult.source).toBe('twenty');
  });

  it('keeps first-occurrence order after dedup', () => {
    const result = dedupeContacts([bob, alice, charlie, aliceNewer]);
    expect(result.map((c) => c.email)).toEqual([
      'bob@example.com',
      'alice@example.com',
      'charlie@example.com',
    ]);
  });

  it('merges attribs from duplicates via mergeContacts', () => {
    const a: Contact = {
      ...alice,
      lastUpdated: 100,
      attribs: { tag_a: 'red', shared: 'old' },
    };
    const b: Contact = {
      ...aliceNewer,
      lastUpdated: 200,
      attribs: { tag_b: 'blue', shared: 'new' },
    };
    const result = dedupeContacts([a, b]);
    const aliceResult = result.find((c) => c.email === 'alice@example.com')!;
    // newer wins on attribs → b is newer → b's attribs override a's
    expect(aliceResult.attribs).toEqual({
      tag_a: 'red',
      shared: 'new',
      tag_b: 'blue',
    });
  });

  it('handles empty array', () => {
    expect(dedupeContacts([])).toEqual([]);
  });

  it('handles all same email duplicates', () => {
    const result = dedupeContacts([alice, alice, aliceNewer]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice Updated');
  });

  it('does not mutate input array', () => {
    const input: Contact[] = [alice, bob, aliceNewer];
    const inputCopy = input.map((c) => ({ ...c }));
    dedupeContacts(input);
    expect(input).toEqual(inputCopy);
  });
});

// ---------------------------------------------------------------------------
// diffContacts
// ---------------------------------------------------------------------------
describe('diffContacts', () => {
  it('returns empty diff when source and target are identical', () => {
    const { add, update, remove } = diffContacts([alice, bob], [alice, bob]);
    expect(add).toHaveLength(0);
    expect(update).toHaveLength(0);
    expect(remove).toHaveLength(0);
  });

  it('identifies new contacts as adds', () => {
    const { add, update, remove } = diffContacts([alice], [alice, bob]);
    expect(add).toHaveLength(1);
    expect(add[0].email).toBe('bob@example.com');
    expect(update).toHaveLength(0);
    expect(remove).toHaveLength(0);
  });

  it('identifies removed emails', () => {
    const { add, update, remove } = diffContacts([alice, bob], [alice]);
    expect(add).toHaveLength(0);
    expect(update).toHaveLength(0);
    expect(remove).toEqual(['bob@example.com']);
  });

  it('identifies updated contacts when lastUpdated differs', () => {
    const { add, update, remove } = diffContacts([alice], [aliceNewer]);
    expect(add).toHaveLength(0);
    expect(update).toHaveLength(1);
    expect(update[0].email).toBe('alice@example.com');
    expect(update[0].name).toBe('Alice Updated');
    expect(remove).toHaveLength(0);
  });

  it('handles simultaneous adds, updates, and removes', () => {
    const source = [alice, bob];
    const target = [aliceNewer, charlie];

    const { add, update, remove } = diffContacts(source, target);

    // aliceNewer → update
    expect(update).toHaveLength(1);
    expect(update[0].email).toBe('alice@example.com');

    // charlie → add
    expect(add).toHaveLength(1);
    expect(add[0].email).toBe('charlie@example.com');

    // bob → remove
    expect(remove).toHaveLength(1);
    expect(remove[0]).toBe('bob@example.com');
  });

  it('does not flag as update when lastUpdated is identical', () => {
    const sameAlice: Contact = { ...alice, source: 'twenty' };
    const { update } = diffContacts([alice], [sameAlice]);
    expect(update).toHaveLength(0);
  });

  it('handles empty source', () => {
    const { add, update, remove } = diffContacts([], [alice, bob]);
    expect(add).toHaveLength(2);
    expect(update).toHaveLength(0);
    expect(remove).toHaveLength(0);
  });

  it('handles empty target', () => {
    const { add, update, remove } = diffContacts([alice, bob], []);
    expect(add).toHaveLength(0);
    expect(update).toHaveLength(0);
    expect(remove).toHaveLength(2);
  });

  it('handles both empty', () => {
    const { add, update, remove } = diffContacts([], []);
    expect(add).toHaveLength(0);
    expect(update).toHaveLength(0);
    expect(remove).toHaveLength(0);
  });

  it('does not mutate inputs', () => {
    const source = [alice, bob];
    const target = [aliceNewer, charlie];
    const sourceCopy = source.map((c) => ({ ...c }));
    const targetCopy = target.map((c) => ({ ...c }));
    diffContacts(source, target);
    expect(source).toEqual(sourceCopy);
    expect(target).toEqual(targetCopy);
  });
});
