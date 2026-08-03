/**
 * Shared admin-section list + per-section REAL-DATA signals for the Browserbase
 * real-Chrome visual sweeps. ONE source of truth so the e2e-org sweep
 * ({@link ./admin-section-sweep.spec.ts}) and the brian-account sweep
 * ({@link ./admin-section-sweep-brian.spec.ts}) can never drift.
 *
 * `signal` is a per-section proof the section rendered ITS OWN data domain — not
 * a blank/spinner/error shell or the wrong section (directive "populated, not
 * just gated" — Brian 2026-08-02 [[convergence-verify-populated-not-just-gated]]).
 * Signals match domain labels / headings / empty-state copy, so they pass for a
 * real-data account AND for a row-empty account [[e2e-key-is-not-brians-account]];
 * what they REJECT is a section that didn't render its content.
 */
export interface AdminSection {
  /** URL segment under /admin/ ('' = the dashboard hub). */
  readonly path: string;
  /** Regex the section's <main> innerText MUST match to prove real data rendered. */
  readonly signal: RegExp;
}

/** The 20 top-level admin sections. logs/user live in admin-deep-visual. */
export const SECTIONS: readonly AdminSection[] = [
  { path: '', signal: /site|getting started|dashboard|create|deploy/i },
  { path: 'analytics', signal: /\d/ }, // real traffic numbers (Network Overview)
  { path: 'feature-flags', signal: /experimental|beta|stable|killswitch|flag/i },
  { path: 'apps', signal: /app|install|connect|catalog|integration/i },
  { path: 'system-services', signal: /service|status|operational|worker|healthy|degraded/i },
  { path: 'docs', signal: /doc|guide|api|reference|endpoint/i },
  { path: 'billing', signal: /plan|billing|subscription|free|pro|invoice|payment/i },
  { path: 'domains', signal: /domain|hostname|dns|projectsites|custom/i },
  { path: 'snapshots', signal: /snapshot|version|restore|initial|frozen/i },
  { path: 'forms', signal: /form|submission|contact|field|response/i },
  { path: 'social', signal: /social|post|connect|platform|schedule|account/i },
  { path: 'media', signal: /media|upload|image|asset|library|stock/i },
  { path: 'seo', signal: /seo|meta|keyword|sitemap|title|description/i },
  { path: 'site-features', signal: /feature|enable|plan|flag|capability/i },
  { path: 'settings', signal: /setting|preference|notification|account|language/i },
  { path: 'voice', signal: /voice|call|agent|phone|prompt|greeting/i },
  { path: 'auth-security', signal: /session|security|2fa|password|device|sign|authentication/i },
  { path: 'api-tokens', signal: /token|key|api|secret|create|scope/i },
  { path: 'audit', signal: /audit|action|event|log|activity|timestamp/i },
  { path: 'mcp', signal: /mcp|connect|provider|server|integration/i },
  { path: 'team', signal: /team|member|invite|role|owner|seat|pending/i },
  { path: 'leads', signal: /lead|scan|contact|prospect|capture|email|source/i },
] as const;

/**
 * Operator-only sections swept ONLY in the brian sweep, NEVER the e2e-org one.
 * `super-admin` redirects non-operators (e2e-org → /admin/site-features) so it
 * can't join the shared SECTIONS — the e2e-org sweep would land on the wrong page
 * and fail the signal. brian (`is_super_admin=1` + on SYS_ADMIN_EMAILS) sees the
 * real console. The signal is DATA-SPECIFIC (markup/wallet/cost-category/factor) so
 * a ⛔ "Restricted"/403 state — which renders only the "Super admin" h1 — would
 * FAIL, correctly flagging a missing-real-data regression.
 */
export const BRIAN_ONLY_SECTIONS: readonly AdminSection[] = [
  { path: 'super-admin', signal: /markup|wallet|cost categor|base cost|factor|balance|adjustment/i },
] as const;

/** Copy that indicates a genuinely broken surface (not an honest empty state). */
export const BROKEN: readonly string[] = [
  'something went wrong',
  'internal server error',
  'application error',
  'failed to load the admin',
];
