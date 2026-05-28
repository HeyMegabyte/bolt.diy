/**
 * @module libs/features/public_api_v1
 *
 * Feature manifest for Public API v1 (big-bets feature #30).
 * 12 REST endpoints under /v1/* with psk_ Bearer token auth, OpenAPI 3.1,
 * @projectsites/sdk TypeScript client, and psctl CLI.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'public_api_v1',
  name: 'Public API v1',
  description:
    'Big-bets #30 — REST API v1 under /v1/* with psk_<64-hex> Bearer token auth, 12 endpoints ' +
    '(sites CRUD, snapshots, deploy, media, forms, analytics, /v1/me, /v1/openapi.json), ' +
    'OpenAPI 3.1, @projectsites/sdk ESM TypeScript client, psctl CLI.',
  lifecycle: 'alpha',
  flagKey: 'public_api_v1',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/api-tokens'],
  apiRoutes: [
    'GET    /v1/openapi.json',
    'GET    /v1/me',
    'GET    /v1/sites',
    'GET    /v1/sites/:id',
    'POST   /v1/sites',
    'DELETE /v1/sites/:id',
    'GET    /v1/sites/:id/snapshots',
    'POST   /v1/sites/:id/deploy',
    'GET    /v1/sites/:id/media',
    'POST   /v1/sites/:id/media',
    'GET    /v1/sites/:id/forms/submissions',
    'GET    /v1/sites/:id/analytics',
    // Token management (session auth, not token auth)
    'POST   /api/v1-tokens',
    'GET    /api/v1-tokens',
    'DELETE /api/v1-tokens/:id',
  ],

  // ---- governance ----
  permissions: ['sites:read', 'sites:write', 'media:read', 'media:write', 'forms:read', 'analytics:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'public-api/public-api.spec.ts',
    '_fortress/public-api/happy-path.spec.ts',
    '_fortress/public-api/adversarial.spec.ts',
  ],
  unitTests: [
    // DRIFT: no dedicated api_tokens unit test
    // Needs: src/__tests__/api_tokens.test.ts covering createToken, validateToken,
    //        revokeToken, scope enforcement
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // CreateSiteBodySchema + scoped-token validation inline in routes/public_api.ts
    // DRIFT: should be extracted to libs/features/public_api_v1/schemas.ts
  ],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. When flag is off, all /v1/* requests return 503 { error: "feature_disabled" }. ' +
      'INCIDENT: commit 6d31156 fixed v1.use("*") → v1.use("/v1/*") to prevent 503 on marketing homepage. ' +
      'Beta after: unit tests + per-token rate limiting + last_used_at Queues-backed update.',
  },

  risks: [
    'v1.use() middleware scope — must always target /v1/* not * (incident 6d31156 reference).',
    'last_used_at update is fire-and-forget ctx.waitUntil() — may not persist under low traffic.',
    'No per-token rate limiting yet — uses global AI rate limit bucket instead of token-bucket per psk_.',
    'psctl CLI + @projectsites/sdk in packages/ not yet published to npm registry.',
  ],

  removalNotes:
    'Remove: routes/public_api.ts, services/api_tokens.ts, ' +
    'frontend api-tokens.component.ts + /admin/api-tokens lazy route in app.routes.ts. ' +
    'Drop D1 tables: api_tokens, api_token_usage (migration 0515_public_api.sql). ' +
    'Remove packages/sdk/ and packages/psctl/ from monorepo. Drop FLAG_REGISTRY entry.',
});
