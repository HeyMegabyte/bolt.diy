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
  upgrade_moments: {
    checklist: [
      'Contextual upgrade prompts at each free-plan friction point',
      'Six triggers: custom_domain / remove_branding / more_pages / ai_credits / priority_build / analytics_pro',
      'Trigger-attributed CTA (/admin/billing?upsell=<trigger>) for funnel tracking',
      'Paid plans never nagged (eligible:false); dismissals persist 90d in KV',
    ],
    explanation:
      'Contextual upsell engine — maps a free-plan friction point to an honest, value-led, trigger-attributed upgrade prompt. The generous-free + paid-power-ups monetization seam for solo owners. Paid plans resolve eligible:false (never nag payers); dismissals persist in CACHE_KV (90-day TTL). Pure catalog + eligibility core.',
    smoke_test: [
      'GET /api/upgrade-moments/custom_domain?plan=free → eligible:true + headline/benefits/cta_url',
      'GET /api/upgrade-moments/custom_domain?plan=pro → eligible:false (payer not nagged)',
      'GET /api/upgrade-moments?plan=free → list of eligible, non-dismissed moments',
      'POST /api/upgrade-moments/custom_domain/dismiss → {dismissed:true}; re-GET list excludes it',
    ],
  },
  better_auth: {
    checklist: [
      'CUTOVER flag for the embedded Better Auth rebuild (auth/better-auth.ts)',
      'ON → Better Auth owns /api/auth/* (email+password, magic link, Google, TOTP)',
      'OFF (default) → legacy magic-link/Google/D1-session auth unchanged',
      'MUST stay OFF in prod until the sign-in UI + user-migration backfill land',
    ],
    explanation:
      'Cutover flag for the embedded Better Auth rebuild. When ON, Better Auth owns /api/auth/* and issues its own D1 sessions; when OFF (default) /api/auth/* falls through to the legacy auth. Flipping early would route live sign-in at an unmigrated system — keep OFF in production until the frontend sign-in UI + user-migration backfill ship.',
    smoke_test: [
      'Flag OFF (prod default): existing magic-link + Google sign-in unchanged',
      'Flag ON in a test env: POST /api/auth/sign-up/email creates a user + session',
      'Flag ON: POST /api/auth/sign-in/email returns a Better Auth D1 session',
      'Flip OFF again: legacy auth resumes with no migration needed',
    ],
  },
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
  turnstile_build_gate: {
    checklist: [
      'OFF by default — create-from-search behaves exactly as before',
      'When ON + TURNSTILE_SECRET_KEY set: missing/invalid token → 403 TURNSTILE_REQUIRED before any build',
      'When ON but secret unset: soft-allows (not_configured) so a premature flip never breaks create',
      'Flag-check failure fails open (gate stays off) — never blocks the funnel',
    ],
    explanation:
      'Dark-launched bot-gate (#32) on POST /api/sites/create-from-search: when ON, a valid Cloudflare Turnstile token is required before a $5-15 build is kicked, stopping bots/abuse. Default OFF; flip to beta only after the frontend Turnstile widget ships the token and TURNSTILE_SECRET_KEY is set. Soft-allows on not_configured + fails open on a flag-check error so it can never break the live create funnel.',
    smoke_test: [
      'With flag OFF: create a site from search → builds normally (no challenge)',
      'Flip flag ON (secret set) + POST create-from-search without a token → 403 TURNSTILE_REQUIRED',
      'Flip flag ON with secret UNSET → create still works (soft-allow)',
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
  collab_editing: {
    checklist: [
      'GET /api/sites/:id/collab — WebSocket upgrade gateway to CollabRoomDO (PartyServer + Yjs)',
      'One DO instance per site (keyed site:<id>); Yjs CRDT syncs document updates to all clients',
      'Angular CollabService connects with a vanilla PartySocket + Y.Doc',
      'Requires the COLLAB_ROOM Durable Object binding — ships INERT (wrangler.toml block commented)',
      'Server returns 404 (never 403) when flag is off; 503 when COLLAB_ROOM binding is absent; 426 on non-WS request',
    ],
    explanation:
      'Enables real-time collaborative editing of a site via a Yjs CRDT synced over a PartyServer Durable Object WebSocket (GET /api/sites/:id/collab). A CollabRoomDO (extends y-partyserver YServer = PartyServer + Yjs) instance per site fans document updates to every connected client. The route guards: auth (401) → requireOwnedSite (404) → collab_editing flag (404 when off) → COLLAB_ROOM binding (503 when absent) → WebSocket upgrade (426 otherwise) → forward to the DO. Ships INERT: the wrangler.toml binding + migration are commented because activating a NEW Durable Object class is a watched one-way-door deploy (a wrong migration tag blocks ALL deploys). Disabled failure mode: the editor stays single-player, nothing else breaks.',
    smoke_test: [
      'Enable flag + bind COLLAB_ROOM → wscat -c wss://host/api/sites/:id/collab → 101 Switching Protocols',
      'Two clients on the same site → a Y.Doc edit on client A appears on client B',
      'Disable the flag → GET /api/sites/:id/collab → 404; binding absent → 503; plain HTTP GET → 426',
    ],
    e2e_tests: ['e2e/collab.spec.ts'],
  },
  social_publishing: {
    checklist: [
      'KILL-SWITCH (defaults ENABLED) for Pulse Social publishing',
      'Gates POST /api/social/posts/:id/schedule + /publish-now (SocialPublishWorkflow dispatch)',
      'Off → 503 FEATURE_DISABLED; composing/drafting unaffected',
      'Flip the global override off to halt all publishing without a redeploy',
    ],
    explanation:
      'Operator kill-switch for Pulse Social post publishing. Defaults ENABLED (rollout 100, stable) so live behavior is unchanged; the flag exists so an operator can instantly DISABLE the two publish-dispatch endpoints (schedule + publish-now) — e.g. a publisher is mis-posting or a platform API is down — by flipping the global override off, with no redeploy. When off the endpoints return 503 FEATURE_DISABLED (a known feature being halted — clearer than a 404). Drafting/composing still works.',
    smoke_test: [
      'Flag on (default) → POST /api/social/posts/:id/publish-now → 200, workflow runs',
      'Set global override enabled=false → same call → 503 FEATURE_DISABLED',
      'Re-enable → 200 again (no redeploy)',
    ],
  },
  social_autopilot: {
    checklist: [
      'KILL-SWITCH (defaults ENABLED) for Pulse Social Auto-Pilot AI cron',
      'Gates POST /api/social/auto-pilot/run-now',
      'Off → 503 FEATURE_DISABLED; manual compose + read-only preview unaffected',
      'Flip the global override off to halt autonomous AI posting without a redeploy',
    ],
    explanation:
      'Operator kill-switch for Pulse Social Auto-Pilot (the AI cron generating + scheduling drafts per network). Defaults ENABLED (rollout 100, stable). An operator flips the global override off to instantly halt all autonomous posting — e.g. the AI is generating off-brand content — with no redeploy. When off, run-now returns 503 FEATURE_DISABLED; manual compose/schedule and the read-only preview are unaffected.',
    smoke_test: [
      'Flag on (default) → POST /api/social/auto-pilot/run-now → 200 (or 409 if no networks)',
      'Set global override enabled=false → same call → 503 FEATURE_DISABLED',
      'Re-enable → 200 again',
    ],
  },
  site_tags: {
    checklist: [
      '22-color label pills per site',
      'Org-scoped, reusable across sites',
      'D1-backed site_tag_assignments',
      'Filterable in site list',
    ],
    explanation:
      'Per-site colored label pills with custom names, colors (22 hues), and optional emoji icons. Tags are org-scoped — defined once, assigned to many sites. CRUD at /api/site-tags and /api/sites/:id/tags. Designed for the admin site list filter picker.',
    smoke_test: [
      'Enable flag → POST /api/site-tags {"name":"Production","color":"green"} → 201',
      'PUT /api/sites/:id/tags {"tagIds":["<id>"]} → 200 with tag list',
      'GET /api/site-tags → returns tag with site_count',
    ],
  },
  system_status: {
    checklist: [
      '9 integration health targets',
      '5s timeout per probe',
      'Parallel aggregation via Promise.all',
      'Returns overall + per-integration status',
    ],
    explanation:
      'Aggregated health checks for all platform integrations (Listmonk, Lago, Nango, LiteLLM, Plane, Twenty, Payload, Unkey, Chatwoot). Each probe runs independently with a 5-second timeout. Results are never cached — real-time status strip for the admin top bar.',
    smoke_test: [
      'Enable flag → GET /api/system/status → 200 with overall+integrations array',
      'Each integration has status (healthy/degraded/down/unknown) + latencyMs',
      'Overall is "healthy" when all probes pass',
    ],
  },
  activity_feed: {
    checklist: [
      'Unified org event timeline',
      '14 event kinds from audit_logs',
      'Cursor-based pagination',
      'Actor name extraction from metadata',
    ],
    explanation:
      'Unified org-scoped timeline of recent platform events — builds, publishes, deploys, domain changes, billing events, and member changes. Aggregated from the audit_logs table with cursor-based pagination (newest-first). Designed for the admin dashboard live-activity widget.',
    smoke_test: [
      'Enable flag → GET /api/activity → 200 with data[] + cursor + hasMore',
      'Each entry has kind, summary, actorName, targetType, timestamp',
      'Pass ?cursor=<ts> to paginate',
    ],
  },
  mru_cards: {
    checklist: [
      'Most-recently-active sites per org',
      'JOIN audit_logs + sites with GROUP BY',
      'Returns site name, slug, last action, timestamp',
      'Configurable limit (1-20)',
    ],
    explanation:
      '"Continue where you left off" — returns the N most recently active sites for the current org, ordered by last audit_log entry. Each card shows site name, slug, last action performed, and a timestamp. Drives the dashboard quick-jump widget.',
    smoke_test: [
      'Enable flag → GET /api/mru → 200 with data[] of site cards',
      'Pass ?limit=10 to return up to 10 cards',
      'Cards ordered by last activity descending',
    ],
  },
  usage_gauges: {
    checklist: [
      '4 metrics: sites, builds, media_gb, bandwidth_gb',
      'Live D1 aggregation',
      'Pct-of-free-tier-limit per metric',
      'SVG gauge-ring ready output',
    ],
    explanation:
      'Per-org usage metrics computed from live D1 queries — site count, build count, estimated media storage, and bandwidth. Each metric includes the used value, the free-tier limit, and a computed percentage (capped at 100). Designed to feed SVG gauge-ring components in the admin dashboard.',
    smoke_test: [
      'Enable flag → GET /api/usage → 200 with data[] of 4 gauges',
      'Each gauge has metric, label, used, limit, unit, pct',
      'Pct is capped at 100',
    ],
  },
  notification_badge: {
    checklist: [
      'Unread alert count + failed build count per org',
      '2 parallel D1 queries (audit_logs 7d + workflow_jobs)',
      'Returns {total, alerts, builds} for nav badge rendering',
    ],
    explanation:
      'Computes notification badge counts for the admin nav. Queries audit_logs for failed actions in the last 7 days and workflow_jobs for current failed builds. Returns a simple {total, alerts, builds} breakdown suitable for a red badge pill.',
    smoke_test: [
      'Enable flag → GET /api/notifications/badge → 200 with {total, alerts, builds}',
      'Clean org returns all zeros',
    ],
  },
  analytics_annotations: {
    checklist: [
      'CRUD for chart annotations tied to analytics dates',
      '4 categories: deploy/marketing/incident/other',
      'Org-ownership validated on create',
      'List by site, delete by annotation id',
    ],
    explanation:
      'Lightweight annotation system for analytics charts. Attach dated notes to sites to explain traffic spikes (marketing campaign), drops (incident), or changes (deploy). Annotations are site-scoped and org-ownership is validated on create. Soft-delete keeps audit trail.',
    smoke_test: [
      'POST /api/sites/:id/annotations with date/note/category → 201',
      'GET /api/sites/:id/annotations → returns list sorted by date desc',
      'DELETE /api/annotations/:id → 204',
    ],
  },
  cmd_k_actions: {
    checklist: [
      'NL query to ranked admin action suggestions',
      '6 verbs: rebuild/snapshot/delete/view/edit/publish',
      'Slug/name substring scoring with prefix bonus',
      'Returns top 20 matches for command palette',
    ],
    explanation:
      'Natural language to admin action matching for the Cmd+K command palette. Queries the org sites and scores each against 6 action verbs using slug and name substring matching. Short queries return default navigation suggestions (Sites, Billing). Results are ranked by match score and capped at 20.',
    smoke_test: [
      'Enable flag -> POST /api/cmdk {"q":"rebuild njsk"} -> 200 with scored suggestions',
      'Empty query returns defaults',
      'No matches returns empty array',
    ],
  },
  site_health_sparklines: {
    checklist: [
      '7-day traffic trend per site from analytics_daily',
      'Configurable day range (1-30, default 7)',
      'Returns {siteId, days: [{date, visits}]} for SVG sparkline',
    ],
    explanation:
      'Queries the analytics_daily rollup for per-day visit counts over a configurable window. Designed to feed SVG sparkline charts in the admin site list — a compact visual indicator of traffic health without loading a full analytics dashboard.',
    smoke_test: [
      'Enable flag → GET /api/sites/:siteId/sparkline?days=7 → 200 with days[] array',
      'No data → days: []',
      'Pass days=30 for monthly view',
    ],
  },
  batch_operations: {
    checklist: [
      'Bulk rebuild/snapshot/delete for 1-50 sites',
      'Per-site org-ownership validation',
      'Per-site ok/fail result with message',
      'Returns summary: total/ok/failed counts',
    ],
    explanation:
      'Batch processor for site-level actions — rebuild (queues build workflow_job), snapshot (queues snapshot workflow_job), or delete (soft-deletes site). Each site ID is validated for org ownership before the action. Results are per-site with a summary block for quick status checks.',
    smoke_test: [
      'Enable flag → POST /api/batch {"siteIds":["id1","id2"],"action":"rebuild"} → 200 with per-site results',
      'Unowned site → ok:false, message:"not_found_or_not_owned"',
      'Invalid action → 400 Zod validation error',
    ],
  },
  site_comparison: {
    checklist: [
      'Side-by-side diff of any two org-owned sites',
      'Compares pages/builds/domains/status/last-build/updated',
      'Highlights differences with null = identical',
    ],
    explanation:
      'Compares two sites side-by-side across 6 dimensions: page count, build count, active domains, status, last build date, and last updated date. Each dimension returns values for both sites plus a diff indicator. Useful for auditing or understanding what changed between two sites.',
    smoke_test: [
      'Enable flag → POST /api/sites/compare {"siteIdA":"<id1>","siteIdB":"<id2>"} → 200 with rows[] diff',
      'Same site → all diffs null',
      'Missing site → 404',
    ],
  },
  site_clone: {
    checklist: [
      'One-click site copy to new slug within same org',
      'Copies all pages (title/path/content/meta) to new site',
      'Validates slug uniqueness + source existence',
      'Returns new site id + pagesCopied count',
    ],
    explanation:
      'Creates a clone of an existing site under a new slug and name. Copies all non-deleted pages with their content and metadata. The new site starts in draft status. The source site is unchanged. Slug must be unique within the org.',
    smoke_test: [
      'Enable flag → POST /api/sites/clone {"sourceSiteId":"<id>","targetSlug":"my-clone","targetName":"My Clone"} → 201',
      'Duplicate slug → 409',
      'Missing source → 404',
    ],
  },
  nl_analytics: {
    checklist: [
      '7 NL patterns recognized (sites/builds/activity/members/status)',
      'Stateless regex→SQL parser — zero AI cost',
      'Returns generated SQL + explanation + results',
    ],
    explanation:
      'Natural-language analytics intent parser. Maps common questions ("how many sites?", "builds this month", "most active site") to parameterized D1 SQL queries with human-readable explanations. Stateless and free — no AI call needed. Designed to be progressively enhanced with Workers AI for fuzzy matching.',
    smoke_test: [
      'Enable flag → POST /api/analytics/query {"question":"how many sites"} → 200 with sql+explanation+results',
      'Try "builds this month", "most active site", "sites by status" — each returns different SQL',
      'Unrecognized question returns hint with supported patterns',
    ],
  },
  onboarding_progress: {
    checklist: [
      '5-step org setup tracker: site/build/domain/billing/team',
      '5 parallel D1 COUNT queries',
      'Returns pct complete + per-step detail',
    ],
    explanation:
      'Tracks org onboarding completion across 5 gates: site created, first build run, custom domain added, billing subscription active, and team member invited. Each step queries D1 for live counts. Returns percentage + per-step boolean completion status. Drives the admin dashboard progress ring widget.',
    smoke_test: [
      'Enable flag → GET /api/onboarding → 200 with steps[], completed, total, pct',
      'Fresh org returns pct=0',
      'Fully onboarded org returns pct=100',
    ],
  },
  log_explorer: {
    checklist: [
      'Worker tail-log search with free-text + level filtering',
      'Cost-by-route breakdown surfaces the expensive endpoints',
      'Explorer tab inside /admin/logs, gated via app-flag-gate-notice',
      'Read-only over the existing log pipeline — no new write path',
    ],
    explanation:
      'Log Explorer — searchable Worker tail logs with a cost-by-route breakdown inside /admin/logs. Turns raw structured log lines into an operator surface: filter by route, level, and free text, then rank routes by estimated request cost to spot the endpoints burning the budget. Read-only over the existing log pipeline; the flag only gates the Explorer tab, so disabling hides the UI without touching ingestion.',
    smoke_test: [
      'GET /api/feature-flags/log_explorer → enabled:true (stable, 100%)',
      'UI: /admin/logs → Explorer tab renders search + results (no flag-gate notice)',
      'Search a known route (e.g. /api/health) → matching tail lines + cost-by-route table',
      'Flag off → the Explorer tab shows the flag-gate notice instead',
    ],
    e2e_tests: ['e2e/logs/logs-explorer.spec.ts'],
  },
  domain_stack_wizard: {
    checklist: [
      '7-tile progress board: DNS → SSL → email auth (SPF/DKIM/DMARC) → GSC',
      'Per-tile live status with plain-English fix instructions',
      'Lives at /admin/domains/:id/stack, gated via app-flag-gate-notice',
      'Stack API routes 404 when the flag is off — existence never leaks',
    ],
    explanation:
      'Domain Stack Wizard — a 7-tile progress board that walks a custom domain from raw registration to fully-armed production: DNS pointing, SSL issuance, SPF/DKIM/DMARC email auth, and Google Search Console verification. Each tile reports its live status and translates failures into plain-English next steps, replacing the "why is my domain broken" support loop with self-serve diagnosis at /admin/domains/:id/stack.',
    smoke_test: [
      'GET /api/feature-flags/domain_stack_wizard → enabled:true (stable, 100%)',
      'UI: /admin/domains/:id/stack → 7 tiles render with per-step status',
      'Flag off → POST /api/domains/:hostname/stack returns 404 (never 403)',
    ],
    e2e_tests: ['e2e/domain-stack/domain-stack.spec.ts'],
  },
  multimodal_copilot: {
    checklist: [
      'Per-site AI copilot console at /admin/sites/:id/copilot',
      'Intent-distribution breakdown over captured visitor questions',
      'Session list with per-conversation drill-in',
      'Visitor widget ships as a standalone JS bundle on generated sites',
    ],
    explanation:
      'Multimodal AI Site Copilot — the per-site copilot console at /admin/sites/:id/copilot. Owners see what visitors actually ask their site: an intent-distribution breakdown over captured copilot conversations plus a session list with drill-in. The visitor-facing widget ships as a standalone JS bundle on generated sites; this flag gates the admin console that reads those sessions, so disabling hides the console without breaking the widget.',
    smoke_test: [
      'GET /api/feature-flags/multimodal_copilot → enabled:true (stable, 100%)',
      'UI: /admin/sites/:id/copilot → intent distribution + sessions render (no flag-gate notice)',
      'Copilot widget JS bundle still serves on a published site regardless of the admin flag',
    ],
    e2e_tests: ['e2e/copilot/copilot.spec.ts'],
  },
  section_marketplace: {
    checklist: [
      'Browsable catalog of installable site sections (hero, FAQ, pricing, …)',
      'Industry filter tailors the catalog (?industry=nonprofit etc.)',
      'Gates the section picker in the editor surface',
      'GET /api/section-marketplace returns 404 when the flag is off',
    ],
    explanation:
      'Section Marketplace — a browsable catalog of installable site sections (hero, FAQ, pricing, testimonials, …) behind the section picker. Owners browse by industry and install a proven section into their site instead of prompting one from scratch; catalog rows carry preview metadata so the picker renders real thumbnails. The flag gates both the picker UI and GET /api/section-marketplace, which returns 404 (never 403) when off.',
    smoke_test: [
      'GET /api/feature-flags/section_marketplace → enabled:true (stable, 100%)',
      'GET /api/section-marketplace?industry=nonprofit → section list for the industry',
      'Flag off → GET /api/section-marketplace 404s and the picker hides',
    ],
    e2e_tests: ['e2e/marketplace/marketplace.spec.ts'],
  },
  site_dna_taste_graph: {
    checklist: [
      'Per-site taste-signal console at /admin/sites/:id/dna',
      'Feedback history timeline of owner reactions to generated output',
      'Preference bars aggregate signals into a durable taste profile',
      "Profile steers future AI edits toward the owner's taste",
    ],
    explanation:
      "Site DNA Taste Graph — the per-site taste-signal console at /admin/sites/:id/dna. Every owner reaction to generated output (likes, dislikes, edit patterns) accumulates into a feedback history plus aggregated preference bars: a durable taste profile for the site. Future AI edits read that profile so regeneration converges on the owner's taste instead of resetting to platform defaults. The flag gates the admin surface via app-flag-gate-notice.",
    smoke_test: [
      'GET /api/feature-flags/site_dna_taste_graph → enabled:true (stable, 100%)',
      'UI: /admin/sites/:id/dna → feedback history + preference bars render (no flag-gate notice)',
      'Flag off → the DNA admin tab shows the flag-gate notice instead',
    ],
    e2e_tests: ['e2e/site-dna/site-dna.spec.ts'],
  },
  swarm_editor: {
    checklist: [
      'Simulated-preview board of the Multi-Agent Swarm Editor at /admin/swarm/:siteId',
      '7-column parallel-specialist grid + live component-stream preview',
      'Run-history fetch (/api/swarm/:id/runs) gated on this flag — dark = no fetch',
      'Launch + SSE stream disabled while dark (the /api/swarm/* backend is roadmap)',
    ],
    explanation:
      'Multi-Agent Swarm Editor — the 7-column parallel-specialist editing board plus live component-stream preview at /admin/swarm/:siteId. The panel is a simulated preview: real multi-agent execution (the /api/swarm/* backend) is on the roadmap. This flag gates the run-history fetch and the launch/stream actions, so while dark the section renders a clean gate notice and never fires a 404. Paired with multi_agent_concurrent; both must be on to run a live swarm.',
    smoke_test: [
      'GET /api/feature-flags/swarm_editor → enabled:false (experimental, 0%)',
      'UI: /admin/swarm/:id → simulated preview + gate notice, 0 console errors, NO /api/swarm/:id/runs request',
      'Flag on (+ backend) → run history loads and Start swarm run is enabled',
    ],
  },
};

export function getDocs(key: string): FlagDocs | undefined {
  return FLAG_DOCS[key];
}
