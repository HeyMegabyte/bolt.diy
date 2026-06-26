/**
 * Product analytics facade for the Project Sites Worker.
 *
 * Wraps the existing PostHog `capture()` primitive with a typed, intent-named
 * interface so call-sites express WHAT happened, not how PostHog works.
 * No external deps added — delegates entirely to `../lib/posthog.ts`.
 *
 * @module observability/analytics
 */

import type { Env } from '../types/env.js';
import { capture } from '../lib/posthog.js';

/**
 * Product analytics interface for a single request / execution context.
 *
 * @example
 * ```ts
 * const analytics = createAnalytics(env, ctx);
 * await analytics.capture('site.published', { site_id: 's_123', distinct_id: 'user_456' });
 * analytics.identify('user_456', { plan: 'pro', org_id: 'o_789' });
 * analytics.group('organization', 'o_789', { name: 'Acme Corp' });
 * ```
 */
export interface ProductAnalytics {
  /**
   * Record a discrete product event.
   *
   * @param event       - Snake_case event name (e.g. `'site.published'`).
   * @param properties  - Arbitrary event properties. Include `distinct_id` to
   *                      identify the actor; if omitted, `'anonymous'` is used.
   * @returns Promise that resolves when the capture call completes.
   */
  capture(event: string, properties: Record<string, unknown>): Promise<void>;

  /**
   * Associate profile properties with a user.
   * Emits a PostHog `$identify` event.
   *
   * @param userId     - Stable user identifier (maps to PostHog `distinct_id`).
   * @param properties - Optional profile properties to set / merge.
   */
  identify(userId: string, properties?: Record<string, unknown>): void;

  /**
   * Associate properties with a group (org, team, company, etc.).
   * Emits a PostHog `$groupidentify` event.
   *
   * @param groupType  - Group type string (e.g. `'organization'`).
   * @param groupKey   - Stable group identifier (e.g. the org ID).
   * @param properties - Optional group properties to set / merge.
   */
  group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void;
}

/**
 * Create a scoped product analytics instance for a single request or job.
 *
 * @param env  - Worker env bindings (forwarded to PostHog helper).
 * @param ctx  - Worker execution context (for `waitUntil`).
 * @returns A fully-wired `ProductAnalytics`.
 *
 * @example
 * ```ts
 * const analytics = createAnalytics(env, ctx);
 * await analytics.capture('checkout.started', {
 *   distinct_id: session.userId,
 *   plan: 'pro',
 *   trial: true,
 * });
 * ```
 */
export function createAnalytics(env: Env, ctx: ExecutionContext): ProductAnalytics {
  return {
    async capture(event: string, properties: Record<string, unknown>): Promise<void> {
      const distinctId =
        typeof properties['distinct_id'] === 'string'
          ? properties['distinct_id']
          : 'anonymous';
      capture(env, ctx, { event, distinctId, properties });
    },

    identify(userId: string, properties?: Record<string, unknown>): void {
      capture(env, ctx, {
        event: '$identify',
        distinctId: userId,
        properties: {
          $set: properties ?? {},
        },
      });
    },

    group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
      capture(env, ctx, {
        event: '$groupidentify',
        distinctId: `${groupType}_${groupKey}`,
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: properties ?? {},
        },
      });
    },
  };
}
