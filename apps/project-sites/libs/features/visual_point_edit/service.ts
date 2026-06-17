/**
 * @module libs/features/visual_point_edit/service
 * @description Business logic for visual point editing. Given a nodeId and a
 * plain-language instruction, applies a simulated patch and returns the
 * updated node string. Production implementations would resolve the DOM node
 * from the site manifest and call Workers AI to generate the patch.
 *
 * @remarks This module is gated by the `visual_point_edit` feature flag.
 * When the flag is off the route returns 404; this service is never called.
 */

import type { Env } from '../../../src/types/env.js';

/** Registry flag key gating this feature. */
export const FLAG_KEY = 'visual_point_edit';

/**
 * Apply a plain-language instruction to a DOM node (simulated).
 *
 * @param _env - Worker environment bindings (reserved for future AI calls).
 * @param nodeId - The CSS selector or data-ps-node identifier to patch.
 * @param _instruction - Human-readable description of the desired edit.
 * @returns A promise resolving to the patch result.
 *
 * @example
 * const result = await patchNode(env, '#hero-headline', 'Make the text bold');
 * console.log(result.patched); // true
 */
export async function patchNode(
  _env: Env,
  nodeId: string,
  _instruction: string,
): Promise<{ patched: true; node: string }> {
  return { patched: true, node: nodeId };
}
