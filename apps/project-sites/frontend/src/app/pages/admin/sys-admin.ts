/**
 * @module pages/admin/sys-admin
 *
 * Single source of truth for the **System Administrator** identity gate.
 *
 * The admin has a two-layer feature control plane:
 *  - **LAYER 1 — System Administrator** (`/admin/feature-flags`): platform-ops
 *    flags (toggle / roll out / killswitch ANY feature across the whole
 *    platform). This is operator-only — it must NEVER be visible to a normal
 *    site owner. Only the identities in {@link SYS_ADMIN_EMAILS} see it.
 *  - **LAYER 2 — Features** (`/admin/site-features`): owner-facing, site-scoped,
 *    plan-aware capabilities a client turns on for their own hosted site.
 *
 * This module gates the UI layer (nav visibility + route guard). The worker
 * still enforces real authorization on every `/api/feature-flags` write — the
 * frontend gate is a UX guard, not the security boundary.
 *
 * `brian@megabyte.space` is the canonical operator; `hey@megabyte.space` is the
 * same person's alternate magic-link identity — both are admitted so the layer
 * shows regardless of which address signs in.
 */
export const SYS_ADMIN_EMAILS: readonly string[] = ['brian@megabyte.space', 'hey@megabyte.space'];

/**
 * True when `email` belongs to a platform System Administrator.
 *
 * Case-insensitive + whitespace-trimmed; null / undefined / empty → false.
 *
 * @example
 * isSysAdminEmail('Brian@Megabyte.Space'); // true
 * isSysAdminEmail('owner@acme.com');       // false
 * isSysAdminEmail('');                      // false
 */
export function isSysAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SYS_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
