# cost_forecast

The admin **AI Cost Forecaster** (#95) — a 30-day usage rollup projected to a
next-month USD forecast per Cloudflare pricing, plus one LLM-generated savings
tip. The whole computation lives in `services/ai_admin_features.ts`
(`forecastCost`); the handler stays thin. **Core, un-gated** route (no feature
flag) — a route-organization module extracted VERBATIM from the `ai_admin.ts`
monolith (route-decomposition installment 20), not a dark-launched feature.

## Routes (`handlers.ts` → `costForecast`, mounted at `app.route('/', costForecast)`)

| Method | Path                       | Auth  |
| ------ | -------------------------- | ----- |
| GET    | `/api/admin/forecast/cost` | orgId |

## Boundaries

- Org-scoped via `need(c)` (`HTTPError(401)` when `orgId`/`userId` is absent);
  the forecast is keyed on the caller's own `orgId`.
- Business logic is delegated to `forecastCost(env, orgId)` in
  `src/services/ai_admin_features.ts` — the handler only extracts `orgId` and
  wraps the result in the `{ data }` envelope.
- Error/auth scaffolding (`need` + `onError`) is imported from the shared
  `src/lib/ai_admin_kit.ts` — no local copies.
