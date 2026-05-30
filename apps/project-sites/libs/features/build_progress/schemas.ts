/**
 * @module libs/features/build_progress/schemas
 * @description Zod schemas for Event-Sourced Build Progress (idea #10).
 *
 * The canonical contract lives in `src/services/build_events.ts` so the
 * workflow emitter and this feature module share one source of truth per
 * [[zod-everywhere]]. This file re-exports it as the module's schema surface.
 *
 * @packageDocumentation
 */

export {
  BuildEventSchema,
  isTerminalBuildEvent,
  type BuildEvent,
  type BuildEventType,
} from '../../../src/services/build_events.js';
