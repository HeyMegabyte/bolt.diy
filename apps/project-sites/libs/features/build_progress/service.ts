/**
 * @module libs/features/build_progress/service
 * @description Thin service wrapper over the build-event store for the
 * build_progress feature module (idea #10).
 *
 * Delegates to `src/services/build_events.ts` — the canonical emitter +
 * replay implementation shared with the site-generation workflow. Kept thin
 * so the feature module owns its API surface without duplicating logic per
 * [[feature-module-architecture]].
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import {
  appendBuildEvent,
  replayBuildEvents,
  isTerminalBuildEvent,
  type BuildEvent,
} from '../../../src/services/build_events.js';

export { appendBuildEvent, replayBuildEvents, isTerminalBuildEvent };
export type { BuildEvent };

/** Flag key gating this feature — reuses the existing streaming flag. */
export const FLAG_KEY = 'streaming_generation';

/**
 * Resolve the durable event backlog for a build.
 *
 * @param env     - Worker env (uses `env.CACHE_KV`).
 * @param buildId - Build correlation id (container jobId).
 * @returns Ordered events oldest → newest.
 */
export async function getBuildEvents(env: Env, buildId: string): Promise<BuildEvent[]> {
  return replayBuildEvents(env, buildId);
}

/**
 * Whether a build's stream has reached a terminal event.
 *
 * @param events - Ordered build events.
 * @returns `true` once `publish.completed` or `build.failed` has been emitted.
 */
export function isBuildComplete(events: readonly BuildEvent[]): boolean {
  return events.some((e) => isTerminalBuildEvent(e.type));
}
