# feedback

User **feedback** — 1-5 star ratings + free-text comments collected from the
build-progress / post-publish UI, plus a public read path for approved
testimonials (homepage social proof). **Core, un-gated** route-organization
module extracted from `api.ts` (route-decomposition installment 13), not a
dark-launched feature.

## Routes (`handlers.ts` → `feedback`, mounted at `app.route('/', feedback)`)

| Method | Path            | Auth   |
| ------ | --------------- | ------ |
| POST   | `/api/feedback` | public |
| GET    | `/api/feedback` | public |

## Boundaries

- Both routes are public. `POST /api/feedback` stamps `user_id` / `org_id` when
  the caller happens to have a session (else null — anonymous), persists with
  `status='pending'` for later moderation, and returns `201 { data: { submitted:
  true } }`. `GET /api/feedback` returns ONLY `status='approved'` +
  `deleted_at IS NULL` rows (newest-first, ≤50) — no `user_id`/`org_id` exposed.
- Writes through `dbInsert` (never throws — a `{ error }` result surfaces as an
  honest 500 instead of a lying 201); reads through `dbQuery`
  (`../../../src/services/db.js`). Each handler wraps its body in a local
  `try/catch` that re-throws known AppErrors and classifies the rest via
  `classifyError` (`../../../src/services/retry.js`) for Sentry grouping.
- Bodies are read with a raw `await c.req.json()` + defensive field reads (rating
  clamp 1-5, comment ≤2000 / page_url ≤500 char slices), so there is no
  `schemas.ts` — the moved handlers keep their original in-body validation and
  structured error envelopes.
