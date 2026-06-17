/**
 * @module libs/features/platform_mcp
 *
 * Feature manifest for the platform-level MCP server — lets external agent tools
 * (Claude Code, Cursor, Cline) connect to projectsites.dev via a scoped API
 * token and manage the caller's sites over JSON-RPC 2.0. A distribution play:
 * meets developers where they already are.
 */
import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'platform_mcp',
  name: 'Platform MCP server',
  description:
    'Account-level MCP server so Claude Code + other MCP clients connect to projectsites.dev with a scoped API token and manage their sites (list, inspect, build-status; deploy next).',
  lifecycle: 'alpha',
  flagKey: 'platform_mcp',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',

  routes: [],
  apiRoutes: ['GET /api/mcp', 'POST /api/mcp'],

  permissions: ['sites:read', 'sites:write'],
  dependencies: [],

  e2eTests: [],
  unitTests: ['../libs/features/platform_mcp/__tests__/platform_mcp.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  zodSchemas: ['schemas.ts'],

  observability: { sentry: true, logs: true, analytics: false },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Alpha. Read tools (whoami/list_sites/get_site/get_build_status) live + tested. deploy_site/create_site are the next slice (see README + ROADMAP). Promote after deploy_site ships + a prod connect-from-Claude-Code smoke.',
  },

  risks: [
    'An over-scoped API token widens blast radius — tools scope-gate via hasScope; mint read-only tokens for inspection-only clients.',
    'tools/list + initialize are unauthenticated (static catalog only, no data) by MCP convention; all data tools require a valid token.',
  ],

  removalNotes:
    'Remove this module, the platformMcp app.route() mount in src/index.ts, and the platform_mcp flag. No schema/migration owned (reuses api_tokens + sites + mcp_calls).',
});
