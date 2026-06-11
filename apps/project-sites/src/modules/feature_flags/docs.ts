/**
 * Per-flag detailed explanations + a scannable checklist + smoke-test steps.
 *
 * Surfaced by `GET /api/feature-flags/:key` (spread verbatim by
 * routes/features.ts) and rendered in /admin/feature-flags expanded cards.
 *
 * Each entry has:
 *   - `checklist` — 3-6 short "what this does" checkpoints. The at-a-glance
 *     contract a reader scans BEFORE the prose. Every registry flag MUST carry
 *     one (the /admin/feature-flags detail panel renders it as a ✓ list).
 *   - `explanation` — 100-200 word description of the mechanism + why it matters.
 *   - `smoke_test` — copy-pasteable curl + UI steps to verify once enabled.
 *   - `e2e_tests` — Playwright spec paths (relative to apps/project-sites/).
 *   - `references` — optional doc / research links.
 *
 * "Merged scope" note: per the 2026-06-08 idea-merge wave, several roadmap
 * capabilities fold into an existing flag's scope rather than spawning a new
 * key. Those land as extra checklist checkpoints on the parent flag (e.g.
 * NLWeb /ask under site_mcp_server, behavioral personalization + bandit CRO
 * under visitor_events_core). Genuinely new keys: site_video_gen,
 * editor_vision_qa.
 *
 * Flags without a docs entry fall back to the short registry.ts description.
 */

export interface FlagDocs {
  /** 3-6 short "what this does" checkpoints — rendered as a ✓ list. */
  checklist: string[];
  explanation: string;
  smoke_test: string[];
  /** Playwright spec paths (relative to apps/project-sites/) covering this flag. */
  e2e_tests?: string[];
  references?: string[];
}

