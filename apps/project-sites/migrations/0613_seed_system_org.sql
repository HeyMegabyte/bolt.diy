-- 0613_seed_system_org.sql
--
-- Seed the sentinel `system` org so SYSTEM-SCOPED audit writes stop being dropped.
--
-- ROOT CAUSE (found via CHAOS browser pass, iter-121 tail): pre-auth security events
-- are audited with `org_id: 'system'` because the user may not exist yet
-- (`src/routes/api.ts` magic-link/OAuth handlers, e.g. `auth.magic_link_requested`).
-- `audit_logs.org_id` is `TEXT NOT NULL REFERENCES orgs(id)`, but no `system` org row
-- existed -> every such write failed with `D1_ERROR: FOREIGN KEY constraint failed`,
-- silently discarding auth/security audit events (login-link requests, OAuth starts).
--
-- FIX: insert a `system` org row so the FK is satisfied and the audits persist.
-- It is seeded SOFT-DELETED (deleted_at set) so it is a pure FK-satisfying sentinel:
--   * The FK only checks PK existence -> a soft-deleted row still satisfies it.
--   * Every app query filters `WHERE deleted_at IS NULL` (weekly digest, org listings,
--     counts) -> the sentinel never leaks into any user-facing surface.
--   * The org-scoped audit read (`GET /api/audit/rows` WHERE org_id = <caller>) never
--     surfaces `system` rows anyway (no user is a member of the `system` org).
-- Timestamps are pinned to the epoch to signal "sentinel, never a live org".
--
-- Idempotent: INSERT OR IGNORE leaves any pre-existing `system` org untouched (a live
-- one would also satisfy the FK), so this migration is safe to re-run on any D1.
INSERT OR IGNORE INTO orgs (id, name, slug, created_at, updated_at, deleted_at)
VALUES (
  'system',
  'System (internal)',
  'system',
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z'
);
