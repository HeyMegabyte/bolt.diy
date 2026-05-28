/**
 * @module durable_objects/conversation_hub
 * @description Deprecated Pulse Inbox DO — Inbox feature was removed from
 * the UI + code 2026-05-25 but this class stub stays so Cloudflare's DO
 * migration history (v_conversation_hub tag) stays valid. Any inbound
 * fetch returns HTTP 410 Gone. The binding in wrangler.toml stays so the
 * worker deploys cleanly; a future hard cleanup can ship a
 * `deleted_classes = ["ConversationHub"]` migration tag once we accept
 * dropping any remaining DO storage.
 *
 * @remarks
 * Do NOT add behavior here. Re-implementing Pulse Inbox should happen in a
 * fresh class (e.g. `ConversationHubV2`) via `new_sqlite_classes`, leaving
 * this stub for backward compat until the delete migration ships.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env.js';

/**
 * Stub `ConversationHub` DO. Returns 410 Gone for every request.
 * Preserves Cloudflare DO class binding without exposing behavior.
 */
export class ConversationHub extends DurableObject<Env> {
  /**
   * Always responds 410 Gone. Inbox feature has been removed.
   */
  override async fetch(_request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({
        error: 'gone',
        message: 'Pulse Inbox feature deprecated 2026-05-25',
        docs: 'https://projectsites.dev/changelog',
      }),
      {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