export const FLAG_DOCS: Record<string, FlagDocs> = {
  token_burn_meter: {
    checklist: [
      'Live monthly AI-token spend chip in the editor header',
      'Per-model breakdown (Opus / Sonnet / Workers AI / GPT-5)',
      'Month-end projection from current pace',
      'Warns at 80% and 100% of the tier cap',
    ],
    explanation:
      'Live monthly AI-token burn meter shown in the editor header. Tracks per-model spend (Opus / Sonnet / Workers AI / GPT-5), projects the month-end total based on current pace, and warns at 80% / 100% of the customer\'s tier cap. Solves Bolt.new + V0\'s #1 complaint in 2026: token-burn rage ("$1000+ spent fixing issues" — NxCode).',
    smoke_test: [
      'GET /api/usage/burn?org_id=demo-org → returns {used_usd, used_tokens, projected_monthly_usd, by_model, thresholds:[{pct:80}, {pct:100}]}',
      "POST /api/usage/record with body {org_id:'demo-org', model:'claude-sonnet-4-6', input_tokens:1000, output_tokens:500} → returns event id + USD cents",
      'Repeat the POST several times — GET /api/usage/burn should reflect cumulative spend',
      'UI: editor header chip shows live "$X / $Y this month" with projection — click expands per-model breakdown modal',
    ],
  },
  site_analytics: {
    checklist: [
      'Owner-facing per-site analytics summary',
      'Aggregates contacts, form submissions, subscribers + donations',
      'Traffic block fed by the visitor-events beacon',
      'When off, /api/sites/:id/analytics returns 404',
    ],
    explanation:
      "Owner-facing per-site analytics dashboard. Aggregates the contacts core, form submissions, newsletter subscribers and donations into one summary, plus a traffic block fed by visitor_events_core. Read-only; never exposes another tenant's numbers (site-scoped query). When off the route 404s (never 403 — don't leak existence).",
    smoke_test: [
      'GET /api/sites/:id/analytics → {contacts, submissions, subscribers, donations, traffic}',
      'Submit a form on the published site → counts increment within the refresh window',
      'Disable the flag → the route 404s',
    ],
    e2e_tests: ['e2e/admin/analytics.spec.ts'],
  },
  visitor_events_core: {
    checklist: [
      'Public pageview / click / conversion beacon ingest',
      'Feeds the site_analytics traffic block',
      'Powers edge behavioral personalization (hero/CTA/proof swap by referral+UTM+geo)',
      'Powers autonomous bandit CRO (AI variants, traffic auto-shifts to the winner)',
      'Tenant-scoped; no cross-site bleed',
    ],
    explanation:
      'Public beacon endpoint (POST /api/v1/events) that ingests pageviews, clicks and conversions from published sites. It is the data spine for two merged capabilities: (1) edge behavioral personalization — segment a visitor by referral source + UTM + geo + return-status and swap hero/CTA/social-proof at the edge; and (2) autonomous bandit CRO — AI generates variant copy, a multi-armed bandit shifts live traffic to the winner, and the winner auto-promotes. Events are tenant-namespaced.',
    smoke_test: [
      'POST /api/v1/events {site_id, type:"pageview", path:"/"} → 202 accepted',
      'GET the site_analytics traffic block → reflects the beacon',
      'Personalization: load with ?utm_source=ads vs direct → hero variant differs',
    ],
  },
  email_marketing: {
    checklist: [
      'Branded subscriber signup form on the site',
      'Campaign composer — send from the owner domain via Resend',
      'CAN-SPAM one-click unsubscribe baked in',
      'Sends only to consented contacts + confirmed subscribers',
    ],
    explanation:
      "Real newsletter-campaign send pipeline (replaces the earlier stub recipient count). Collects consented subscribers, composes branded campaigns, and sends via Resend batch from the owner's verified domain. Every send carries RFC 8058 one-click unsubscribe + List-Unsubscribe headers per the email-deliverability gate. Off → /api/campaigns 404s.",
    smoke_test: [
      'POST /api/campaigns {subject, html} → queued; recipients = consented contacts',
      'Check a delivered message has List-Unsubscribe + one-click POST headers',
      'Unsubscribe link → contact suppressed from future sends',
    ],
  },
  speculation_rules: {
    checklist: [
      'Injects <script type="speculationrules"> on marketing HTML',
      'Prerenders same-origin nav at moderate eagerness',
      'Prefetches at conservative eagerness',
      'Stable + default-on',
    ],
    explanation:
      'Auto-injects <script type="speculationrules"> on every marketing HTML response. Prerenders same-origin nav at moderate eagerness, prefetches at conservative. Ray-Ban doubled conversion via Speculation Rules. Already at stage=stable + default-on.',
    smoke_test: [
      'curl https://projectsites.dev/ | grep speculationrules → should match',
      'Browser DevTools → Application → Speculation Rules → see the active prerender + prefetch rules',
      'Hover any internal link → Chrome prerenders the destination in the background',
    ],
  },
  structured_data_autopilot: {
    checklist: [
      'Auto-emits Organization + WebSite + WebPage + FAQPage JSON-LD',
      'Runs on every marketing route',
      'FAQ schema is what ChatGPT lifts verbatim into answers',
      'Stable + default-on',
    ],
    explanation:
      'Auto-emits Organization + WebSite + WebPage + FAQPage JSON-LD on every marketing route. ChatGPT lifts FAQ schema verbatim into answers (highest AI-citation rate). Already stage=stable + default-on.',
    smoke_test: [
      "curl https://projectsites.dev/ | grep -oE 'application/ld\\+json' | wc -l → should be ≥ 4 (Org + WebSite + WebPage + FAQ)",
      "Pipe HTML to Google's Rich Results Test → all entities should validate",
    ],
  },
  quotable_answer_block: {
    checklist: [
      'Emits a <div data-quotable> 40-60 word lead per page',
      'Optimized for AI-search extraction',
      'Visible to crawlers + screen readers, hidden from sighted layout',
      'Stable + default-on',
    ],
    explanation:
      'Every page auto-emits a <div data-quotable> with a 40-60 word lead paragraph optimized for AI-search extraction. Sr-only positioned so visible to crawlers + screen readers, hidden from sighted layout. Stage=stable + default-on.',
    smoke_test: [
      "curl https://projectsites.dev/ | grep -oE 'data-quotable' → must match",
      'View Source → search for data-quotable → see the 40-60 word block',
    ],
  },
  llms_txt: {
    checklist: [
      '/llms.txt + /llms-full.txt per site',
      'Markdown index of highest-priority routes for AI crawlers',
      'AI-crawler-aware robots.txt (GPTBot / ClaudeBot / PerplexityBot / …)',
      'Stable',
    ],
    explanation:
      '/llms.txt + /llms-full.txt per site. Markdown index of highest-priority routes for AI crawlers. AI-crawler-aware /robots.txt explicitly addresses GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Bytespider. Stage=stable.',
    smoke_test: [
      'curl https://projectsites.dev/llms.txt → 200 + markdown body',
      'curl https://projectsites.dev/llms-full.txt → 200 + full content snapshot',
      "curl https://projectsites.dev/robots.txt | grep -E 'GPTBot|ClaudeBot|PerplexityBot' → must match each",
    ],
  },
  accessibility_statement: {
    checklist: [
      'Per-customer /accessibility page',
      'WCAG 2.2 conformance statement',
      'IRS Section 44 Disabled Access Credit explainer',
      'mailto:accessibility@ contact for remediation requests',
    ],
    explanation:
      'Per-customer /accessibility page with WCAG 2.2 conformance statement + IRS Section 44 Disabled Access Credit explainer ($5,000/yr for qualifying small biz). ADA Title II April 2027 deadline approaches; every customer site needs this.',
    smoke_test: [
      'curl https://projectsites.dev/accessibility → 200 HTML',
      "Body contains 'WCAG 2.2', 'IRS Section 44' or 'Form 8826', mailto:accessibility@projectsites.dev",
    ],
  },
  mcp_server: {
    checklist: [
      'Platform MCP discovery at /.well-known/mcp',
      '5 tools: list_sites / create_site / deploy_site / get_site_metrics / regenerate_section',
      'OAuth 2.1 + RFC 8707 resource indicators',
      'Connect from Claude / Cursor / Windsurf',
      'Stable',
    ],
    explanation:
      'Model Context Protocol server discovery at /.well-known/mcp. Lists 5 tools (list_sites, create_site, deploy_site, get_site_metrics, regenerate_section). Claude / Cursor / Windsurf users connect their projectsites account via MCP. OAuth 2.1 + RFC 8707 Resource Indicators at /.well-known/oauth-protected-resource. Stage=stable.',
    smoke_test: [
      'curl https://projectsites.dev/.well-known/mcp → 200 JSON with tools[] array',
      'curl https://projectsites.dev/.well-known/oauth-protected-resource → 200 JSON with resource + authorization_servers + scopes_supported',
    ],
    e2e_tests: ['e2e/mcp/mcp-providers.spec.ts'],
  },
  public_api: {
    checklist: [
      'Public REST API with OpenAPI 3.1 spec at /api/openapi.json',
      'Bearer-token auth',
      'Webhook events: site.published / lead.captured / deploy.failed',
      'Stable',
    ],
    explanation:
      'Public REST API with OpenAPI 3.1 spec at /api/openapi.json. Bearer-token auth. Webhook system for every site event (site.published, lead.captured, deploy.failed). Stage=stable.',
    smoke_test: [
      'curl https://projectsites.dev/api/openapi.json → 200 OpenAPI 3.1 JSON',
      'Spec has paths /api/v1/sites + /api/v1/sites/{id}/deploy',
    ],
  },
  pwa_manifest_full: {
    checklist: [
      'Full PWA manifest per site',
      'screenshots[] (3+ wide/narrow) for store listings',
      'shortcuts[] (3+), share_target, file_handlers, protocol_handlers',
      'Per [[always]] this is a per-site Hard Gate',
    ],
    explanation:
      'Full PWA manifest with screenshots (3+ form_factor:wide/narrow), shortcuts (3+), share_target, file_handlers, protocol_handlers. Required for App Store + Play Store listings. Per [[always]] this is a per-site Hard Gate.',
    smoke_test: [
      'GET /api/pwa/manifest?org_id=demo-org → returns manifest with screenshots[] (3), shortcuts[] (3), share_target, file_handlers, protocol_handlers',
    ],
    e2e_tests: ['e2e/pwa.spec.ts'],
  },
  site_mcp_server: {
    checklist: [
      'Per-site MCP server at {slug}.projectsites.dev/.well-known/mcp',
      'Tools built from the site research (get_hours / get_menu / book_appointment / submit_lead)',
      'NLWeb /ask endpoint — natural-language → Schema.org JSON for any agent (merged scope)',
      'Queryable by Siri / Claude / Cursor / Perplexity',
      'Read-only by default, token-gated',
    ],
    explanation:
      "Per-customer-site MCP server auto-emitted at {slug}.projectsites.dev/.well-known/mcp. Tools are built from the site's _research.json (get_hours, get_menu, book_appointment, submit_lead, ask_about) so Siri / Claude / Cursor can query it. Merged scope: the NLWeb /ask endpoint (natural-language query → Schema.org JSON) so any MCP/agent client can read the site without a custom integration. Compounding moat: every shipped customer site instantly joins the agent-discoverable network. No competitor (Bolt/V0/Lovable/Webflow) ships this.",
    smoke_test: [
      'POST /api/sites/{siteId}/mcp/discovery to (re)generate the MCP manifest from research_data',
      'GET /api/sites/{siteId}/mcp/discovery → returns {name, version, tools[], transport, authorization_server}',
      'GET {slug}.projectsites.dev/.well-known/mcp from a Claude/Cursor client → tool list resolves',
      'POST {slug}.projectsites.dev/ask {"q":"what are your hours?"} → Schema.org JSON answer',
    ],
    e2e_tests: ['e2e/site-mcp/site-mcp.spec.ts'],
  },
  ai_auto_router: {
    checklist: [
      'Classifies each prompt (simple / complex / creative / free-eligible)',
      'Routes to the cheapest sufficient model automatically',
      '~80% AI cost reduction at scale, no quality loss',
      'Customer never picks a model manually',
    ],
    explanation:
      'Extends multi_model_router with AUTOMATIC routing per prompt shape. Classifies (simple / complex / creative / free-eligible) via Workers AI classifier → routes to cheapest sufficient model. ~80% AI cost reduction at scale with no quality loss; customer never picks manually.',
    smoke_test: [
      'POST /api/router/pick with body {prompt:"Add a pricing section"} → returns {classification, picked_model, estimated_cost_usd, alternatives}',
      'Compare a simple prompt vs complex refactor request — should route to free Llama vs Opus respectively',
      'GET /api/router/stats?org_id=demo-org → savings vs always-Opus baseline',
    ],
  },
  search_engine_submit: {
    checklist: [
      'Auto-submit new + updated URLs to IndexNow (Bing + Yandex)',
      'Bing + Google sitemap pings on publish',
      'No manual Search Console steps',
      'Per-page index-status tracking',
    ],
    explanation:
      'Auto-submit published sites to IndexNow (Bing+Yandex) + Bing/Google sitemap pings on publish. New and updated URLs are submitted the moment the owner publishes — no manual Search Console round-trip. Off → the publish hook skips submission.',
    smoke_test: [
      'Publish a site → POST to IndexNow fires for changed URLs',
      'GET /api/sites/:id/indexing → per-URL submission status',
    ],
  },
  gbp_assist: {
    checklist: [
      'Guided Google Business Profile claim / create deep-link',
      'AI-optimized description + posts',
      'Drafted replies to customer reviews (merged: reputation engine)',
      'Pulls Google / Yelp reviews into testimonial sections (merged)',
    ],
    explanation:
      'One-click Google Business Profile setup + optimizer: detect, claim/create deep-link, AI SEO content pack + guided checklist. Merged scope: the reputation / review-synthesis engine — pull Google + Yelp reviews, AI-synthesize them into testimonial sections, and draft owner responses with a sentiment view.',
    smoke_test: [
      'GET /api/sites/:id/gbp → detection + claim/create deep-link + checklist',
      'POST /api/sites/:id/gbp/reviews/sync → pulls reviews; AI drafts replies',
    ],
  },
  pseo_matrix_v2: {
    checklist: [
      'User-task pages (not bare keywords)',
      '≥40% unique data floor per page (live Places, real reviews, real pricing)',
      'Covers comparison / alternative + integration-directory page sets (merged)',
      'Cap 200 per axis',
    ],
    explanation:
      "pSEO v2: user-tasks (not keywords) + ≥40% unique data floor per page from live Google Places, real reviews, real pricing. Cap 200 per axis. Merged scope: the comparison/alternative ('X vs Y') and integration-directory page sets ride this same generator.",
    smoke_test: [
      'POST /api/sites/:id/pseo/generate → returns the planned page matrix + unique-data ratio per page',
      'Generated page renders real Places/review/pricing data, not boilerplate',
    ],
    e2e_tests: ['e2e/pseo/pseo-matrix.spec.ts'],
  },
  unified_inbox: {
    checklist: [
      'Forms + chat + voice + email + SMS under one visitor identity',
      'Assignable to team members, SLA-tracked',
      'AI-drafted replies',
      'When off, /api/inbox/* returns 404',
    ],
    explanation:
      'Unified Visitor Inbox: forms + chat + voice + email + SMS captures collapse under one visitor identity, assignable to team members, SLA-tracked, with AI-drafted replies. Dedupes via the shared contacts core. When OFF the /api/inbox/* routes 404.',
    smoke_test: [
      'Submit a contact form on a published site → a thread appears in /admin → Inbox',
      'GET /api/inbox/tasks → returns open threads for the org',
      'Assign a thread + draft an AI reply → status transitions',
      'POST /api/inbox/tasks/:id/resolve → thread closes',
    ],
    e2e_tests: [
      'e2e/_fortress/unified_inbox/happy-path.spec.ts',
      'e2e/_fortress/unified_inbox/adversarial.spec.ts',
    ],
  },
  email_deliverability_wizard: {
    checklist: [
      'Checks a sending domain SPF + DKIM + DMARC via DNS-over-HTTPS',
      'Returns a 0-100 deliverability score',
      'Concrete copy-paste DNS fixes',
      'Read-only — persists nothing',
    ],
    explanation:
      'Email Deliverability Wizard (#12): checks a sending domain SPF, DKIM and DMARC via DNS-over-HTTPS and returns a 0-100 score plus concrete DNS fixes. Read-only, persists nothing.',
    smoke_test: [
      'POST /api/email-deliverability {domain} → {score, spf, dkim, dmarc, fixes[]}',
      'A domain missing DMARC → score drops + a fix record appears',
    ],
    e2e_tests: ['e2e/admin/deliverability.spec.ts'],
  },
  outbound_webhooks: {
    checklist: [
      'Customers subscribe their own https endpoints to site events',
      'Deliveries HMAC-signed + replay-safe',
      'Retried with backoff',
      'Endpoint secret AES-GCM encrypted at rest',
    ],
    explanation:
      'Outbound Webhooks (#10): customers subscribe their own https endpoints to site events; deliveries are signed (HMAC, replay-safe) + retried with backoff. Endpoint secret AES-GCM encrypted at rest. CRUD at /api/sites/:siteId/webhooks.',
    smoke_test: [
      'POST /api/sites/:siteId/webhooks {url, events[]} → 201 + signing secret',
      'Trigger a site event → endpoint receives a signed POST; bad sig is rejected',
    ],
    e2e_tests: ['e2e/webhook/webhooks.spec.ts'],
  },
  abuse_takedown: {
    checklist: [
      'Public abuse-report intake for published sites',
      'DMCA / illegal-content takedown workflow',
      'Status pipeline: reported → reviewing → actioned',
      'Hosting-platform legal necessity',
    ],
    explanation:
      'Abuse report intake + content takedown workflow for published sites (DMCA / illegal-content handling). A hosting-platform necessity: a public report form, a review queue, and a takedown action that can unpublish a site.',
    smoke_test: [
      'POST /api/abuse/report {site_id, reason} → 202 + case id',
      'Operator review queue shows the case; actioning it unpublishes the site',
    ],
  },
  site_video_gen: {
    checklist: [
      'Storyboard → Veo clips → assembled ~56s brand film (7×8s)',
      'Runs inside the site build Workflow',
      'Delivered device-adaptive via Media Transformations',
      'Per-site flag; off by default',
    ],
    explanation:
      'Per-site narrative video generator (merged from the brand-new set). During the build Workflow it storyboards the business, generates Veo clips, and assembles a ~56-second brand film (7×8s), stored in R2 and delivered device-adaptive via Cloudflare Media Transformations. No AI builder ships video generation inside the creation pipeline — this is a differentiating per-site capability, dark-launched.',
    smoke_test: [
      'POST /api/sites/:id/video/generate → queues a Workflow run; callback flips status',
      'GET /api/sites/:id/video → {status, r2_url, duration_s}',
      'Published page serves the film via /cdn-cgi/media device-adaptive URL',
    ],
    e2e_tests: ['e2e/media-video-studio.spec.ts'],
  },
  editor_vision_qa: {
    checklist: [
      'In-editor live AI vision critique while editing (not just post-build)',
      'Browser-Rendering screenshot → vision model scores layout / contrast / brand 0-10',
      'Inline fix suggestions per finding',
      'Distinct from the batch snapshot-quality workflow',
    ],
    explanation:
      'Real-time in-editor AI vision critique (merged from the brand-new set). On demand it screenshots the current editor preview via Cloudflare Browser Rendering, scores layout / contrast / brand 0-10 with a vision model, and surfaces inline fix suggestions — distinct from the post-build snapshot-quality workflow which scores asynchronously after publish.',
    smoke_test: [
      'POST /api/sites/:id/vision-qa {preview_url} → {score, findings[]}',
      'Each finding carries a category (layout/contrast/brand) + a suggested fix',
    ],
  },

  // ── Core always-on surfaces + fortress-backed flags ───────────────────────
  core_auth: {
    checklist: [
      'Passwordless magic-link (Resend / SendGrid)',
      'Google OAuth (PKCE)',
      'Session cookies; magic links single-use, 15-min TTL',
      'Always-on sentinel — isFlagOn always true',
    ],
    explanation:
      'Always-on auth surface: passwordless magic-link (Resend/SendGrid) + Google OAuth + session cookies. isFlagOn always returns true (sentinel). Sessions resolve userId/orgId in the auth middleware without rejecting unauthed requests — route guards decide access. Magic links are single-use, 15-min TTL; OAuth uses PKCE state in oauth_states.',
    smoke_test: [
      "Homepage → Sign in → enter email → 'check your inbox' state shows",
      'POST /api/auth/magic-link {email} → 200 + magic_links row created',
      'GET /api/auth/magic-link/verify?token=… → sets session cookie → redirects to /admin',
      'GET /api/auth/me with the cookie → returns {user, org}',
    ],
    e2e_tests: ['e2e/_fortress/auth/happy-path.spec.ts', 'e2e/_fortress/auth/adversarial.spec.ts'],
  },
  core_site_create: {
    checklist: [
      'Homepage funnel: search → select → sign in → details → build',
      'create-from-search seeds a site row + starts SITE_WORKFLOW',
      'Drives the golden path',
      'Always-on sentinel — isFlagOn always true',
    ],
    explanation:
      'Always-on homepage site-creation funnel: search business → select → sign in → provide details/upload → AI build workflow kicks off. isFlagOn always true (sentinel). Drives the golden path; the create-from-search endpoint seeds a site row + starts the SITE_WORKFLOW.',
    smoke_test: [
      'Homepage → search a business name → results render in <1s',
      'Select a result → sign-in gate → details form',
      'POST /api/sites/create-from-search → 200 + site row (status=draft) + workflow_jobs row',
      'Redirect to /waiting → real-time build progress',
    ],
    e2e_tests: [
      'e2e/_fortress/site-create/happy-path.spec.ts',
      'e2e/_fortress/site-create/adversarial.spec.ts',
    ],
  },
  core_admin_detail: {
    checklist: [
      'Admin split-view: sections nav + selected section',
      'Persistent bolt.diy iframe (one WebContainer cold-boot per session)',
      'SPA navigation — no full reload',
      'Always-on sentinel — isFlagOn always true',
    ],
    explanation:
      'Always-on admin site-detail split-view: left rail = sections nav, right = the selected section (sites, media, forms, editor, etc.). isFlagOn always true (sentinel). The persistent bolt.diy iframe lives in the admin shell so WebContainer cold-boot happens once per session.',
    smoke_test: [
      'Open /admin → app-root + sidebar render',
      'Project-select resolves a site → per-site sections load their real data',
      'Navigate sections via routerLink → no full reload (SPA sentinel holds)',
    ],
    e2e_tests: [
      'e2e/_fortress/admin-detail/happy-path.spec.ts',
      'e2e/_fortress/admin-detail/adversarial.spec.ts',
    ],
  },
  core_feature_flags: {
    checklist: [
      'Lists every registry flag with default state + stage',
      'Search + stage filter + per-flag detail (resolved state + docs + checklist)',
      'Override mutations: global / org / tenant',
      'Always-on sentinel — the control plane can’t be flagged off',
    ],
    explanation:
      "Always-on feature-flags admin UI at /admin/feature-flags: lists every registry flag with default state + stage, search + stage filter, per-flag detail (resolved state + docs + checklist), and override mutations (global/org/tenant). isFlagOn always true (sentinel) — the control plane can't be flagged off.",
    smoke_test: [
      'GET /api/feature-flags → returns the full registry with has_docs',
      "/admin/feature-flags → search 'auth' filters the list; stage pills filter by stage",
      'Click a flag → GET /api/feature-flags/:key → detail shows resolved state + docs (checklist/explanation/smoke_test/e2e_tests)',
      'POST /api/admin/feature-flags/:key/override → flips state; KV cache invalidates immediately',
    ],
    e2e_tests: [
      'e2e/_fortress/feature-flags/happy-path.spec.ts',
      'e2e/_fortress/feature-flags/adversarial.spec.ts',
    ],
  },
  core_billing: {
    checklist: [
      'Stripe Checkout + subscriptions + entitlements + billing portal',
      'Donation payouts',
      'Webhook-driven, idempotent',
      'Always-on sentinel — isFlagOn always true',
    ],
    explanation:
      'Always-on Stripe billing surface: checkout, subscriptions, entitlements, billing portal, and donation payouts. isFlagOn always true (sentinel). Webhook-first with idempotent processing; entitlements gate the per-site Features plane.',
    smoke_test: [
      'POST /api/billing/checkout → returns a Stripe Checkout session URL',
      'GET /api/billing/entitlements → plan entitlement set',
      'POST /webhooks/stripe with a valid signature → subscription state updates (duplicate event ignored)',
    ],
    e2e_tests: [
      'e2e/_fortress/billing/happy-path.spec.ts',
      'e2e/_fortress/billing/adversarial.spec.ts',
    ],
  },
};

export function getDocs(key: string): FlagDocs | undefined {
  return FLAG_DOCS[key];
}
