/**
 * @module libs/features/cost_forecast/handlers
 *
 * @description
 * Hono route for the **AI Cost Forecaster** (#95) — a 30-day usage rollup
 * projected to a next-month USD forecast per Cloudflare pricing, plus one
 * LLM-generated savings tip. Delegates the whole computation to
 * {@link forecastCost} in `services/ai_admin_features.ts`; the handler stays
 * thin. Requires an `orgId` on the request context — the {@link need} helper
 * throws `HTTPError(401)` when it is missing.
 *
 * | Method | Path                       | Auth  | Purpose                                       |
 * | ------ | -------------------------- | ----- | --------------------------------------------- |
 * | GET    | /api/admin/forecast/cost   | orgId | Next-month cost forecast + one AI savings tip |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 20) — only the route-registration receiver changed (`aiAdmin.` →
 * `costForecast.`); the handler body is byte-for-byte unchanged. Error/auth
 * scaffolding (the `need(c)` helper + a byte-identical `onError`) is imported
 * from the SHARED `src/lib/ai_admin_kit.ts` kit — no local copies. The single
 * read-only `GET` takes no request body, so there is no `schemas.ts`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { need, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';
import { forecastCost } from '../../../src/services/ai_admin_features.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const costForecast = new Hono<AppContext>();

// Error/auth scaffolding (need · onError) is shared via src/lib/ai_admin_kit.ts —
// imported above (route-decomposition installment 20, extracted from ai_admin.ts).
// Byte-identical behavior to the prior inline copies.
costForecast.onError(aiAdminOnError);

/**
 * `GET /api/admin/forecast/cost`
 *
 * 30-day usage rollup → next-month USD forecast per Cloudflare pricing, plus
 * one LLM-generated savings tip.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
costForecast.get('/api/admin/forecast/cost', async (c) => {
  const { orgId } = need(c);
  const forecast = await forecastCost(c.env, orgId);
  return c.json({ data: forecast });
});
