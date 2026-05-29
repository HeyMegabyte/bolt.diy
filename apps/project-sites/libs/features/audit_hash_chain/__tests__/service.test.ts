/**
 * Unit tests for audit_hash_chain service.
 *
 * Pure functions only — no D1 dependency. The hash-chain math is the
 * critical invariant; a regression here voids the SOC 2 claim.
 */

import { canonicalize, hashInput, sha256Hex } from '../service.js';
import { GENESIS_HASH, type HashablePayload } from '../schemas.js';

describe('audit_hash_chain/service', () => {
  describe('canonicalize', () => {
    test('sorts object keys deterministically', () => {
      const a = canonicalize({ b: 1, a: 2 });
      const b = canonicalize({ a: 2, b: 1 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":2,"b":1}');
    });

    test('preserves array order (arrays are semantically ordered)', () => {
      expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    });

    test('handles nested objects', () => {
      const v = canonicalize({ z: { y: 1, x: 2 }, a: [{ b: 1, a: 2 }] });
      expect(v).toBe('{"a":[{"a":2,"b":1}],"z":{"x":2,"y":1}}');
    });

    test('preserves null', () => {
      expect(canonicalize({ a: null })).toBe('{"a":null}');
    });
  });

  describe('sha256Hex', () => {
    test('matches a known SHA-256 digest', async () => {
      // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
      const h = await sha256Hex('abc');
      expect(h).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    test('produces 64 lowercase hex chars', async () => {
      const h = await sha256Hex('arbitrary input');
      expect(h).toHaveLength(64);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    test('changes for any single-bit input change', async () => {
      const a = await sha256Hex('hash chain test');
      const b = await sha256Hex('hash chain Test');
      expect(a).not.toBe(b);
    });
  });

  describe('hashInput', () => {
    const samplePayload: HashablePayload = {
      audit_id: 'aud_1',
      org_id: 'org_1',
      actor_id: 'user_1',
      action: 'site.created',
      target_type: 'site',
      target_id: 'site_1',
      message: 'Site created',
      metadata: null,
      ts: '2026-05-28T12:00:00.000Z',
    };

    test('embeds prev_hash, canonical payload, and ts', () => {
      const input = hashInput(GENESIS_HASH, samplePayload);
      expect(input.startsWith(GENESIS_HASH)).toBe(true);
      expect(input.endsWith(samplePayload.ts)).toBe(true);
      expect(input).toContain('"action":"site.created"');
    });

    test('is deterministic for identical inputs', () => {
      const a = hashInput(GENESIS_HASH, samplePayload);
      const b = hashInput(GENESIS_HASH, samplePayload);
      expect(a).toBe(b);
    });

    test('changes when prev_hash differs', () => {
      const a = hashInput(GENESIS_HASH, samplePayload);
      const b = hashInput(
        ('a'.repeat(64)) as `${string}`,
        samplePayload,
      );
      expect(a).not.toBe(b);
    });
  });

  describe('genesis', () => {
    test('GENESIS_HASH is 64 zeros', () => {
      expect(GENESIS_HASH).toBe('0'.repeat(64));
      expect(GENESIS_HASH).toHaveLength(64);
    });
  });

  describe('end-to-end hash chain math', () => {
    test('two-entry chain matches recomputed digests', async () => {
      const p1: HashablePayload = {
        audit_id: 'a1',
        org_id: 'org_1',
        actor_id: 'u1',
        action: 'auth.login',
        target_type: null,
        target_id: null,
        message: 'Login',
        metadata: null,
        ts: '2026-05-28T00:00:00.000Z',
      };
      const p2: HashablePayload = {
        audit_id: 'a2',
        org_id: 'org_1',
        actor_id: 'u1',
        action: 'site.created',
        target_type: 'site',
        target_id: 's1',
        message: 'Site created',
        metadata: { foo: 'bar' },
        ts: '2026-05-28T00:01:00.000Z',
      };
      const h1 = await sha256Hex(hashInput(GENESIS_HASH, p1));
      const h2 = await sha256Hex(hashInput(h1 as `${string}`, p2));
      // Determinism — recomputing the same chain yields the same hashes.
      const h1b = await sha256Hex(hashInput(GENESIS_HASH, p1));
      const h2b = await sha256Hex(hashInput(h1b as `${string}`, p2));
      expect(h1).toBe(h1b);
      expect(h2).toBe(h2b);
      // Tampering anywhere breaks the chain.
      const tampered = { ...p1, action: 'auth.LOGIN' };
      const tHash = await sha256Hex(hashInput(GENESIS_HASH, tampered));
      expect(tHash).not.toBe(h1);
    });
  });
});
