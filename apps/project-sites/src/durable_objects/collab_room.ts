/**
 * @module durable_objects/collab_room
 * @description Real-time collaborative editing Durable Object backed by
 * PartyServer + Yjs CRDT. One DO instance per site: `site:<siteId>`.
 *
 * Each connected client opens a WebSocket (WS upgrade) against
 * `GET /api/sites/:id/collab`. The PartyServer runtime routes that raw
 * request into the DO's `fetch()` which PartyServer + y-partyserver handle
 * transparently — syncing Yjs document updates across all connected clients
 * via the `y-partyserver` YServer mixin.
 *
 * ## Lifecycle
 * - `onLoad` — called once the DO wakes. No persistent load needed (the Yjs
 *   CRDT is reconstructed from incoming updates). Returns void.
 * - `onSave` — called when y-partyserver wants to persist. No-op for now;
 *   a future wave can persist the Yjs state vector to DO storage.
 *
 * ## Feature flag
 * `collab_editing` — off by default (stage=experimental). Routes return 404
 * when off; the DO itself is never reached.
 *
 * ## Activation (INERT until wrangler.toml block is uncommented)
 * The DO binding `COLLAB_ROOM` is shipped COMMENTED in `wrangler.toml` to
 * avoid the Cloudflare 10074/10064/10061 migration errors. See the comment
 * block in wrangler.toml for the eyes-on go-live recipe.
 *
 * @see {@link ../routes/collab.ts} — the route that proxies to this DO.
 * @see {@link ../modules/feature_flags/registry.ts} — `collab_editing` flag.
 */
import { YServer } from 'y-partyserver';
import type { Env } from '../types/env.js';

/**
 * Collaborative editing Durable Object.
 *
 * Extends `YServer` (y-partyserver) which itself extends `Server` (partyserver)
 * which extends `DurableObject<Env>`. The entire Yjs CRDT sync loop — awareness
 * protocol, document update broadcast, WebSocket lifecycle — is handled by the
 * `YServer` base class. `CollabRoomDO` only overrides the persistence hooks.
 *
 * @example
 * // Worker entry (index.ts) exports this class so CF knows about the binding:
 * export { CollabRoomDO } from './durable_objects/collab_room.js';
 *
 * @remarks
 * `onLoad` and `onSave` are intentionally no-ops in this initial cut.
 * A future iteration can persist the Y.Doc state vector to DO SQLite storage
 * via `ctx.storage.sql` so documents survive all clients disconnecting.
 */
export class CollabRoomDO extends YServer<Env> {
  /**
   * Called by y-partyserver after the DO wakes to optionally load a
   * persisted document snapshot. Returns void (no persistence yet).
   *
   * @returns A resolved Promise (no-op for initial wave).
   */
  override async onLoad(): Promise<void> {
    // No-op: Yjs state is reconstructed from client updates.
    // Future: load from `this.ctx.storage.sql` and call
    //   `this.unstable_replaceDocument(snapshot)`.
  }

  /**
   * Called by y-partyserver when it wants to persist the current document
   * state. No-op for initial wave — documents live only while ≥1 client
   * is connected.
   *
   * @returns A resolved Promise (no-op for initial wave).
   */
  override async onSave(): Promise<void> {
    // No-op: persistence is deferred to a future wave.
    // Future: persist `Y.encodeStateAsUpdate(this.document)` to DO storage.
  }
}
