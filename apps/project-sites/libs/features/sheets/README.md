# sheets

Public **Google Sheets** read proxy for site widgets (menus, price lists,
schedules an owner maintains in a Sheet). **Core, un-gated** routes (no feature
flag) — a route-organization module extracted from the `api.ts` monolith
(route-decomposition installment 4), not a dark-launched feature.

## Routes (`handlers.ts` → `sheets`, mounted at `app.route('/', sheets)`)

| Method | Path                        | Auth   |
| ------ | --------------------------- | ------ |
| GET    | `/api/sheets/:sheetId`      | public |
| GET    | `/api/sheets/:sheetId/meta` | public |

## Boundaries

- Unauthenticated by design — the sheet must already be public ("anyone with the
  link"); no tenant secret is exposed. `GET /api/sheets/:sheetId` returns the first
  tab (or `?tab=`) as rows-as-records; `/meta` returns tab names + grid dimensions.
- Delegates to `services/google_sheets.ts` (`fetchSheetData` / `fetchSheetMeta`).
  The API key resolves `GOOGLE_SHEETS_API_KEY` first, falling back to
  `GOOGLE_PLACES_API_KEY` (same GCP project, Sheets API enabled — the fallback is
  for cost-tracking granularity, not security separation).
- No request body is parsed; inputs are a path param + a `tab` query, so there is
  no `schemas.ts`. Upstream errors (private sheet 403, bad id 400, quota 429)
  bubble to the app-level error handler unchanged.
