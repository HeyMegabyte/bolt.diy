/**
 * Flag definition stub for {{slug}}.
 *
 * @remarks
 * This object is inserted verbatim into `src/modules/feature_flags/registry.ts`
 * by the scaffolder. All new features ship at `default_enabled: false,
 * default_rollout_percent: 0, stage: 'experimental'` per [[feature-flags]] rule.
 *
 * Promote via admin UI at `/admin/feature-flags` — never toggle in this file
 * after the initial insertion.
 */
import type { FlagDefinition } from '../../src/modules/feature_flags/registry.js';

/**
 * Inline constant for IDE autocompletion during development.
 * The scaffolder copies the literal object (not the import) into registry.ts.
 */
export const {{SLUG_UPPER}}_FLAG = {
  key: '{{SLUG_UPPER}}',
  description: 'TODO: Fill in a description ≤80 chars for {{slug}}.',
  default_enabled: false,
  default_rollout_percent: 0,
  stage: 'experimental',
  owner_email: '{{owner}}',
} satisfies FlagDefinition;
