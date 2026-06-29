/**
 * site_transfer — pure domain functions for site-org transfer.
 *
 * Coverage targets:
 *  - createTransfer produces the expected shape and default `pending` status.
 *  - accept / reject / cancel each succeed from `pending` and throw otherwise.
 *  - isPending reflects the three non-pending states.
 *  - TransferError carries the correct metadata.
 *  - Every transition immutably returns a new object (reference !== input).
 */
import {
  createTransfer,
  accept,
  reject,
  cancel,
  isPending,
  TransferError,
} from '../services/site_transfer.js';
import type { TransferRequest } from '../services/site_transfer.js';

const SITE_ID = 'site_abc';
const FROM_ORG = 'org_a';
const TO_ORG = 'org_b';
const USER = 'user_1';

function buildPending(): TransferRequest {
  return createTransfer(SITE_ID, FROM_ORG, TO_ORG, USER);
}

// ── createTransfer ─────────────────────────────────────────────

describe('createTransfer', () => {
  it('returns a TransferRequest with the given fields', () => {
    const t = buildPending();
    expect(t.siteId).toBe(SITE_ID);
    expect(t.fromOrgId).toBe(FROM_ORG);
    expect(t.toOrgId).toBe(TO_ORG);
    expect(t.requestedBy).toBe(USER);
  });

  it('starts with status pending', () => {
    expect(buildPending().status).toBe('pending');
  });
});

// ── isPending ──────────────────────────────────────────────────

describe('isPending', () => {
  it('returns true for a newly created transfer', () => {
    expect(isPending(buildPending())).toBe(true);
  });

  it('returns false for an accepted transfer', () => {
    expect(isPending(accept(buildPending()))).toBe(false);
  });

  it('returns false for a rejected transfer', () => {
    expect(isPending(reject(buildPending()))).toBe(false);
  });

  it('returns false for a cancelled transfer', () => {
    expect(isPending(cancel(buildPending()))).toBe(false);
  });
});

// ── accept ─────────────────────────────────────────────────────

describe('accept', () => {
  it('transitions a pending transfer to accepted', () => {
    const result = accept(buildPending());
    expect(result.status).toBe('accepted');
  });

  it('returns a new object (immutable)', () => {
    const input = buildPending();
    const result = accept(input);
    expect(result).not.toBe(input);
    expect(input.status).toBe('pending'); // original unchanged
  });

  it('preserves all original fields', () => {
    const result = accept(buildPending());
    expect(result.siteId).toBe(SITE_ID);
    expect(result.fromOrgId).toBe(FROM_ORG);
    expect(result.toOrgId).toBe(TO_ORG);
    expect(result.requestedBy).toBe(USER);
  });

  it('throws TransferError when not pending', () => {
    const accepted = accept(buildPending());
    expect(() => accept(accepted)).toThrow(TransferError);
  });

  it('throws TransferError on already-rejected transfer', () => {
    const rejected = reject(buildPending());
    expect(() => accept(rejected)).toThrow(TransferError);
  });

  it('TransferError carries status and attemptedTransition metadata', () => {
    const rejected = reject(buildPending());
    try {
      accept(rejected);
    } catch (e) {
      const err = e as TransferError;
      expect(err.currentStatus).toBe('rejected');
      expect(err.attemptedTransition).toBe('accept');
    }
  });
});

// ── reject ─────────────────────────────────────────────────────

describe('reject', () => {
  it('transitions a pending transfer to rejected', () => {
    const result = reject(buildPending());
    expect(result.status).toBe('rejected');
  });

  it('returns a new object (immutable)', () => {
    const input = buildPending();
    const result = reject(input);
    expect(result).not.toBe(input);
    expect(input.status).toBe('pending');
  });

  it('preserves all original fields', () => {
    const result = reject(buildPending());
    expect(result.siteId).toBe(SITE_ID);
    expect(result.fromOrgId).toBe(FROM_ORG);
    expect(result.toOrgId).toBe(TO_ORG);
    expect(result.requestedBy).toBe(USER);
  });

  it('throws TransferError when not pending', () => {
    const rejected = reject(buildPending());
    expect(() => reject(rejected)).toThrow(TransferError);
  });

  it('reject(accepted) throws', () => {
    const accepted = accept(buildPending());
    expect(() => reject(accepted)).toThrow(TransferError);
  });
});

// ── cancel ─────────────────────────────────────────────────────

describe('cancel', () => {
  it('transitions a pending transfer to cancelled', () => {
    const result = cancel(buildPending());
    expect(result.status).toBe('cancelled');
  });

  it('returns a new object (immutable)', () => {
    const input = buildPending();
    const result = cancel(input);
    expect(result).not.toBe(input);
    expect(input.status).toBe('pending');
  });

  it('preserves all original fields', () => {
    const result = cancel(buildPending());
    expect(result.siteId).toBe(SITE_ID);
    expect(result.fromOrgId).toBe(FROM_ORG);
    expect(result.toOrgId).toBe(TO_ORG);
    expect(result.requestedBy).toBe(USER);
  });

  it('throws TransferError when not pending', () => {
    const cancelled = cancel(buildPending());
    expect(() => cancel(cancelled)).toThrow(TransferError);
  });

  it('cancel(accepted) throws', () => {
    expect(() => cancel(accept(buildPending()))).toThrow(TransferError);
  });

  it('cancel(rejected) throws', () => {
    expect(() => cancel(reject(buildPending()))).toThrow(TransferError);
  });
});
