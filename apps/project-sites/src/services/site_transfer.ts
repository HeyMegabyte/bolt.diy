/**
 * @module services/site_transfer
 * @description Pure domain functions for transferring site ownership between orgs.
 *
 * A transfer request moves a site from one org (`fromOrgId`) to another (`toOrgId`).
 * The lifecycle is: pending → accepted / rejected / cancelled.
 * All functions are deterministic and side-effect-free.
 *
 * @example
 * ```ts
 * const req = createTransfer(siteId, fromOrgId, toOrgId, requestedBy);
 * //                                         └─> User ID of the person who started it
 * // pending → accept
 * const accepted = accept(req);
 * expect(accepted.status).toBe('accepted');
 *
 * // pending → reject
 * const rejected = reject(req);
 * expect(rejected.status).toBe('rejected');
 * ```
 *
 * @throws {TransferError} when a transition is invalid
 */

// ── Types ──────────────────────────────────────────────────────

export type TransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface TransferRequest {
  siteId: string;
  fromOrgId: string;
  toOrgId: string;
  requestedBy: string;
  status: TransferStatus;
}

// ── Errors ─────────────────────────────────────────────────────

/**
 * Thrown when an invalid state transition is attempted (e.g. accepting a rejected transfer).
 */
export class TransferError extends Error {
  constructor(
    message: string,
    public readonly currentStatus: TransferStatus,
    public readonly attemptedTransition: string,
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

// ── Guards ─────────────────────────────────────────────────────

/**
 * Returns true when the transfer is in the `pending` state and can still
 * be accepted, rejected, or cancelled.
 *
 * @example
 * ```ts
 * const req = createTransfer(siteId, a, b, user);
 * expect(isPending(req)).toBe(true);
 * const accepted = accept(req);
 * expect(isPending(accepted)).toBe(false);
 * ```
 */
export function isPending(transfer: TransferRequest): boolean {
  return transfer.status === 'pending';
}

// ── Core functions ─────────────────────────────────────────────

/**
 * Create a new transfer request in the `pending` state.
 *
 * @remarks Pure — no I/O, no side-effects. Returns a detached object.
 *
 * @param siteId    - The site being transferred.
 * @param fromOrgId - The current owning org.
 * @param toOrgId   - The target org the site will move to.
 * @param requestedBy - User ID of the person requesting the transfer.
 *
 * @example
 * ```ts
 * const t = createTransfer('site_abc', 'org_a', 'org_b', 'user_1');
 * expect(t.status).toBe('pending');
 * ```
 */
export function createTransfer(
  siteId: string,
  fromOrgId: string,
  toOrgId: string,
  requestedBy: string,
): TransferRequest {
  return {
    fromOrgId,
    requestedBy,
    siteId,
    status: 'pending',
    toOrgId,
  };
}

/**
 * Accept a pending transfer. Marks the transfer as `accepted`.
 *
 * @throws {TransferError} if the transfer is not in the `pending` state.
 *
 * @example
 * ```ts
 * const t = createTransfer('s', 'a', 'b', 'u');
 * const a = accept(t);
 * expect(a.status).toBe('accepted');
 * ```
 */
export function accept(transfer: TransferRequest): TransferRequest {
  if (!isPending(transfer)) {
    throw new TransferError(
      'Cannot accept a transfer that is not pending',
      transfer.status,
      'accept',
    );
  }
  return { ...transfer, status: 'accepted' };
}

/**
 * Reject a pending transfer. Marks the transfer as `rejected`.
 *
 * @throws {TransferError} if the transfer is not in the `pending` state.
 *
 * @example
 * ```ts
 * const t = createTransfer('s', 'a', 'b', 'u');
 * const r = reject(t);
 * expect(r.status).toBe('rejected');
 * ```
 */
export function reject(transfer: TransferRequest): TransferRequest {
  if (!isPending(transfer)) {
    throw new TransferError(
      'Cannot reject a transfer that is not pending',
      transfer.status,
      'reject',
    );
  }
  return { ...transfer, status: 'rejected' };
}

/**
 * Cancel a pending transfer. Marks the transfer as `cancelled`.
 *
 * @remarks A cancellation is distinct from a rejection — the originator cancels,
 * the recipient rejects. Both require the `pending` state.
 *
 * @throws {TransferError} if the transfer is not in the `pending` state.
 *
 * @example
 * ```ts
 * const t = createTransfer('s', 'a', 'b', 'u');
 * const c = cancel(t);
 * expect(c.status).toBe('cancelled');
 * ```
 */
export function cancel(transfer: TransferRequest): TransferRequest {
  if (!isPending(transfer)) {
    throw new TransferError(
      'Cannot cancel a transfer that is not pending',
      transfer.status,
      'cancel',
    );
  }
  return { ...transfer, status: 'cancelled' };
}
