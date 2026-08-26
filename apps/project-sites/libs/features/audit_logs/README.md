# audit_logs

Audit-log **read** + bolt.diy editor-**error ingest**. **Core, un-gated**
route-organization module extracted from `api.ts` (route-decomposition
installment 13), not a dark-launched feature.

## Routes (`handlers.ts` → `auditLogs`, mounted at `app.route('/', auditLogs)`)

| Method | Path                           | Auth  |
| ------ | ------------------------------ | ----- |
| GET    | `/api/audit-logs`              | orgId |
| POST   | `/api/audit-logs/editor-error` | orgId |

## Boundaries

- Both routes are org-scoped via `c.get('orgId')` — cross-tenant rows are never
  returned or written. `GET /api/audit-logs` lists the caller's org audit rows
  (dashboard activity feed + `/admin/audit` grid) with optional `site_id` /
  `site_slug` scoping (a non-resolving slug returns an empty set, never "all
  rows" — tenant-isolation), a LEFT JOIN to resolve each row's `site` slug, and a
  true unpaginated `COUNT(*)` in the `meta` envelope so the grid can page past the
  500-row cap. `POST /api/audit-logs/editor-error` records a bolt.diy iframe
  runtime error (`postMessage` `PS_ERROR`) with `action='editor.runtime_error'`,
  preserving the full stack in `metadata_json`.
- GET reads via `dbQueryOne` + raw parameterized `c.env.DB.prepare(...)`; POST
  fires `auditService.writeAuditLog` (`* as auditService` from
  `../../../src/services/audit.js`). Known AppErrors (`unauthorized`) bubble to
  the app-level error handler; the POST returns its own 401/403 envelopes for
  missing userId/orgId.
- No Zod boundary schema — the GET reads only query params (clamped) and the POST
  reads its body with `c.req.json().catch(() => ({}))` + defensive slices, so
  there is no `schemas.ts`.
