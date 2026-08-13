/**
 * Regression guard for ROUTE-GUARD ↔ REGISTRY coherence.
 *
 * A route handler gated by `requireFlag('x')` / `isFlagOn(env, 'x')` only works
 * if `x` exists in FLAG_REGISTRY — otherwise `resolveFlag` fail-closes and the
 * feature 404s *permanently* in prod. `validate-feature-manifests` already
 * guards manifest.flagKey ∈ registry, but NON-manifest route features (gated
 * inline in a route file with no libs/features manifest) are NOT covered by it —
 * which is exactly how `approval_workflow` / `multimodal_copilot` /
 * `domain_stack_wizard` ended up referenced by live routes but absent from the
 * registry (see UNFINISHED_FEATURES §11n). This test locks the REGISTERED live
 * set against accidental trim-removal (the iter-11d/e failure mode).
 */

import * as fs from 'fs';
import * as path from 'path';
import { FLAG_REGISTRY } from '../modules/feature_flags/services.js';

/**
 * Flags that gate a LIVE own-file route or a mounted libs/features handler AND
 * are currently registered. If a future flag trim removes any of these while the
 * route still references it, that feature silently 404s — this guard fails first.
 */
const LIVE_ROUTE_FLAGS = [
  // own-file route modules
  'unified_inbox',
  'outbound_webhooks',
  'email_deliverability_wizard',
  // features.ts grab-bag (wired + tested in prior loop iters)
  'token_burn_meter',
  'pwa_manifest_full',
  'ai_auto_router',
  // libs/features modules
  'gbp_assist',
  // stable discovery / quality surfaces
  'public_api',
  // NOTE (2026-08-12 dead-flag prune): 8 keys removed from this list — abuse_takedown,
  // visitor_events_core, llms_txt, mcp_server, accessibility_statement, speculation_rules,
  // structured_data_autopilot, quotable_answer_block. Verified via audit-feature-flags.mjs
  // + grep(routes/,index.ts): NONE gate a route (0 requireFlag/isFlagOn refs). This list
  // had drifted into a "flag exists in registry" check rather than a real route-gate check.
];

/**
 * Flags referenced by live, BUILT, tested route files that are NOT YET in the
 * registry → these features 404 until registered. Being added by the in-flight
 * review/copilot/domain convergence session (registry.ts concurrently modified
 * 2026-06-08); tracked in UNFINISHED_FEATURES §11n. Each maps to a real route
 * file whose existence we assert below (proves the gap is "registry entry
 * missing", not "feature unbuilt").
 */
const PENDING_REGISTRATION: Array<{ flag: string; routeFile: string }> = [
  { flag: 'approval_workflow', routeFile: '../routes/review_links.ts' },
  { flag: 'multimodal_copilot', routeFile: '../routes/copilot.ts' },
  { flag: 'domain_stack_wizard', routeFile: '../routes/domain_stack.ts' },
];

describe('flag ↔ route coherence', () => {
  it('every live-route flag is present in FLAG_REGISTRY (guard would 404 otherwise)', () => {
    const missing = LIVE_ROUTE_FLAGS.filter((f) => !FLAG_REGISTRY[f]);
    expect(missing).toEqual([]);
  });

  it('each registered live-route flag carries the required definition fields', () => {
    for (const f of LIVE_ROUTE_FLAGS) {
      const def = FLAG_REGISTRY[f];
      expect(def.key).toBe(f);
      expect(typeof def.default_enabled).toBe('boolean');
      expect(typeof def.default_rollout_percent).toBe('number');
      expect(typeof def.stage).toBe('string');
    }
  });

  it('pending-registration features are genuinely BUILT (route files exist) — only the registry entry is missing', () => {
    for (const { routeFile } of PENDING_REGISTRATION) {
      expect(fs.existsSync(path.resolve(__dirname, routeFile))).toBe(true);
    }
    // Note: we deliberately do NOT assert these flags are absent from the
    // registry — the convergence session may register them at any moment, and
    // coupling a test to that race would flake. When they land, fold them into
    // LIVE_ROUTE_FLAGS above and drop them from PENDING_REGISTRATION.
  });
});
