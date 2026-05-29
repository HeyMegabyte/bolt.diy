/**
 * @module libs/features/agent_sdk_mcp
 *
 * Feature manifest for the Public Agent SDK + MCP Server (idea #37).
 *
 * Two packages ship under this feature:
 *
 *   - `@projectsites/sdk`        — TypeScript SDK over the Public API v1.
 *                                  Extended in this wave with Trust Center,
 *                                  Enterprise, and Stripe App resources.
 *
 *   - `@projectsites/mcp-server` — Model Context Protocol server wrapping
 *                                  every SDK resource so Claude Desktop,
 *                                  ChatGPT desktop, Cursor, and Claude Agent
 *                                  SDK apps can drive the platform.
 *
 * This module owns the flag (`agent_sdk_mcp`) that gates server-side
 * acceptance of MCP traffic. The SDK itself is a public package — the flag
 * does not gate npm distribution, only the worker's willingness to honor
 * agent-driven traffic when a customer disables it.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'agent_sdk_mcp',
  name: 'Public Agent SDK + MCP Server',
  description:
    'Idea #37 — Public TypeScript SDK + MCP server so external agents (Claude Desktop / ChatGPT / Cursor / Agent SDK) can drive the platform. Distribution = compounding.',
  lifecycle: 'in-development',
  flagKey: 'agent_sdk_mcp',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    // Every /v1/* + /api/trust + /api/enterprise + /api/stripe-app surface
    // is exposed through SDK + MCP wrappers; this manifest does not own
    // those endpoints — it documents that they are part of the public
    // surface other agents can drive.
  ],

  // ---- governance ----
  permissions: ['sites:read', 'sites:write'],
  dependencies: ['public_api_v1', 'trust_center', 'enterprise_plan', 'stripe_app_status'],

  // ---- tests ----
  e2eTests: [],
  unitTests: [],
  integrationTests: [],
  testStatus: 'not-applicable',

  // ---- schemas ----
  zodSchemas: [],

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
      'Experimental. Promote to beta once SDK + MCP packages publish to npm AND Claude Desktop + Cursor integrations are smoke-tested.',
  },

  risks: [
    'Agent traffic can drive cost — pair with per-org budget caps (idea #16) before promotion.',
    'MCP transport gives agents the ability to deploy + mutate. Token scopes must enforce least-privilege.',
    'SDK + MCP track the same OpenAPI 3.1 spec — drift here = silent breakage for SDK consumers.',
  ],

  removalNotes:
    'Remove: packages/mcp-server/, the new resources in packages/sdk/src/client.ts, registry entry agent_sdk_mcp.',
});
