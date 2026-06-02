import {
  effectiveApprovalStatus,
  applyApprovalAction,
  type ApprovalLinkState,
} from '../services/review_approval.js';

const PAST = '2026-01-01T00:00:00.000Z';
const NOW = '2026-06-01T00:00:00.000Z';
const FUTURE = '2026-12-31T00:00:00.000Z';

describe('effectiveApprovalStatus', () => {
  it('keeps a pending link pending when expiry is in the future', () => {
    expect(effectiveApprovalStatus({ status: 'pending', expiresAt: FUTURE }, NOW)).toBe('pending');
  });

  it('keeps a pending link pending when there is no expiry', () => {
    expect(effectiveApprovalStatus({ status: 'pending', expiresAt: null }, NOW)).toBe('pending');
  });

  it('derives expired for a pending link past its expiry', () => {
    expect(effectiveApprovalStatus({ status: 'pending', expiresAt: PAST }, NOW)).toBe('expired');
  });

  it('leaves terminal statuses unchanged even past expiry', () => {
    expect(effectiveApprovalStatus({ status: 'approved', expiresAt: PAST }, NOW)).toBe('approved');
    expect(effectiveApprovalStatus({ status: 'rejected', expiresAt: PAST }, NOW)).toBe('rejected');
    expect(effectiveApprovalStatus({ status: 'revoked', expiresAt: PAST }, NOW)).toBe('revoked');
  });
});

describe('applyApprovalAction', () => {
  const pending: ApprovalLinkState = { status: 'pending', expiresAt: FUTURE };

  it('approves a pending link', () => {
    expect(applyApprovalAction(pending, 'approve', NOW)).toEqual({ ok: true, next: 'approved' });
  });

  it('rejects a pending link', () => {
    expect(applyApprovalAction(pending, 'reject', NOW)).toEqual({ ok: true, next: 'rejected' });
  });

  it('revokes a pending link', () => {
    expect(applyApprovalAction(pending, 'revoke', NOW)).toEqual({ ok: true, next: 'revoked' });
  });

  it('refuses to act on an expired link', () => {
    const res = applyApprovalAction({ status: 'pending', expiresAt: PAST }, 'approve', NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('expired');
  });

  it('refuses to re-decide an already-approved link', () => {
    const res = applyApprovalAction({ status: 'approved', expiresAt: null }, 'approve', NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('approved');
  });

  it('refuses to act on a rejected or revoked link', () => {
    expect(applyApprovalAction({ status: 'rejected', expiresAt: null }, 'reject', NOW).ok).toBe(false);
    expect(applyApprovalAction({ status: 'revoked', expiresAt: null }, 'revoke', NOW).ok).toBe(false);
  });
});
