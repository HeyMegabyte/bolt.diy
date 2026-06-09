/**
 * Per-flag detailed explanations + smoke-test instructions.
 *
 * Surfaced by `GET /api/feature-flags/:key` (merged in by services.ts) and
 * rendered in /admin/feature-flags + /admin/features expanded cards.
 *
 * Each entry has:
 *   - `explanation` — 100-200 word description of what the feature does,
 *     the underlying mechanism, and why it matters. Cite the prior-turn
 *     research where applicable.
 *   - `smoke_test` — copy-pasteable curl commands + step-by-step UI flow
 *     to verify the feature works once the flag is enabled. Headers / body
 *     samples included.
 *   - `e2e_tests` — Playwright spec paths (relative to apps/project-sites/)
 *     that exercise the feature against the prod URL. Per the SUPREME
 *     [[feature-flags]] rule, a promoted flag should carry at least one. The
 *     paths here are the canonical `e2e/_fortress/<slug>/` adversarial +
 *     happy-path specs.
 *
 * Flags without a docs entry fall back to the short description from
 * registry.ts. Add entries here as new flags ship.
 */

export interface FlagDocs {
  explanation: string;
  smoke_test: string[];
  /** Playwright spec paths (relative to apps/project-sites/) covering this flag. */
  e2e_tests?: string[];
  references?: string[];
}

