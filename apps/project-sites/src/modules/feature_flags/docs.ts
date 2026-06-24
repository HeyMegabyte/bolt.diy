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
  status_page_live: {
    checklist: [
      'Public status page backed by real uptime/incident data',
      'Subscriber alerts on incident open/resolve',
      'Extends the existing /status route shell',
      'Frontend-primary with a status-feed endpoint',
    ],
    explanation:
      'Public status page fed by real uptime + incident data rather than a static shell. Owners (and their visitors) see component health, open incidents, and a history feed; subscribers receive alerts when an incident opens or resolves. Builds on the existing /status route — when off, the route renders the static placeholder shell only.',
    smoke_test: [
      'GET /api/status/feed → {components[], incidents[], uptime_pct}',
      'Visit /status → live component health + incident history render',
      'Disable the flag → /status falls back to the static shell, the feed route 404s',
    ],
  },
  site_thumbnail_grid: {
    checklist: [
      'Real-browser thumbnail of every site in the admin catalog',
      'Captured via Cloudflare Browser-Rendering screenshot',
      'Cached in R2 and reused from the snapshot path',
      'Falls back to a placeholder tile when off',
    ],
    explanation:
      'Renders a real-browser screenshot thumbnail for each site in the /admin catalog grid, captured via the Browser-Rendering REST API and cached in R2 (reusing the snapshot-quality screenshot path, no duplicate render). Gives owners an at-a-glance visual catalog instead of a text list. When off, tiles show a neutral placeholder.',
    smoke_test: [
      'GET /api/sites/:id/thumbnail → 302/200 to the cached R2 screenshot',
      'Open /admin/sites → each card shows a live screenshot tile',
      'Disable the flag → cards render the placeholder tile, the thumbnail route 404s',
    ],
  },
  platform_mcp: {
    checklist: [
      'Account-level MCP server for Claude Code / Cursor / MCP clients',
      'Auth via a scoped psk_ API token',
      'Tools: list / inspect sites + build-status (deploy next)',
      'Tenant-scoped to the token’s org',
    ],
    explanation:
      'Account-level MCP server so external MCP clients (Claude Code, Cursor) connect with a scoped psk_ API token and manage their sites — list, inspect, and read build-status today, deploy next. Every tool call is bound to the token’s org (no cross-tenant access). When off, the MCP endpoints 404 so the surface’s existence isn’t leaked.',
    smoke_test: [
      'POST /api/mcp (initialize) with Authorization: Bearer psk_… → MCP handshake',
      'tools/list → list_sites, get_site, get_build_status',
      'Disable the flag → the MCP endpoint 404s',
    ],
  },
  mcp_oauth_provider: {
    checklist: [
      'OAuth 2.1 authorization server for MCP clients',
      'PKCE flow instead of pasting psk_ tokens',
      'Scoped, revocable access tokens bound to one org',
      'Standard /authorize + /token + metadata endpoints',
    ],
    explanation:
      'Turns the worker into an OAuth 2.1 authorization server so MCP clients (Claude Code) authenticate via the PKCE authorization-code flow instead of pasting a long-lived psk_ token. Issues scoped, revocable access tokens bound to a single org, with the standard discovery + /authorize + /token endpoints. When off, clients fall back to the psk_ paste flow and the OAuth endpoints 404.',
    smoke_test: [
      'GET /.well-known/oauth-authorization-server → metadata document',
      'GET /authorize?…&code_challenge=… → consent → code → POST /token → access token',
      'Disable the flag → the OAuth endpoints 404, psk_ paste-token auth still works',
    ],
  },
  prod_readiness_score: {
    checklist: [
      'Production Readiness Score (0-100 + letter grade) per site',
      'Checks: published, custom domain, performance, sitemap',
      'Surfaces a prioritized "what to fix before launch" list',
      'Read-only; recomputed on demand',
    ],
    explanation:
      'Computes a 0-100 Production Readiness Score plus a letter grade for each site by running launch checks — published state, custom domain attached, performance budget, sitemap presence — and surfaces a prioritized list of what to fix before going live. Read-only and site-scoped; recomputed on demand. When off, the route 404s.',
    smoke_test: [
      'GET /api/sites/:id/readiness → {score, grade, checks:[{id, pass, fix}]}',
      'Attach a custom domain → re-fetch → score rises, the domain check flips to pass',
      'Disable the flag → the readiness route 404s',
    ],
  },
  deploy_buttons: {
    checklist: [
      'One-click "Deploy to projectsites.dev" button snippets',
      '"Hosted on projectsites.dev" badge for READMEs / footers',
      'Copy-paste Markdown + HTML embed codes',
      'Viral growth loop — every embed links back',
    ],
    explanation:
      'Generates one-click "Deploy to projectsites.dev" button snippets and a "Hosted on projectsites.dev" badge for READMEs and site footers — a viral growth loop where every embed links back to the platform. Owners copy Markdown or HTML embed codes from the admin. When off, the snippet endpoint 404s and no badge renders.',
    smoke_test: [
      'GET /api/deploy-button?slug=demo → {markdown, html, svg_url}',
      'Paste the Markdown into a README → the badge renders and links to the deploy flow',
      'Disable the flag → the snippet route 404s',
    ],
  },
  visitor_dsar: {
    checklist: [
      'GDPR/CCPA data-subject-access endpoint',
      'Export OR soft-delete a visitor’s data by email or visitor_id',
      'Writes an audit-log entry for every request',
      'Site-owner scoped — only their own visitors',
    ],
    explanation:
      'GDPR/CCPA data-subject-access endpoint: a site owner exports or soft-deletes a visitor’s data by email or visitor_id, with an audit-log entry recorded for every request (the compliance receipt). Scoped to the owner’s own visitors — never another tenant’s. When off, the route 404s so the capability isn’t exposed.',
    smoke_test: [
      'POST /api/sites/:id/dsar {email} action=export → {visitor_events, contacts, submissions}',
      'POST /api/sites/:id/dsar {email} action=delete → soft-deletes + writes an audit entry',
      'Disable the flag → the DSAR route 404s',
    ],
  },
  onboarding_copilot: {
    checklist: [
      'PLG activation checklist for a new org',
      'Computes next-best actions (create → publish → custom domain)',
      'Per-step completion state + a dismiss control',
      'Drives time-to-first-published-site down',
    ],
    explanation:
      'Product-led-growth activation checklist that computes a new org’s next-best actions — create a site, publish it, add a custom domain — with per-step completion state and a dismiss control. Shortens time-to-first-published-site, the key activation metric. Read-only over existing org state. When off, the route 404s and no checklist renders.',
    smoke_test: [
      'GET /api/onboarding/checklist → {steps:[{id, done, cta_href}], dismissed}',
      'Publish a site → re-fetch → the publish step flips to done',
      'Disable the flag → the checklist route 404s',
    ],
  },
  audit_trail_export: {
    checklist: [
      'Org-scoped audit-log export for compliance reviews',
      'Filter by action and date range',
      'Download as JSON or CSV',
      'Read-only; never mutates the audit trail',
    ],
    explanation:
      'Lets org admins export the audit trail for compliance reviews — filter by action and date range, then download as JSON or CSV. Strictly read-only over the append-only audit_logs table and scoped to the caller’s org (no cross-tenant rows). When off, the export route 404s.',
    smoke_test: [
      'GET /api/audit/export?format=csv&action=site.publish&from=2026-01-01 → CSV attachment',
      'GET /api/audit/export?format=json → JSON array of audit rows for the org',
      'Disable the flag → the export route 404s',
    ],
  },
  model_registry: {
    checklist: [
      'OpenAI-compatible GET /v1/models catalog',
      'ProviderCapabilityRegistry + ModelAliasRegistry',
      'Aliases: deepseek / anthropic / openai / gemini / grok / workers-ai',
      'Per-provider availability gating (key present → listed)',
    ],
    explanation:
      'Serves an OpenAI-compatible GET /v1/models catalog backed by the ProviderCapabilityRegistry + ModelAliasRegistry — the deepseek / anthropic / openai / gemini / grok / workers-ai alias map with per-provider availability gating (a provider only lists its models when its key is configured). The catalog the AI router reads to resolve an alias to a concrete model. When off, /v1/models 404s.',
    smoke_test: [
      'GET /v1/models → {object:"list", data:[{id, owned_by, …}]} for configured providers only',
      'Unset a provider key → that provider’s models drop from the list',
      'Disable the flag → /v1/models 404s',
    ],
  },
  payments_rail: {
    checklist: [
      'Unified payments seam over Square (accept) + Stripe (SaaS/payouts)',
      'One idempotency key, one webhook verifier',
      'Single entitlement-grant path per rules/payments-routing',
      'Provider chosen by money-flow, not per-feature',
    ],
    explanation:
      'A unified payments seam that routes accept-money through Square Web Payments and SaaS billing / payouts through Stripe, behind one idempotency key, one webhook verifier, and a single entitlement-grant path (per rules/payments-routing). Features call the rail, not a provider directly, so the routing decision lives in one place. When off, the rail endpoints 404.',
    smoke_test: [
      'POST /api/payments/intent {amount_cents, purpose} → provider-routed intent + idempotency key',
      'Replay the same idempotency key → the same intent is returned, no double-charge',
      'Disable the flag → the rail routes 404',
    ],
  },
  storefront_ecommerce: {
    checklist: [
      'Lightweight native storefront for generated sites',
      'Products + variants in D1, assets in R2',
      'Checkout via Square Web Payments behind payments_rail',
      'Native (not MedusaJS) — no third-party storefront dep',
    ],
    explanation:
      'A lightweight native storefront for generated sites — products and variants in D1, media in R2, and checkout via Square Web Payments behind the payments_rail seam (no MedusaJS or third-party storefront dependency). Owners add products in the admin and a cart renders on the published site. When off, the storefront routes 404 and no cart renders.',
    smoke_test: [
      'POST /api/sites/:id/products {title, price_cents, variants} → product row',
      'Add to cart on the published site → checkout opens a Square payment via payments_rail',
      'Disable the flag → the storefront routes 404',
    ],
  },
  native_booking_engine: {
    checklist: [
      'First-class booking / availability engine',
      'Slots, holds, reminders + optional deposit via payments_rail',
      'Eliminates the third-party scheduler dependency',
      'Owner-managed availability rules',
    ],
    explanation:
      'A first-class booking and availability engine — bookable slots, short-lived holds, reminders, and an optional deposit charged through payments_rail — eliminating the third-party scheduler dependency. Owners define availability; visitors book on the published site. When off, the booking routes 404 and the booking UI is hidden.',
    smoke_test: [
      'GET /api/sites/:id/availability?date=… → open slots',
      'POST /api/sites/:id/bookings {slot} → hold created, reminder scheduled, deposit (if set) via payments_rail',
      'Disable the flag → the booking routes 404',
    ],
  },
  credit_wallet_rollover: {
    checklist: [
      'AI-credit wallet with monthly rollover',
      'Promo credit grants stack on top',
      'Expiring balances surface urgency in the billing wallet',
      'Read model over the credits ledger',
    ],
    explanation:
      'Extends the AI-credit wallet with rollover — unused monthly credits carry forward, promo grants stack, and expiring balances surface urgency in the billing wallet. Computed over the credits ledger; the wallet UI shows current, rolled-over, promo, and expiring buckets. When off, the wallet shows the flat monthly balance only and the rollover route 404s.',
    smoke_test: [
      'GET /api/billing/wallet → {balance, rolled_over, promo, expiring:[{amount, expires_at}]}',
      'Spend less than the monthly grant → next period’s wallet shows the carried-forward credits',
      'Disable the flag → the rollover fields drop, the route 404s',
    ],
  },
  referral_loop: {
    checklist: [
      'In-product refer-a-friend with tracked codes/links',
      'Attributed signups from a referral code',
      'Credit rewards granted through the wallet on conversion',
      'Per-org referral dashboard',
    ],
    explanation:
      'In-product refer-a-friend: each org gets tracked referral codes and links, signups are attributed to the referrer, and a credit reward is granted through the wallet (credit_wallet_rollover) on a referred conversion. A growth loop with an in-app referral dashboard. When off, the referral routes 404 and no code is issued.',
    smoke_test: [
      'GET /api/referrals/code → the org’s referral code + share link',
      'Sign up via ?ref=CODE then convert → the referrer’s wallet receives the reward credit',
      'Disable the flag → the referral routes 404',
    ],
  },
  ai_concierge_widget: {
    checklist: [
      'Visitor-facing per-site AI concierge',
      'Grounded in the site’s own content (RAG)',
      'Real tool-calls: book / quote / route',
      'Stateful agent, not a chatbot placeholder',
    ],
    explanation:
      'A visitor-facing per-site AI concierge grounded in the site’s own content with real tool-calls (book a slot, request a quote, route to the right page) — a stateful agent, not a scripted chatbot. Injected into the published site when enabled; answers come from the site’s indexed content. When off, the widget is not injected and the concierge route 404s.',
    smoke_test: [
      'POST /api/sites/:id/concierge {message:"do you take walk-ins?"} → grounded answer',
      'Ask to book → the concierge invokes the booking tool (native_booking_engine)',
      'Disable the flag → the widget is absent from the published HTML, the route 404s',
    ],
  },
  site_semantic_search: {
    checklist: [
      'Semantic search over a published site’s own content',
      'Backed by Vectorize / AutoRAG',
      'Re-indexed on content change',
      'Answers, not just keyword match',
    ],
    explanation:
      'Auto-installs semantic search over a published site’s own R2 content via Vectorize / AutoRAG, re-indexed on content change — returning answers rather than keyword matches. A search box on the published site queries the site’s vector index. When off, the search route 404s and no search box renders.',
    smoke_test: [
      'POST /api/sites/:id/search {query:"opening hours"} → ranked passages + an answer',
      'Edit the site content → re-index → the new content becomes searchable',
      'Disable the flag → the search route 404s',
    ],
  },
  edge_personalization: {
    checklist: [
      'No-PII edge swap of hero / sub / image / CTA / sticky-bar',
      'Signals: geo / device / referrer / time / return visit',
      'Sub-10ms Workers-AI decision',
      'A/B-eval looped to the winning variant',
    ],
    explanation:
      'No-PII edge personalization that swaps the hero headline, sub-headline, image, primary CTA, and sticky bar based on geo / device / referrer / time-of-day / return-visit signals via a sub-10ms Workers-AI call, with an A/B-eval loop that shifts traffic to the winning variant. Runs at the edge on serve. When off, the published site renders its default static hero.',
    smoke_test: [
      'Request a published site with different Referer / geo headers → the hero variant changes',
      'GET /api/sites/:id/personalization/report → per-variant conversion + the current winner',
      'Disable the flag → every visitor gets the default hero',
    ],
  },
  prompt_studio: {
    checklist: [
      'Admin surface over the existing prompt registry',
      'Versioned templates with A/B variants',
      'KV hot-patch without a redeploy',
      'One-click rollback for non-engineers',
    ],
    explanation:
      'An admin surface over the existing prompt registry: versioned templates with A/B variants, KV hot-patching that takes effect without a redeploy, and one-click rollback so non-engineers can tune prompts safely. Reads and writes the same registry the build pipeline consumes. When off, the studio routes 404 and prompts are edited in code only.',
    smoke_test: [
      'GET /api/admin/prompts → versioned templates with active variant',
      'Hot-patch a template via the studio → the next generation uses it with no redeploy; rollback restores the prior version',
      'Disable the flag → the studio routes 404',
    ],
  },
  ai_gateway_guardrails: {
    checklist: [
      'Llama Guard middleware on /ai/* routes',
      'Blocks prompt-injection / hate / off-brand input + output',
      'Runs before publish',
      'No-redeploy killswitch',
    ],
    explanation:
      'Mounts Llama Guard middleware on the /ai/* routes, blocking prompt-injection, hateful, and off-brand input AND output before it reaches publish, with a no-redeploy killswitch (per rules/ai-agent-security). Every block is logged. When off, the guard is bypassed (the killswitch state) and requests pass through to the model directly.',
    smoke_test: [
      'POST an /ai/* route with an injection payload ("ignore previous instructions…") → blocked, logged',
      'POST a benign prompt → passes through to the model',
      'Flip the killswitch → the guard disables instantly with no redeploy',
    ],
  },
  visual_point_edit: {
    checklist: [
      'Click any live-preview element to edit it',
      'AI mutates only that node (copy / style / layout)',
      'No full-site regeneration',
      'Backed by a scoped edit endpoint',
    ],
    explanation:
      'Click any element in the live preview and have AI mutate only that node — its copy, style, or layout — without a full-site regeneration. Frontend-primary, backed by a scoped server edit endpoint that patches just the targeted node. When off, the point-edit affordance is hidden and the scoped edit route 404s.',
    smoke_test: [
      'Click a heading in the preview → request "make this shorter and bold" → only that node changes',
      'POST /api/sites/:id/edit-node {selector, instruction} → a scoped patch, not a regeneration',
      'Disable the flag → the point-edit UI is hidden, the route 404s',
    ],
  },
  wireframe_planning: {
    checklist: [
      'Pre-generation sitemap + page-level wireframe plan',
      'Surfaced as an approval gate in /create',
      'Catches IA problems before section generation',
      'Owner edits the plan before building',
    ],
    explanation:
      'Surfaces a sitemap plus page-level wireframe plan as an approval gate in /create BEFORE section generation, so information-architecture problems are caught up front instead of after a full build. The owner reviews and edits the plan, then approves to generate. When off, /create generates directly without the planning gate.',
    smoke_test: [
      'Start a build in /create → the sitemap + wireframe plan renders for approval',
      'Edit the plan and approve → generation follows the approved structure',
      'Disable the flag → /create skips the planning gate and generates directly',
    ],
  },
  url_clone_seed: {
    checklist: [
      'Paste a URL to seed the builder from it',
      'Browser-Rendering extracts layout + copy + structured data',
      'Prefills a new site as an acquisition fast-start',
      'A starting point, not a literal copy',
    ],
    explanation:
      'Paste a URL and seed the builder from it: Browser-Rendering extracts the layout, copy, and structured-data JSON to prefill a new site — an acquisition fast-start that turns an existing site into a starting point (improved, not literally copied). When off, the seed route 404s and /create starts blank.',
    smoke_test: [
      'POST /api/clone-seed {url} → {layout, copy, structured_data} prefill payload',
      'Start /create with the seed → sections prefill from the source, ready to improve',
      'Disable the flag → the seed route 404s',
    ],
  },
  cmdk_ai_actions: {
    checklist: [
      'AI actions layer on the existing Cmd+K palette',
      'Natural language → navigation, bulk mutations, or agent tasks',
      'Palette + focus gate already ship',
      'Resolve endpoint maps NL to a typed action',
    ],
    explanation:
      'Adds an AI actions layer to the existing Cmd+K palette: natural language routes to navigation, bulk mutations, or agent tasks (the palette and its focus gate already ship). A resolve endpoint maps the typed phrase to a structured action the UI executes. When off, Cmd+K stays a plain navigation palette and the resolve route 404s.',
    smoke_test: [
      'Open Cmd+K, type "publish all draft sites" → POST /api/cmdk/resolve → a typed bulk action',
      'Type "go to billing" → resolves to a navigation action',
      'Disable the flag → Cmd+K is navigation-only, the resolve route 404s',
    ],
  },
  aeo_pass: {
    checklist: [
      'Answer-Engine-Optimization audit on every publish',
      'Structured-data tuning for AI-citation',
      'Targets ChatGPT / Perplexity / AI-Overviews',
      'Extends seo_autopilot',
    ],
    explanation:
      'Runs an Answer-Engine-Optimization audit plus structured-data tuning on every publish, targeting citation in ChatGPT / Perplexity / Google AI-Overviews (quotable answer blocks, FAQPage schema, EEAT signals) — extending the existing seo_autopilot pass. Reports per-page AEO gaps. When off, the AEO step is skipped and the route 404s.',
    smoke_test: [
      'Publish a site → the AEO pass runs and writes per-page audit results',
      'GET /api/sites/:id/aeo → {score, gaps:[{page, issue, fix}]}',
      'Disable the flag → the AEO step is skipped, the route 404s',
    ],
  },
  ai_payment_command: {
    checklist: [
      'POST /api/ai-actions/payment-command — NL→intent payment policy engine',
      'Refuses raw card numbers and last4-only references',
      'Live charge requires an intent-bound confirmation token',
      'Charges only saved-PM refs via the constrained Stripe tool layer',
      'dry-run by default (preview + token, never charges)',
      'Tenant bound to the authed session org (client tenant_id ignored)',
    ],
    explanation:
      'Safety-gated AI payment-command endpoint. Parses a natural-language payment instruction into a typed intent, then runs a policy engine that refuses raw card numbers (Luhn + digit-run detection) and last4-only references, requires a positive integer-cent amount + a saved payment-method ref, and demands an intent-bound confirmation token (cnf_…hash) before any live charge — so a $5 preview can’t be swapped to a $5000 charge. dry-run is the default (returns a preview + token, never charges); a live charge runs only through the constrained Stripe tool layer (create+confirm / refund / get_status) with a mandatory idempotency key. The tenant is bound to the authed session org; a client-supplied tenant_id is ignored. Disabled by default → the route 404s.',
    smoke_test: [
      'POST /api/ai-actions/payment-command {command:"charge the customer $20 on their saved card", dry_run:true} → 200 preview + confirmation_token, executed:false',
      'Repeat with a raw 16-digit card number in the command → 400 raw_card_forbidden',
      'POST with dry_run:false and the matching confirmation_token → 200 charged (idempotency_key present)',
      'Disable the flag → the endpoint 404s',
    ],
  },
  lead_scanner: {
    checklist: [
      'POST /api/admin/leads/scan — Google Places text-search → scored leads',
      'Keeps the no-website businesses (the scanner’s purpose)',
      'Persists each as a claim-able lead via createLead (place_id-deduped)',
      'Returns a scan summary (scanned / created / skipped / errors)',
      'Outreach send is a separate, explicitly-enabled step — never auto-sends',
    ],
    explanation:
      'Super-Admin lead scanner. A free-text Google Places query (e.g. "roofers newark nj") runs a text search, each result is scored (no-website detection, rating/review signals, priority), and the no-website businesses are persisted as claim-able leads via createLead — deduped by place_id within the batch and by a unique index across batches. Returns a tally summary. Read-and-create only: it never sends outreach (that is a separate, explicitly-enabled action). Disabled by default → the route 404s (never 403). Compliant email enrichment is NOT done here (Places emails are not used).',
    smoke_test: [
      'POST /api/admin/leads/scan {query:"plumbers austin tx"} → 200 {summary:{scanned, created, skippedHasWebsite, skippedDuplicate, errors}}',
      'Re-run the same query → created stays flat (place_id dedupe), no duplicate leads',
      'POST with a 1-char query → 400 VALIDATION_ERROR',
      'Disable the flag → the route 404s',
    ],
  },
  observability_gateway: {
    checklist: [
      'POST /monitoring/:provider — customer sites forward Sentry/PostHog events',
      'Raw vendor keys never ship to the browser (worker-side forward only)',
      'Every event tenant-tagged + PII-redacted + sampled + quota-capped',
      'Rollup datapoints → Analytics Engine keyed by {orgId, siteId, provider}',
      'Fail-soft: vendor 5xx → customer site still gets 202 (event dropped, never errored)',
    ],
    explanation:
      'Customer-site observability gateway. Customer sites POST their Sentry/PostHog events to POST /monitoring/:provider so raw vendor ingest keys never appear in the customer browser bundle. The worker tenant-tags, PII-redacts (best-effort regex sweep), samples, and quota-caps each event before forwarding server-side to the vendor; rollups are written to Analytics Engine keyed by org/site/provider. Disabled by default → the route 404s (never 403). Registered (fire-3) to satisfy the feature-drift + docs guards for the concurrently-built libs/features/observability_gateway module.',
    smoke_test: [
      'POST /monitoring/posthog {batch:[...]} → 202 (forwarded server-side)',
      'Inspect forwarded payload → no raw vendor key in the response, PII fields redacted',
      'Exceed the per-site quota → events past the cap are dropped (still 202)',
      'Disable the flag → the route 404s',
    ],
  },
  generative_ui_stream: {
    checklist: [
      'POST /api/copilot/ui — Workers AI returns schema-bound UI descriptors',
      'Every LLM output Zod-validated before return (invalid → rejected, never rendered)',
      'Off by default → the route 404s (never 403)',
      'Sentry + structured logs on every generation; no persistent state',
    ],
    explanation:
      'Generative UI Stream composes copilot-driven interfaces dynamically: POST /api/copilot/ui calls Workers AI to produce schema-bound UI descriptors, which are Zod-validated before reaching the client so a malformed LLM output can never render. Disabled by default → the route 404s. Registered to satisfy the feature-drift + docs guards for the concurrently-built libs/features/generative_ui_stream module.',
    smoke_test: [
      'POST /api/copilot/ui {prompt:"..."} → 200 with a Zod-valid UI descriptor',
      'Force an invalid LLM output (mock) → request rejected, nothing rendered',
      'Disable the flag → the route 404s',
    ],
  },
  page_audio_summary: {
    checklist: [
      'POST /api/audio-summary/:siteId — generate a per-route TTS summary',
      'GET /api/audio-summary/:siteId — fetch the stored MP3 for playback',
      'MP3 persisted to R2 under audio-summary/{siteId}/',
      'Fail-soft when no TTS provider is configured; off by default → 404',
    ],
    explanation:
      'Page Audio Summary generates per-route text-to-speech summaries via the media service and stores the MP3s in R2 (audio-summary/{siteId}/) for visitor playback. Requires a TTS provider (ElevenLabs or OpenAI); when unconfigured it degrades gracefully rather than erroring. Disabled by default → the routes 404. Registered to satisfy the feature-drift + docs guards for the concurrently-built libs/features/page_audio_summary module.',
    smoke_test: [
      'POST /api/audio-summary/:siteId → 200, MP3 written to R2',
      'GET /api/audio-summary/:siteId → 200 audio/mpeg stream',
      'Unset the TTS provider → graceful failure, no 5xx',
      'Disable the flag → the routes 404',
    ],
  },
  figma_import: {
    checklist: [
      'POST /api/figma/import — pull design tokens + component metadata from a Figma file',
      'Caller supplies a Figma personal-access token (no shared vault yet)',
      'Imported tokens flow into the generated site (no manual copy-paste)',
      'Off by default → the route 404s; Sentry + logs on import',
    ],
    explanation:
      'Figma Import pulls design tokens and component metadata from a Figma file via the Figma REST API (POST /api/figma/import), letting designers push brand tokens into a generated site without manual copy-paste. The caller supplies a Figma PAT (enable per-user in dev until a token-vault UX exists). Figma rate-limits at 100 req/min, so heavy imports may hit the cap. Disabled by default → the route 404s. Registered to satisfy the feature-drift + docs guards for the concurrently-built libs/features/figma_import module.',
    smoke_test: [
      'POST /api/figma/import {fileKey, token} → 200 with extracted tokens',
      'Invalid/expired token → 4xx with a clear message (no crash)',
      'Disable the flag → the route 404s',
    ],
  },
  vectorize_search: {
    checklist: [
      'GET /api/sites/:id/search?q=... — semantic search over published site content',
      'Site files indexed asynchronously via waitUntil on every POST /api/publish/bolt',
      'Site files also indexed in the site-generation Workflow after validate-build step',
      'Requires RAG_INDEX (Vectorize, 768-dim cosine) + AI bindings; silently skips when absent',
      'Server returns 404 (never 403) when flag is off',
    ],
    explanation:
      'Enables semantic search over published site content via Cloudflare Vectorize (GET /api/sites/:id/search?q=...). Text and HTML files are indexed asynchronously on every publish via waitUntil so the response is never blocked, and again inside the site-generation Workflow after the validate-build step. Embeddings are computed via Workers AI bge-base-en-v1.5 (768-dim). Requires the RAG_INDEX Vectorize binding; silently skips indexing when the binding is absent. Server returns 404 (never 403) when disabled. Empty or invalid queries return {results:[]} with a 200. Failure mode: missing binding causes silent no-op; search returns empty results rather than erroring.',
    smoke_test: [
      'Enable flag → GET /api/sites/:id/search?q=about → 200 {results:[{score,text,...}]} (after publishing)',
      'GET /api/sites/:id/search?q= (empty) → 200 {results:[]}',
      'Disable the flag → GET /api/sites/:id/search?q=test → 404',
    ],
  },
};

export function getDocs(key: string): FlagDocs | undefined {
  return FLAG_DOCS[key];
}
