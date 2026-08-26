# inbox

The admin **task tray** (human-in-the-loop elicitation inbox): list the caller's
open AI-workflow questions, resolve one with a chosen option. **Core, un-gated**
routes (no feature flag) — a route-organization module extracted from the `api.ts`
monolith (route-decomposition installment 3), not a dark-launched feature.

## Routes (`handlers.ts` → `inbox`, mounted at `app.route('/', inbox)`)

| Method | Path                           | Auth  |
| ------ | ------------------------------ | ----- |
| GET    | `/api/inbox/tasks`             | orgId |
| POST   | `/api/inbox/tasks/:id/resolve` | orgId |

## Boundaries

- Both routes are org-scoped via `c.get('orgId')` — a missing identity throws
  `unauthorized()` (401 envelope). Before resolving, the handler re-verifies the
  task belongs to the caller's org against `ai_task_inbox`, so a caller can never
  resolve another org's task even by guessing an id.
- The `task_inbox.ts` service is loaded lazily via dynamic `import()` — it stays
  off the hot path for the common "no open tasks" poll.
- The only body field (`choice`) is validated inline (non-empty trimmed string,
  `badRequest` otherwise); no `as {…}` cast survives past that guard, so there is
  no `schemas.ts`.

## Companion

`services/task_inbox.ts` owns `listOpenTasks` / `resolveTask` (+ the expired-default
sweep run from the scheduled handler in `index.ts`). Resolution fans the answer back
into the originating workflow via `SITE_GENERATION.sendEvent` when wired, else
silently no-ops. E2E: `e2e/inbox/inbox.spec.ts` + `e2e/task-tray.spec.ts`.
