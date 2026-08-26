/**
 * @module libs/features/workflow_status/handlers
 *
 * @description
 * Hono route that proxies a Cloudflare **Workflow instance's `.status()`** to
 * the client (#60) for the two resumable per-site pipelines — `drive-sync` and
 * `image-generation`. Verifies the site is owned by the caller's org through
 * {@link siteOwned} (404, never 403) before exposing any workflow state.
 * Requires an `orgId` on the request context — the {@link need} helper throws
 * `HTTPError(401)` when it is missing.
 *
 * | Method | Path                                        | Auth         | Purpose                                          |
 * | ------ | ------------------------------------------- | ------------ | ------------------------------------------------ |
 * | GET    | /api/sites/:siteId/workflows/:wfName/:id     | orgId+userId | Proxy a drive-sync/image-generation run's status |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 20) — only the route-registration receiver changed (`aiAdmin.` →
 * `workflowStatus.`); the handler body is byte-for-byte unchanged. Error/auth
 * scaffolding (the `HTTPError` class + `need(c)` / `siteOwned(...)` helpers +
 * a byte-identical `onError`) is imported from the SHARED
 * `src/lib/ai_admin_kit.ts` kit — no local copies. The single read-only `GET`
 * takes no request body, so there is no `schemas.ts`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { HTTPError, need, siteOwned, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const workflowStatus = new Hono<AppContext>();

// Error/auth scaffolding (HTTPError · need · siteOwned · onError) is shared via
// src/lib/ai_admin_kit.ts — imported above (route-decomposition installment 20,
// extracted from ai_admin.ts). Byte-identical behavior to the prior inline copies.
workflowStatus.onError(aiAdminOnError);

/**
 * GET /api/sites/:siteId/workflows/:wfName/:id
 * Proxy a workflow instance's `.status()` to the client (item #60). Supports
 * `drive-sync` and `image-generation` Workflow names. Verifies the site is
 * owned by the caller's org before exposing the status.
 */
workflowStatus.get('/api/sites/:siteId/workflows/:wfName/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const wfName = c.req.param('wfName');
  const instanceId = c.req.param('id');
  await siteOwned(c, orgId, siteId);

  let binding: Workflow | undefined;
  if (wfName === 'drive-sync') binding = c.env.DRIVE_SYNC_WORKFLOW;
  else if (wfName === 'image-generation') binding = c.env.IMAGE_GENERATION_WORKFLOW;
  else throw new HTTPError(404, 'unknown workflow name');

  if (!binding) {
    return c.json({ data: { status: 'unbound', workflow: wfName } });
  }

  try {
    const instance = await binding.get(instanceId);
    const status = await instance.status();
    return c.json({ data: { workflow: wfName, workflow_id: instanceId, ...status } });
  } catch (err) {
    throw new HTTPError(404, err instanceof Error ? err.message : 'workflow_lookup_failed');
  }
});
