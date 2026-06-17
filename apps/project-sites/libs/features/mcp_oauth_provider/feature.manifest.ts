import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'mcp_oauth_provider',
  name: 'MCP OAuth 2.1 authorization server',
  description: 'OAuth 2.1 AS so MCP clients (Claude Code) get tokens via PKCE instead of pasting psk_ tokens.',
  flagKey: 'mcp_oauth_provider',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  lifecycle: 'alpha',
  routes: [
    'GET /.well-known/oauth-authorization-server',
    'GET /oauth/authorize',
  ],
  apiRoutes: [
    'POST /oauth/register',
    'POST /api/oauth/authorize',
    'POST /oauth/token',
  ],
  permissions: ['sites:read', 'sites:write'],
  dependencies: ['platform_mcp'],
  e2eTests: [],
  unitTests: ['../libs/features/mcp_oauth_provider/__tests__/oauth_provider.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Alpha. OAuth 2.1 AS (RFC 8414 metadata + 7591 DCR + PKCE-S256 authorization_code) issuing scoped psk_ tokens. Codes/clients in KV (no migration). Promote after the Angular /oauth/consent page ships + a prod connect smoke.',
  },
  risks: [
    'When disabled, all /oauth/* + /.well-known/oauth-authorization-server routes 404 — MCP clients fall back to pasting a psk_ token.',
    'The authorization-code → token exchange mints a real psk_ token; a flaw in PKCE/redirect validation would widen blast radius. Mitigated by single-use codes + 10-min TTL + exact redirect_uri match + adversarial test coverage.',
  ],
  removalNotes:
    'Remove this module, the oauthProvider app.route() mount in src/index.ts, and the mcp_oauth_provider flag. KV keys (oauth_client:* / oauth_code:*) expire on their own. No schema/migration owned.',
});
