/**
 * Dittofeed outbox listener — reads from outbox_events and fans to Dittofeed.
 *
 * @remarks
 * Registered as a destination in outbox_processor.ts alongside Novu and other
 * consumers. Translates ProjectSitesEvent → Dittofeed identify/track via the
 * shared dispatch layer. Runs in ctx.waitUntil() — never blocks, never throws.
 *
 * All events are scoped to `orgId` as the Dittofeed userId, so journeys and
 * segments operate at the organization level (a single business owner's journey).
 */

import type { Env } from '../types/env.js';
import { dispatchToDittofeed } from './dittofeed_dispatch.js';

/**
 * Process a batch of outbox events and fan them to Dittofeed.
 * Safe to call inside ctx.waitUntil(). Returns count of successfully dispatched events.
 */
export async function drainDittofeedOutbox(
  env: Env,
  events: Array<{
    type: string;
    tenantId: string;
    siteId?: string;
    userId?: string;
    data: Record<string, unknown>;
  }>,
): Promise<number> {
  let dispatched = 0;
  for (const event of events) {
    try {
      await dispatchToDittofeed(env, event);
      dispatched++;
    } catch {
      // fail open — individual event failures don't block the drain
    }
  }
  return dispatched;
}
