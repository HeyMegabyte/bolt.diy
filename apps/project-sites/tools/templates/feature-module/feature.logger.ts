/**
 * Scoped logger for {{slug}}.
 *
 * @remarks
 * Uses `log.child('{{slug}}')` from `src/lib/log.ts` so every emitted line
 * carries `{ scope: '{{slug}}' }` and is grep-able in Workers Tail:
 *
 * ```bash
 * wrangler tail --format json | jq 'select(.scope=="{{slug}}")'
 * ```
 *
 * Import `featureLog` directly — do NOT re-export `log` from here.
 */

import { log } from '../../src/lib/log.js';

/**
 * Child logger scoped to `{{slug}}`.
 *
 * @example
 * ```ts
 * featureLog.info('{{slug}}.created', { id, orgId });
 * featureLog.error('{{slug}}.failed', { error: err.message });
 * ```
 */
export const featureLog = log.child('{{slug}}');