export const FLAG_DOCS: Record<string, FlagDocs> = {
  token_burn_meter: {
    explanation:
      "Live monthly AI-token burn meter shown in the editor header. Tracks per-model spend (Opus / Sonnet / Workers AI / GPT-5), projects the month-end total based on current pace, and warns at 80% / 100% of the customer's tier cap. Solves Bolt.new + V0's #1 complaint in 2026: token-burn rage (\"$1000+ spent fixing issues\" — NxCode).",
    smoke_test: [
      "GET /api/usage/burn?org_id=demo-org → returns {used_usd, used_tokens, projected_monthly_usd, by_model, thresholds:[{pct:80}, {pct:100}]}",
      "POST /api/usage/record with body {org_id:'demo-org', model:'claude-sonnet-4-6', input_tokens:1000, output_tokens:500} → returns event id + USD cents",
      'Repeat the POST several times — GET /api/usage/burn should reflect cumulative spend',
      'UI: editor header chip shows live "$X / $Y this month" with projection — click expands per-model breakdown modal',
    ],
  },
  speculation_rules: {
    explanation:
      "Auto-injects <script type=\"speculationrules\"> on every marketing HTML response. Prerenders same-origin nav at moderate eagerness, prefetches at conservative. Ray-Ban doubled conversion via Speculation Rules. Already at stage=stable + default-on.",
    smoke_test: [
      'curl https://projectsites.dev/ | grep speculationrules → should match',
      'Browser DevTools → Application → Speculation Rules → see the active prerender + prefetch rules',
      'Hover any internal link → Chrome prerenders the destination in the background',
    ],
  },
  structured_data_autopilot: {
    explanation:
      "Auto-emits Organization + WebSite + WebPage + FAQPage JSON-LD on every marketing route. ChatGPT lifts FAQ schema verbatim into answers (highest AI-citation rate). Already stage=stable + default-on.",
    smoke_test: [
      "curl https://projectsites.dev/ | grep -oE 'application/ld\\+json' | wc -l → should be ≥ 4 (Org + WebSite + WebPage + FAQ)",
      "Pipe HTML to Google's Rich Results Test → all entities should validate",
    ],
  },
  quotable_answer_block: {
    explanation:
      "Every page auto-emits a <div data-quotable> with a 40-60 word lead paragraph optimized for AI-search extraction. Sr-only positioned so visible to crawlers + screen readers, hidden from sighted layout. Stage=stable + default-on.",
    smoke_test: [
      "curl https://projectsites.dev/ | grep -oE 'data-quotable' → must match",
      'View Source → search for data-quotable → see the 40-60 word block',
    ],
  },
  llms_txt: {
    explanation:
      "/llms.txt + /llms-full.txt per site. Markdown index of highest-priority routes for AI crawlers. AI-crawler-aware /robots.txt explicitly addresses GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Bytespider. Stage=stable.",
    smoke_test: [
      'curl https://projectsites.dev/llms.txt → 200 + markdown body',
      'curl https://projectsites.dev/llms-full.txt → 200 + full content snapshot',
      "curl https://projectsites.dev/robots.txt | grep -E 'GPTBot|ClaudeBot|PerplexityBot' → must match each",
    ],
  },
  accessibility_statement: {
    explanation:
      "Per-customer /accessibility page with WCAG 2.2 conformance statement + IRS Section 44 Disabled Access Credit explainer ($5,000/yr for qualifying small biz). ADA Title II April 2027 deadline approaches; every customer site needs this.",
    smoke_test: [
      'curl https://projectsites.dev/accessibility → 200 HTML',
      "Body contains 'WCAG 2.2', 'IRS Section 44' or 'Form 8826', mailto:accessibility@projectsites.dev",
    ],
  },
  mcp_server: {
    explanation:
      "Model Context Protocol server discovery at /.well-known/mcp. Lists 5 tools (list_sites, create_site, deploy_site, get_site_metrics, regenerate_section). Claude / Cursor / Windsurf users connect their projectsites account via MCP. OAuth 2.1 + RFC 8707 Resource Indicators at /.well-known/oauth-protected-resource. Stage=stable.",
    smoke_test: [
      'curl https://projectsites.dev/.well-known/mcp → 200 JSON with tools[] array',
      'curl https://projectsites.dev/.well-known/oauth-protected-resource → 200 JSON with resource + authorization_servers + scopes_supported',
    ],
  },
  public_api: {
    explanation:
      "Public REST API with OpenAPI 3.1 spec at /api/openapi.json. Bearer-token auth. Webhook system for every site event (site.published, lead.captured, deploy.failed). Stage=stable.",
    smoke_test: [
      'curl https://projectsites.dev/api/openapi.json → 200 OpenAPI 3.1 JSON',
      'Spec has paths /api/v1/sites + /api/v1/sites/{id}/deploy',
    ],
  },
  pwa_manifest_full: {
    explanation:
      "Full PWA manifest with screenshots (3+ form_factor:wide/narrow), shortcuts (3+), share_target, file_handlers, protocol_handlers. Required for App Store + Play Store listings. Per [[always]] this is a per-site Hard Gate.",
    smoke_test: [
      'GET /api/pwa/manifest?org_id=demo-org → returns manifest with screenshots[] (3), shortcuts[] (3), share_target, file_handlers, protocol_handlers',
    ],
  },
  // ── 10 brilliant
  site_mcp_server: {
    explanation:
      "Per-customer-site MCP server auto-emitted at {slug}.projectsites.dev/.well-known/mcp. Tools are built from the site's _research.json (get_hours, get_menu, book_appointment, submit_lead, ask_about) so Siri / Claude / Cursor can query it. Compounding moat: every shipped customer site instantly joins the MCP-discoverable network. No competitor (Bolt/V0/Lovable/Webflow) ships this.",
    smoke_test: [
      'POST /api/sites/{siteId}/mcp/discovery to (re)generate the MCP manifest from research_data',
      'GET /api/sites/{siteId}/mcp/discovery → returns {name, version, tools[], transport, authorization_server}',
      "GET {slug}.projectsites.dev/.well-known/mcp from a Claude/Cursor client → tool list resolves",
      "Try a tool call: list_sites / get_hours / submit_lead — returns real data from D1",
    ],
  },
  ai_auto_router: {
    explanation:
      "Extends multi_model_router with AUTOMATIC routing per prompt shape. Classifies (simple / complex / creative / free-eligible) via Workers AI classifier → routes to cheapest sufficient model. ~80% AI cost reduction at scale with no quality loss; customer never picks manually.",
    smoke_test: [
      'POST /api/router/pick with body {prompt:\"Add a pricing section\"} → returns {classification, picked_model, estimated_cost_usd, alternatives}',
      "Compare a simple prompt vs complex refactor request — should route to free Llama vs Opus respectively",
      'GET /api/router/stats?org_id=demo-org → savings vs always-Opus baseline',
    ],
  },

  // ── Core always-on surfaces + fortress-backed flags ───────────────────────
  //   These carry the canonical e2e/_fortress/<slug>/ adversarial+happy-path
  //   specs (the SUPREME feature-flags rule's e2e_tests runbook column).
  core_auth: {
    explanation:
      "Always-on auth surface: passwordless magic-link (Resend/SendGrid) + Google OAuth + session cookies. isFlagOn always returns true (sentinel). Sessions resolve userId/orgId in the auth middleware without rejecting unauthed requests — route guards decide access. Magic links are single-use, 15-min TTL; OAuth uses PKCE state in oauth_states.",
    smoke_test: [
      "Homepage → Sign in → enter email → 'check your inbox' state shows",
      "POST /api/auth/magic-link {email} → 200 + magic_links row created",
      "GET /api/auth/magic-link/verify?token=… → sets session cookie → redirects to /admin",
      "GET /api/auth/me with the cookie → returns {user, org}",
    ],
    e2e_tests: ['e2e/_fortress/auth/happy-path.spec.ts', 'e2e/_fortress/auth/adversarial.spec.ts'],
  },
  core_site_create: {
    explanation:
      "Always-on homepage site-creation funnel: search business → select → sign in → provide details/upload → AI build workflow kicks off. isFlagOn always true (sentinel). Drives the golden path; the create-from-search endpoint seeds a site row + starts the SITE_WORKFLOW.",
    smoke_test: [
      "Homepage → search a business name → results render in <1s",
      "Select a result → sign-in gate → details form",
      "POST /api/sites/create-from-search → 200 + site row (status=draft) + workflow_jobs row",
      "Redirect to /waiting → real-time build progress",
    ],
    e2e_tests: ['e2e/_fortress/site-create/happy-path.spec.ts', 'e2e/_fortress/site-create/adversarial.spec.ts'],
  },
  core_admin_detail: {
    explanation:
      "Always-on admin site-detail split-view: left rail = sections nav, right = the selected section (sites, media, forms, editor, etc.). isFlagOn always true (sentinel). The persistent bolt.diy iframe lives in the admin shell so WebContainer cold-boot happens once per session.",
    smoke_test: [
      "Open /admin → app-root + sidebar render",
      "Project-select resolves a site → per-site sections load their real data",
      "Navigate sections via routerLink → no full reload (SPA sentinel holds)",
    ],
    e2e_tests: ['e2e/_fortress/admin-detail/happy-path.spec.ts', 'e2e/_fortress/admin-detail/adversarial.spec.ts'],
  },
  core_feature_flags: {
    explanation:
      "Always-on feature-flags admin UI at /admin/feature-flags: lists every registry flag with default state + stage, search + stage filter, per-flag detail (resolved state + docs), and override mutations (global/org/tenant). isFlagOn always true (sentinel) — the control plane can't be flagged off.",
    smoke_test: [
      "GET /api/feature-flags → returns the full registry with has_docs",
      "/admin/feature-flags → search 'auth' filters the list; stage pills filter by stage",
      "Click a flag → GET /api/feature-flags/:key → detail shows resolved state + docs (explanation/smoke_test/e2e_tests)",
      "POST /api/admin/feature-flags/:key/override → flips state; KV cache invalidates immediately",
    ],
    e2e_tests: ['e2e/_fortress/feature-flags/happy-path.spec.ts', 'e2e/_fortress/feature-flags/adversarial.spec.ts'],
  },
  unified_inbox: {
    explanation:
      "Unified Visitor Inbox: forms + chat + voice + email + SMS captures collapse under one visitor identity, assignable to team members, SLA-tracked, with AI-drafted replies. Dedupes via the shared contacts core. When OFF the /api/inbox/* routes 404.",
    smoke_test: [
      "Submit a contact form on a published site → a thread appears in /admin → Inbox",
      "GET /api/inbox/tasks → returns open threads for the org",
      "Assign a thread + draft an AI reply → status transitions",
      "POST /api/inbox/tasks/:id/resolve → thread closes",
    ],
    e2e_tests: ['e2e/_fortress/inbox/happy-path.spec.ts', 'e2e/_fortress/inbox/adversarial.spec.ts'],
  },
  // (billing is always-on core, not a registry flag — its fortress specs
  //  e2e/_fortress/billing/* exist but there's no flag key to attach docs to.)
};

export function getDocs(key: string): FlagDocs | undefined {
  return FLAG_DOCS[key];
}
