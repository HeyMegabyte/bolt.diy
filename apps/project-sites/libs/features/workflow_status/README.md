# workflow_status

Proxies a Cloudflare **Workflow instance's `.status()`** to the client (#60) for
the two resumable per-site pipelines — `drive-sync` and `image-generation`.
Verifies site ownership (404, never 403) before exposing any workflow state.
**Core, un-gated** route (no feature flag) — a route-organization module
extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
installment 20), not a dark-launched feature.

## Routes (`handlers.ts` → `workflowStatus`, mounted at `app.route('/', workflowStatus)`)

| Method | Path                                     | Auth         |
| ------ | ---------------------------------------- | ------------ |
| GET    | `/api/sites/:siteId/workflows/:wfName/:id`| orgId+userId |

## Boundaries

- Org-scoped via `need(c)` (`HTTPError(401)` when `orgId`/`userId` is absent) and
  guarded by `siteOwned(c, orgId, siteId)` — a missing/foreign site returns 404,
  never 403, so cross-org sites never leak.
- Only `drive-sync` (`DRIVE_SYNC_WORKFLOW`) and `image-generation`
  (`IMAGE_GENERATION_WORKFLOW`) are dispatchable; any other `:wfName` →
  `HTTPError(404)`. An unbound binding returns `{ status: 'unbound' }`; a failed
  `.get()/.status()` lookup → `HTTPError(404)` with the error message.
- Error/auth scaffolding (`HTTPError` + `need` + `siteOwned` + `onError`) is
  imported from the shared `src/lib/ai_admin_kit.ts` — no local copies.
