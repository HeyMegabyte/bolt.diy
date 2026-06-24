/**
 * @module routes/collab
 * @description Real-time collaborative editing WebSocket gateway.
 *
 * Proxies authenticated WebSocket upgrade requests to `CollabRoomDO` (a
 * PartyServer + Yjs Durable Object) so multiple clients can co-edit a site's
 * content in real time via Yjs CRDT.
 *
 * ## Route
 * `GET /api/sites/:id/collab` — WS upgrade only (426 on plain HTTP).
 *
 * ## Guard chain
 * 1. `orgId` from auth middleware → 401 if absent.
 * 2. `requireOwnedSite` → 404 if the site doesn't belong to this org.
 * 3. `isFlagOn(env, 'collab_editing', {siteId, orgId})` → 404 if flag is off.
 * 4. `env.COLLAB_ROOM` binding present → 503 if absent (inert deploy).
 * 5. `Upgrade: websocket` header → 426 if plain HTTP.
 * 6. Forward raw request to the DO stub — DO handles WS lifecycle.
 *
 * ## Degradation
 * When the `COLLAB_ROOM` binding is absent (wrangler.toml block commented),
 * this route returns `503 Service Unavailable` so the feature fails silently
 * without blocking any unrelated routes. The feature flag default is OFF so
 * authenticated callers reach step 3 and get 404 before 503.
 *
 * @see {@link ../durable_objects/collab_room.ts} — `CollabRoomDO`.
 * @see {@link ../modules/feature_flags/registry.ts} — `collab_editing` entry.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { requireOwnedSite } from '../services/site_ownership.js';

export const collabRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Upgrade a plain HTTP connection to a Yjs-synced WebSocket for collaborative
 * editing of a specific site's content.
 *
 * @route GET /api/sites/:id/collab
 * @auth Bearer token required — `orgId` must resolve.
 * @header Upgrade: websocket — required; returns 426 otherwise.
 * @returns `101 Switching Protocols` when all guards pass.
 * @throws 401 when the caller is not authenticated.
 * @throws 404 when the site is not owned by the org or the `collab_editing` flag is off.
 * @throws 426 when the request is not a WebSocket upgrade.
 * @throws 503 when the `COLLAB_ROOM` Durable Object binding is absent.
 */
collabRoutes.get('/api/sites/:id/collab', async (c) => {
  // ── 1. Authentication ──────────────────────────────────────────────────
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  const siteId = c.req.param('id');

  // ── 2. Ownership ───────────────────────────────────────────────────────
  // requireOwnedSite throws an AppError NOT_FOUND when unowned — errorHandler
  // converts that to a 404 JSON response (never 403, no info leak).
  await requireOwnedSite<{ id: string }>(c.env, orgId, siteId, 'id');

  // ── 3. Feature flag — 404 (never 403) when off ─────────────────────────
  if (!(await isFlagOn(c.env, 'collab_editing', { siteId, orgId }))) {
    return c.notFound();
  }

  // ── 4. Binding guard — 503 when COLLAB_ROOM is absent (inert deploy) ───
  if (!c.env.COLLAB_ROOM) {
    return c.json(
      {
        error: 'COLLAB_ROOM binding missing',
        code: 'SERVICE_UNAVAILABLE',
        hint: 'Uncomment the [[durable_objects.bindings]] + [[migrations]] COLLAB_ROOM block in wrangler.toml and redeploy.',
      },
      503,
    );
  }

  // ── 5. WebSocket upgrade check ─────────────────────────────────────────
  const upgradeHeader = c.req.header('upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return c.json(
      {
        error: 'WebSocket upgrade required',
        code: 'UPGRADE_REQUIRED',
        hint: 'Connect with a WebSocket client (Upgrade: websocket).',
      },
      426,
    );
  }

  // ── 6. Forward to CollabRoomDO ─────────────────────────────────────────
  // One DO instance per site — keyed by `site:<siteId>` so all clients for
  // the same site converge to the same Yjs document.
  const doId = c.env.COLLAB_ROOM.idFromName(`site:${siteId}`);
  const stub = c.env.COLLAB_ROOM.get(doId);
  return stub.fetch(c.req.raw);
});
