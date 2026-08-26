# site_versioning

A site's **version history** surface: the named-snapshot rollback points (D1
`site_snapshots`), the R2-stored git-style commit chain, and a client-assembled
snapshot download manifest. **Core, un-gated** routes (no feature flag) — a
route-organization module extracted from the `api.ts` monolith
(route-decomposition installment 9), not a dark-launched feature.

## Routes (`handlers.ts` → `siteVersioning`, mounted at `app.route('/', siteVersioning)`)

| Method | Path                                                | Auth  | Purpose                                              |
| ------ | --------------------------------------------------- | ----- | ---------------------------------------------------- |
| GET    | `/api/sites/:siteId/snapshots`                      | orgId | List D1 snapshots + R2 git history                   |
| GET    | `/api/sites/:siteId/snapshots/diff`                 | orgId | Side-by-side file diff between two snapshots (+AI summary) |
| POST   | `/api/sites/:siteId/snapshots`                      | orgId | Freeze current/specified build as a named snapshot    |
| DELETE | `/api/sites/:siteId/snapshots/:snapshotId`          | orgId | Soft-delete a snapshot row (R2 files survive 30d grace) |
| POST   | `/api/sites/:siteId/snapshots/revert`               | orgId | Forward-rolling revert to an R2 git commit            |
| POST   | `/api/sites/:siteId/snapshots/:snapshotId/restore`  | orgId | Re-point the live build to a snapshot's frozen version |
| GET    | `/api/sites/:siteId/git/history`                    | orgId | Walk the R2 git commit chain from HEAD                |
| GET    | `/api/sites/:siteId/git/diff`                       | orgId | Diff two commits in the R2 git chain                 |
| GET    | `/api/sites/:siteId/git/commits/:commitId`          | orgId | Read one commit's metadata + file list                |
| GET    | `/api/sites/:id/snapshots/:snapId/download`         | orgId | JSON download manifest of a snapshot's R2 files       |

## Boundaries

- Every route is org-scoped via `c.get('orgId')` (401 envelope when missing) and
  guards site ownership through `requireOwnedSite` — a missing/foreign site
  collapses to **404 (never 403)** so cross-org sites don't leak.
- Two disjoint timelines by design: **snapshots** are sparse, user-named
  save-points in D1 `site_snapshots` (soft-delete via `deleted_at`; R2 build
  files survive a 30-day grace window); **git commits** are the dense, per-build
  AI-generated chain stored on R2 at `sites/{slug}/.git/`. The frontend renders
  them separately so the user picks the right rollback granularity.
- Delegates to `services/git.ts` (`getHistory` / `diffSnapshots` / `getCommit` /
  `revertToSnapshot`) and `services/snapshot_restore.ts` (`restoreSnapshot`) via
  dynamic `import()` so the git/diff modules stay out of the hot-path API bundle.
  The snapshot diff also generates a best-effort AI summary header via
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (never blocks the structural diff).
- No request body is Zod-validated at the boundary — the create/revert bodies use
  the original in-body `as {…}` cast + manual checks, so there is no `schemas.ts`.
  The private `guessContentTypeForRevert` helper moved alongside its only caller
  (the revert handler). The download route returns a JSON manifest (per-file R2
  URLs) rather than a server-side zip — Workers has no native zip primitive, so
  the client assembles the archive with browser-side `jszip`.
- Every mutation writes an append-only audit row via `auditService.writeAuditLog`
  (best-effort; audit-store outages never block the primary write).
