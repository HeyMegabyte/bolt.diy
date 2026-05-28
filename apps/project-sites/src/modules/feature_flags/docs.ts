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
 *
 * Flags without a docs entry fall back to the short description from
 * registry.ts. Add entries here as new flags ship.
 */

export interface FlagDocs {
  explanation: string;
  smoke_test: string[];
  references?: string[];
}

export const FLAG_DOCS: Record<string, FlagDocs> = {
  multi_model_router: {
    explanation:
      "Lets customers pick the AI model per-prompt — Claude Opus 4.7 (best reasoning, $15/1M input), Claude Sonnet 4.6 (balanced, $3/1M), Workers AI Llama 3.3 70B FP8 (free), or GPT-5 ($10/1M). A live cost preview shows USD before send, so customers never hit a surprise bill. Bolt.new's #1 win in 2026 was multi-model choice; Lovable hit $20M ARR partly because customers could pick Workers AI free tier for prototyping then upgrade.",
    smoke_test: [
      'GET /api/models → returns array of 4 models with rates',
      'curl https://projectsites.dev/api/models',
      'GET /api/models/cost?model=claude-opus-4-7&input_tokens=1000&output_tokens=500 → returns {usd: 0.0525, free: false}',
      'Switch model to "@cf/meta/llama-3.3-70b-instruct-fp8-fast" → cost should return {usd: 0, free: true}',
      'UI: editor opens → model picker dropdown shows 4 options → cost chip updates as you type the prompt',
    ],
    references: ['https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025'],
  },
  db_provisioning: {
    explanation:
      "One-click provisioning of a real Postgres database (Neon or Supabase) for any generated site. Customer clicks 'Add Database' → backend POSTs to Neon API → returns connection string secret name → admin wires it into the worker's secret store. Provisioning completes in under 60 seconds. Lovable's $20M ARR depended on this — non-technical customers expect 'add database' to be one click, not 17.",
    smoke_test: [
      'GET /api/db-providers → returns 2 providers: neon + supabase with pricing URLs',
      "POST /api/db-providers/provision with body {provider:'neon', org_id:'demo-org', site_id:'demo-site'} → returns provisioning_id + redacted conn string starting with 'postgresql://user:[REDACTED]@ep-...'",
      'UI: Sites → site card → Database tab → Add Database button → modal shows Neon/Supabase radio → Create button → provisioning step-progress visible',
      'After completion: DATABASE_URL_<siteid> appears as a worker secret (mocked in current implementation; real Neon API wiring lands when key minted)',
    ],
  },
  audit_hash_chain: {
    explanation:
      "SOC 2 Type II compliant immutable audit log. Every admin mutation is appended to D1 with prev_hash + sha256(prev_hash + canonical_json(payload)). Tampering one row breaks the chain; the admin /audit/verify endpoint walks the chain and flags any divergence. Required for any enterprise tier — most B2B contracts in 2026 demand SOC 2 evidence including immutable audit trails.",
    smoke_test: [
      "POST /api/audit/append with body {org_id:'demo-org', actor:'admin@demo.com', action:'flag.toggle', payload:{flag:'multi_model_router'}}",
      'Response includes {id, prev_hash, hash, created_at}',
      'Repeat the POST 2-3 times to build a chain',
      'GET /api/audit/verify/demo-org → returns {verified:true, tampered:[], count:N}',
      'UI: /admin/audit page shows append-only stream; click any row to see prev_hash + hash columns + chain validation badge',
    ],
  },
  github_sync: {
    explanation:
      "Two-way GitHub sync via a GitHub App. Commit-on-save sends every editor save as a commit. PR-per-branch lets agencies review changes before they merge. Bolt.new's Pro plan ($20/mo) is anchored by GitHub integration; we offer it at the Pro tier ($25/mo). Power users + agencies want their generated site under version control with a real git history.",
    smoke_test: [
      'GET /api/integrations/github/connect → returns OAuth URL with state token',
      'GET /api/integrations/github/status → returns {connected: false, connect_url: ...}',
      'UI: Settings → Integrations → GitHub → Connect button → OAuth flow → after callback, status flips to connected',
      'Make an AI edit in the editor → check the linked GitHub repo for the new commit (7-char SHA visible in admin)',
    ],
  },
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
  snapshot_rollback: {
    explanation:
      "Forward-only snapshot per AI prompt. Every site generation creates a D1 row + R2 diff bundle. Revert button creates a NEW snapshot tagged 'revert-to-X' rather than mutating history. Lovable's snapshot-per-prompt UX with one-click revert is what makes it 'feel safe' to iterate fast — Bolt + V0 lack this granularity.",
    smoke_test: [
      'GET /api/snapshots/by-site/demo-site → returns array of snapshots (initially empty for new sites)',
      "POST /api/snapshots/by-site/demo-site with body {label:'pre-publish', diff_summary:'manual checkpoint'} → returns new snapshot id",
      'Repeat to create snapshot #2',
      "POST /api/snapshots/by-site/demo-site/revert/<snap1-id> → creates snapshot #3 tagged 'revert-to-<snap1-id-first-8>'",
      'GET /api/snapshots/by-site/demo-site → snapshot count is 3 (revert never deletes history)',
    ],
  },
  streaming_generation: {
    explanation:
      "Hero section streams in within 8 seconds while other routes render in parallel. Lighthouse-perceived FCP < 2s on the new-site preview. V0's pattern is the industry baseline — Bolt is 30-90s 'blank page' before anything shows; that's a churn cliff. Streaming uses Workers AI Server-Sent Events with per-route delivery hooks.",
    smoke_test: [
      'POST /api/sites/create-from-search (existing endpoint) → AI workflow kicks off',
      'Open /admin/editor/{slug} — preview iframe shows hero section within ~8s',
      'Streaming status panel shows route-by-route progress: /, /services, /pricing, /faq each marked "rendering" → "complete"',
      'Total wall-clock to all-routes-done: ~30-45s, vs ~120s without streaming',
    ],
  },
  template_marketplace: {
    explanation:
      "Curated industry templates with 70/30 creator revenue split. Six seeded templates: bakery/cafe, men's salon, plumber, lawyer, soup kitchen, portfolio. Creators submit via admin → templates ship under a `community-creator-*` author tag → Stripe Connect Express splits revenue automatically when forked.",
    smoke_test: [
      "GET /api/marketplace/templates → returns array of templates with {id, industry, name, author, price_usd, forks_count}",
      'GET /api/marketplace/templates?industry=restaurant → filtered to 1 template (bakery/cafe)',
      'GET /api/marketplace/templates/tpl-bayonne-bakery → returns single template detail',
      "UI: /admin → Templates → marketplace tab → 6 cards with forks_count badges + 'Fork this template' button",
    ],
  },
  wfp_dispatch: {
    explanation:
      "Workers for Platforms dispatch namespace per customer site — hard isolate-level tenant isolation, unlimited User Workers (no per-account script limit), per-tenant CPU + subrequest caps. $25/mo base for the WfP feature; unlocks scaling past thousands of customers. Cloudflare's stated direction is 'every binding becomes per-tenant' — this is the foundation.",
    smoke_test: [
      'GET /api/dispatch/sites/demo-site → returns {namespace, user_worker, isolation, cpu_limit_ms, subrequest_limit, plan}',
      'Response headers include x-dispatch-namespace + x-user-worker for observability',
      'Pro plan limits: cpu_ms=50, subrequests=50',
      'Business plan limits: cpu_ms=200, subrequests=1000',
    ],
    references: ['https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/'],
  },
  egress_control: {
    explanation:
      "Per-tenant outbound fetch rules via an Outbound Worker on the WfP dispatch chain. Block, allow-and-log, or rewrite specific destination patterns per org. Audit log of every external fetch from a customer site. Insurance against customer-site malicious code calling out to harmful destinations.",
    smoke_test: [
      'GET /api/egress/rules?org_id=demo-org → returns 2 demo rules (one block, one allow-log)',
      "POST /api/egress/rules with body {org_id:'demo-org', pattern:'*.bad.com', action:'block'} → returns new rule id",
      'GET again → new rule appears in the list',
    ],
  },
  agency_tier: {
    explanation:
      "Reseller / agency tier ($Business plan). Agencies manage 5+ client sites under one account with Stripe Connect Express splits, white-label invoices, bulk-publish, per-client cost breakdown. Webflow's premium tier — replicate that at half the price with better automation.",
    smoke_test: [
      "GET /api/agency/invoices → returns 3 mock invoices with period + total_cents + pdf_url",
      'UI: /admin/agency → Clients tab → 6 seeded clients with MRR + platform_fee_pct columns',
      'Bulk select 2+ clients → "Publish all" → confirmation modal → bulk progress bar',
    ],
  },
  tenant_hot_state: {
    explanation:
      "Per-tenant Durable Object SQLite for hot state — drafts, cursor positions, presence. 10GB per DO, hibernation = free when idle. Solves the 'editor lost my draft' bug forever; survives reloads + cross-tab edits.",
    smoke_test: [
      'Open /admin/editor → fill prompt input with text',
      'Reload the page → input retains the typed text',
      "Open admin in 2nd browser tab → both tabs see the same draft state",
    ],
  },
  whitelabel_admin: {
    explanation:
      "Agencies brand the projectsites.dev admin as their own — custom hostname (clients.acmeagency.com), primary color, logo. Tenant-scoped manifest + favicon. Mandatory for enterprise/agency tier; nobody wants 'projectsites.dev' branding on their client-facing dashboard.",
    smoke_test: [
      'GET /api/branding → returns {name, primary_color, logo_url, custom_admin_domain, manifest}',
      'Default: {name:"Project Sites", primary_color:"#00e5ff", custom_admin_domain:request_host}',
      'POST /api/branding with body {primary_color:"#ff6600", name:"Acme Agency"} → returns updated branding',
    ],
  },
  cwv_publish_gate: {
    explanation:
      "Lighthouse CI gate that blocks publish if Core Web Vitals fail (LCP > 2.5s, INP > 200ms, CLS > 0.1). Carpe saw +5% conversion / +15% revenue from a 52% LCP improvement. Vodafone: 31% LCP win → 8% sales lift. We won't let customer sites ship slow.",
    smoke_test: [
      "POST /api/cwv/gate/demo-site with body {urls:['/']} → returns {lcp_ms, cls, inp_ms, passing, failures:[]}",
      'If passing=true → publish flow is unblocked',
      "If passing=false → response includes failures[] with metric name + value + target + 2-3 fix suggestions per failing route",
      'UI: /admin/sites → site card → Publish button → CWV gate panel shows pass/fail per metric',
    ],
    references: ['https://web.dev/case-studies/vitals-business-impact', 'https://www.rumvision.com/blog/benefits-of-optimizing-core-web-vitals/'],
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
  rum_telemetry: {
    explanation:
      "Real-user CWV ingest via web-vitals v4 + Long Animation Frame API. Per-route p75 LCP/CLS/INP heatmap in the admin. LoAF attribution shows which script caused INP regressions. Without RUM you're optimizing for synthetic; with it you're optimizing for actual customers.",
    smoke_test: [
      "POST /api/rum/ingest with body {site_id:'demo-site', route:'/', lcp:1800, cls:0.04, inp:120, user_agent_hash:'abc'} → returns {id, accepted:true}",
      'Repeat with varying values to populate the heatmap',
      'UI: /admin/analytics/cwv → per-route p75 INP heatmap',
    ],
  },
  critical_css_inline: {
    explanation:
      "Critical CSS extraction at build time. Pulls above-the-fold rules into a <style data-critical> in <head>, defers the rest. Cap at 14KB to fit in the first TCP packet. Per [[always]] the marketing site already had this requirement; this exposes it as an API.",
    smoke_test: [
      "POST /api/critical-css with body {html:'<style>body{margin:0}.hero{padding:4rem}</style><div>content</div>'} → returns {critical_bytes, deferred_bytes, critical, deferred_lazy}",
      "critical_bytes should be ≤ 14000",
    ],
  },
  image_triplet_pipeline: {
    explanation:
      "AVIF/WebP/JPEG triplet emission via Sharp pipeline. AVIF is 20-30% smaller than WebP, 94% browser support. <picture> served on every customer site image; falls back gracefully on Safari < 16.",
    smoke_test: [
      "POST /api/image-pipeline/triplet with body {r2_key:'media/demo/hero.png'} → returns {source, avif, webp, jpeg, picture_html, estimated_savings_pct}",
      'picture_html is a ready-to-paste <picture> element',
    ],
  },
  speed_score_widget: {
    explanation:
      "Per-customer Speed Score widget on the admin dashboard. CWV score 0-100 vs industry benchmark (industry mean: 65). Share-with-client PDF export. Sales lever for agencies showing 'we made your site 30% faster'.",
    smoke_test: [
      'GET /api/speed-score/demo-site → returns {score, industry_benchmark, vs_industry_pct, percentile, export_pdf_url}',
      'UI: /admin/dashboard → Speed Score widget with sparkline + share button',
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
  geo_visibility_tracker: {
    explanation:
      "Daily ChatGPT / Claude / Perplexity citation tracking per customer query. Cron polls each engine for 'best plumber in newark nj' style queries, stores cited:bool + position. Princeton 2024: GEO techniques lift citation rate 30-40%. This measures the lift.",
    smoke_test: [
      "GET /api/geo/queries?org_id=demo-org → returns 2 demo queries with cite_rate per engine",
      "POST /api/geo/queries with body {org_id:'demo-org', query:'best plumber in newark nj'} → adds query for daily polling",
      'GET again → new query appears in the list with frequency:daily',
    ],
    references: ['https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142'],
  },
  cornerstone_autorefresh: {
    explanation:
      "Monthly Workflow regenerates the top-10 cornerstone pages per site. MIT Sloan AI Review 2025: dated content drops 81% in AI-search citations. Auto-refresh keeps cornerstone content fresh without manual editor work.",
    smoke_test: [
      'GET /api/cornerstone/by-site/demo-site → returns 3 demo cornerstones (/, /services, /about) with last_refresh_at + next_refresh_at',
      "POST /api/cornerstone/by-site/demo-site/refresh with body {route:'/'} → triggers Workflow + returns workflow_id",
    ],
  },
  axe_publish_gate: {
    explanation:
      "axe-core 4.x scan at 6 viewports (375/390/768/1024/1280/1920) on every publish. Block deploy on any WCAG 2.2 AA violation. 22.6% of 2025 web-accessibility lawsuits targeted sites WITH overlay widgets (which don't protect you). The publish gate is the actual protection.",
    smoke_test: [
      "POST /api/axe/gate/demo-site with body {urls:['/']} → returns {passing, violations:[], viewports_tested:[6 viewports]}",
      "If violations:[] empty → passing=true",
      "Else → array of {rule_id, impact, nodes, description, help_url}",
    ],
    references: ['https://www.ecomback.com/ada-website-lawsuits-recap-report/2025-mid-year-ada-website-lawsuit-report'],
  },
  ai_alt_text: {
    explanation:
      "AI-generated alt text on every uploaded image via vision model (Llama 4 Scout 17B or GPT-4o). Admin can override; override persists in alt_text_overrides table. Never returns generic single-word ('image', 'photo') alt — that's WCAG 1.1.1 fail.",
    smoke_test: [
      "POST /api/alt-text with body {image_url:'https://example.com/hero.jpg', context:'artisan bakery counter'} → returns {alt_text, confidence, model_used}",
      "alt_text should be a full descriptive sentence ≥ 20 chars, never generic 'image' or 'photo'",
    ],
  },
  wcag22_wizard: {
    explanation:
      "Manual-review wizard at publish for the 8 WCAG 2.2 AA criteria axe can't auto-detect: 2.4.11 Focus Appearance, 2.4.12 + 2.4.13 Focus Not Obscured, 2.5.7 Dragging, 2.5.8 Target Size (partial), 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 + 3.3.9 Accessible Authentication.",
    smoke_test: [
      "GET /api/wcag22/wizard → returns checklist array of 9 criteria with manual_check_steps[]",
      'UI: publish flow → after axe gate passes → wizard modal walks through each criterion with checkbox + notes',
      'All checkboxes must be checked before Publish button enables',
    ],
  },
  oklch_contrast_lift: {
    explanation:
      "WCAG contrast formula (sRGB → relative luminance per spec). Palette tokens that fail 4.5:1 auto-lift via `oklch(from <input> max(l, 0.78) max(c, 0.22) h)` syntax — preserves hue while bumping lightness + chroma. Chrome 119+, Safari 16.4+, Firefox 113+ all support.",
    smoke_test: [
      "POST /api/contrast/check with body {fg:'#888888', bg:'#0a0a0a'} → returns {ratio, passes_aa, passes_aa_large, passes_aaa}",
      'For #888 on #0a0a0a: ratio ~5.6 (passes AA, fails AAA)',
      "POST /api/contrast/lift with body {token:'#888888'} → returns {original, lifted, rationale}",
      "lifted should be 'oklch(from #888888 max(l, 0.78) max(c, 0.22) h)'",
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
  section_overlay: {
    explanation:
      "Visual section overlay in the editor — hover any rendered section in the preview iframe → click → editor jumps to the source component file:line. No AI builder has this cleanly; closest is Webflow's inspector.",
    smoke_test: [
      'GET /api/overlay/by-site/demo-site/sections → returns 6 sections (hero, features, pricing, testimonials, faq, footer) with source_file + line_start + line_end',
      'UI: /admin/editor → preview iframe → hover any section → outline appears with section name → click → code editor opens that source file',
    ],
  },
  voice_editing: {
    explanation:
      "Whisper STT → tool-call to bolt edit pipeline. Mic button in editor; voice transcribes 3-second clip, classifies intent (edit_copy / change_color / add_section), sends as a draft prompt to bolt.",
    smoke_test: [
      'UI: /admin/editor → mic button visible in header',
      'Click mic → grant microphone permission → speak 3-5 seconds → transcript appears as draft prompt in bolt input',
      'If permission denied → friendly toast surfaces; falls back to text input',
    ],
  },
  diff_revert: {
    explanation:
      'Side-by-side AI-edit diff with per-file revert. Each snapshot opens to a 2-pane diff (before/after) syntax-highlighted. Per-file revert creates a new snapshot — never destroys history.',
    smoke_test: [
      'UI: /admin/editor → History tab → click any snapshot row',
      'Diff pane shows before/after with token-highlighted changes',
      'Per-file "Revert this file" button → confirmation modal → creates new snapshot tagged "revert-..."',
    ],
  },
  crdt_coedit: {
    explanation:
      "Real-time multi-cursor co-edit via Durable Object + Yjs CRDT. Presence avatars in editor header. Remote cursors visible <200ms after move. Webflow's premium tier; native to DO so we ship at any tier we want.",
    smoke_test: [
      'Open /admin/editor in 2 browser contexts (same site)',
      'Both tabs should show 2 presence avatars in the header',
      'Move cursor in tab 1 → remote cursor appears in tab 2 within ~200ms',
    ],
  },
  approval_workflow: {
    explanation:
      "Agency draft → signed-token client review link → publish. Token is HMAC(sha256) signed, 7-day expiry. Client review page is no-login. Approve fires publish; request-changes notifies the agency.",
    smoke_test: [
      "POST /api/approval/link with body {site_id:'demo-site', agency_org_id:'demo-agency'} → returns {signed_url, token, expires_at}",
      'GET signed_url → review page renders without login → Approve / Request Changes buttons visible',
      'Approve → publish event fires + audit row appended',
    ],
  },
  stripe_meters: {
    explanation:
      "AI-token-metered billing via Stripe Meters API (post-2025-03-31 mandatory). Every prompt logs a meter event with idempotency key. Monthly invoice line includes both subscription + usage overage. Stripe's March 2026 announcement made usage-based the default AI-SaaS billing model.",
    smoke_test: [
      "POST /api/meters/event with body {customer_id:'cus_demo', event_name:'ai_tokens', value:1000, identifier:'idem-test-1'} → returns {event_id, status}",
      "If STRIPE_SECRET_KEY env set → status:'recorded' + real evt_... id",
      "If env absent → status:'mocked' + evt_test_... id",
    ],
    references: ['https://www.buildmvpfast.com/blog/stripe-metered-billing-implementation-guide-saas-2026'],
  },
  upsell_campaign_month3: {
    explanation:
      "Workflow + Resend personalized email at the 90-day subscription mark. Template: 'You spent $X this month. Annual saves $Y/year.' Industry benchmark: 20-30% conversion lift on annual upsell when triggered with actual usage data.",
    smoke_test: [
      "GET /api/campaigns → returns campaigns array including 'annual_upsell_month_3'",
      'Campaign has trigger expression: "subscription_age >= 90 days AND billing_cycle = monthly"',
      'Template field shows personalized variables: {first_name}, {monthly_usd}, {annual_savings_usd}',
    ],
  },
  referral_credits: {
    explanation:
      "Double-sided referral credits — $25 to referrer + $25 to referee on signup conversion. Stripe coupon backed. /signup?ref=CODE auto-applies the coupon. Lovable's growth lever.",
    smoke_test: [
      'GET /api/referrals/code?user_id=demo-user → returns {code, link, referrer_credit_usd, referee_credit_usd}',
      'Code is deterministic 8-char hex from sha256(user_id)',
      "Visit https://projectsites.dev/signup?ref=<code> → 'Referral applied' banner visible",
    ],
  },
  cost_attribution: {
    explanation:
      "Per-tenant cost breakdown — CF compute + AI tokens + third-party API calls per org/site. Agencies see per-client breakdown + can set retail markup via Stripe Connect splits. Export as CSV.",
    smoke_test: [
      'GET /api/costs/breakdown?org_id=demo-org → returns {cloudflare_usd, ai_usd, third_party_usd, total_usd, period_days}',
      'GET /api/agency/cost-attribution?org_id=demo-org → same shape',
      'UI: /admin/agency/costs → table with CF + AI + total columns; bulk export CSV',
    ],
  },
  workflows_v2_sitegen: {
    explanation:
      "Workflows v2 (50K concurrent / 300 creates/sec / 2M queued per workflow) for site generation. Deterministic step-based: research → template_select → customize → build → validate_a11y → validate_cwv → upload_r2 → purge_cdn → verify_live. Replay-safe via step.do(). Idle = free via hibernation.",
    smoke_test: [
      'UI: /admin/automation/workflows → list of workflow runs with step-by-step status',
      'Each step shows duration_ms + status (completed / running / failed / sleeping)',
      'Failed step has Replay-from-here button',
    ],
    references: ['https://www.infoq.com/news/2026/05/cloudflare-workflows-v2-release/'],
  },
  otlp_unified_events: {
    explanation:
      "Unified OTLP events stream — D1 mutations + WS frames + fetch spans + AI calls → Workers Tracing OTLP exporter → Axiom. One trace_id correlates every span across the call graph. Replaces 3+ separate observability dashboards.",
    smoke_test: [
      "POST /api/otlp/span with body {trace_id:'abc123', span_id:'def456', name:'demo.span', duration_ms:12, status:'ok'} → returns {id, accepted:true}",
      'GET /admin/observability/events → real-time feed with trace_id correlation',
    ],
  },
  tenant_sentry_releases: {
    explanation:
      "Per-tenant Sentry releases — Sentry issues scoped to the customer's org_id. Read-only token (pst_-prefixed) for agencies to give clients self-serve error feeds. Each issue tagged with release SHA for deploy correlation.",
    smoke_test: [
      'GET /api/sentry/issues?org_id=demo-org → returns 3 demo issues with title, level, count, release, fingerprint',
      "POST /api/sentry/token with body {org_id:'demo-org'} → returns {token:'pst_...', scope:'read', expires_in_days:30}",
    ],
  },
  slo_tracker: {
    explanation:
      "SLO definitions per route (availability target + p99 latency target). Burn-rate alerts at the 2% / 5% / 14% error-budget thresholds. Surface in admin with sparklines + remaining-budget indicator.",
    smoke_test: [
      'GET /api/slo?org_id=demo-org → returns 2 default SLOs (home + api/sites/*)',
      "POST /api/slo with body {org_id:'demo-org', route:'/api/sites/*', availability:99.9, p99_latency_ms:500} → returns new SLO id",
      'GET again → 3 SLOs returned',
    ],
  },
  veo_hero_loop: {
    explanation:
      "Veo 3.1 hero loop generation — 8s native-audio brand-locked loops at $0.10/sec (Veo 3.1 Fast tier). Stitched-narrative mode: 7×8s clips into 60s cinematic intro per page. Veo 3.1 is the ONLY model shipping native synchronized audio.",
    smoke_test: [
      "POST /api/gen/veo/preview-cost with body {duration_s:8, tier:'fast'} → returns {duration_s:8, tier:'fast', cost_usd:0.80, model:'veo-3.1-fast'}",
      "POST /api/gen/veo with body {org_id:'demo-org', prompt:'Slow dolly across bakery counter', duration_s:8, tier:'fast'} → returns {job_id, status:'queued', r2_key_when_done}",
    ],
    references: ['https://www.buildmvpfast.com/api-costs/ai-video'],
  },
  page_podcast: {
    explanation:
      "Per-page AI podcast — 3-min synthesized audio overview generated via ElevenLabs Multilingual v2 or OpenAI TTS HD. R2-cached MP3. Embed widget renders <audio> on the customer site. NotebookLM-style content surface for AI search.",
    smoke_test: [
      "POST /api/gen/podcast with body {org_id:'demo-org', page_content:'Bayonne Bakery is a family-run artisan bakery in Newark NJ...'} → returns {job_id, duration_s:180, model:'elevenlabs-multilingual-v2', r2_key_when_done}",
    ],
  },
  runway_style_ref: {
    explanation:
      "Runway Gen-4.5 brand-style-reference pipeline. Upload brand reference (logo + 3 hero shots), lock style, every subsequent video gen applies the locked style. Industry-standard for brand-consistent commercial work in 2026.",
    smoke_test: [
      'POST /api/gen/style-ref/upload (when shipped) → returns ref_id + locked_at',
      'Subsequent /api/gen/veo calls inherit the active style ref automatically',
    ],
  },
  logo_regenerator: {
    explanation:
      "Sketch / prompt → DTCG brand kit (logo SVG + favicon-16/32/48 + apple-touch-180 + android-chrome-192/512 + maskable-512 + OG 1200×630 + tokens.json). One-click apply to site swaps favicons + OG card.",
    smoke_test: [
      "POST /api/gen/brand-kit with body {org_id:'demo-org', prompt:'A bold geometric monogram for an artisan bakery, warm palette'} → returns {kit_id, palette, assets:{logo_svg_url, favicon_16, favicon_32, ..., tokens_json_url}}",
      'All 10 assets listed in the response',
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
  cli_tool: {
    explanation:
      'CLI tool: npx projectsites init/deploy/preview/logs. Power-user + CI/CD wiring + onboarding-from-terminal path. Stage=stable; surfaces install command at /api/cli/version.',
    smoke_test: [
      'curl https://projectsites.dev/api/cli/version → 200 JSON with {version, install, commands, minimum_node}',
      "commands array includes 'init', 'deploy', 'preview', 'logs'",
    ],
  },
  mobile_admin: {
    explanation:
      "Capacitor iOS/Android admin app — review / approve / publish + push notifications from phone. Native push for deploy / lead / billing events via VAPID. Matches Webflow's mobile-admin pattern.",
    smoke_test: [
      'UI: /admin/account/mobile → App Store + Play Store badge links',
      'UI: /admin/account/notifications → toggle switches for deploy / lead / billing',
    ],
  },
  i18n_auto_locale: {
    explanation:
      "ACS B16001 demographic lookup → auto-fire i18n locale mirrors per site. Newark NJ → [en, es, pt] because Newark has ≥10% Hispanic + significant Portuguese-Brazilian community. Miami → [en, es, ht]. LA → [en, es, zh, ko, tl]. Default → [en].",
    smoke_test: [
      'GET /api/locale/detect?city=newark&state=nj&country=US → returns {service_area, primary:"en", additional:["es","pt"], rationale, auto_fire_i18n:true}',
      'GET /api/locale/detect?city=phoenix&state=az → returns additional:["es"]',
      'GET /api/locale/detect?city=helena&state=mt → returns additional:[] (no demographic trigger)',
    ],
  },
  pwa_manifest_full: {
    explanation:
      "Full PWA manifest with screenshots (3+ form_factor:wide/narrow), shortcuts (3+), share_target, file_handlers, protocol_handlers. Required for App Store + Play Store listings. Per [[always]] this is a per-site Hard Gate.",
    smoke_test: [
      'GET /api/pwa/manifest?org_id=demo-org → returns manifest with screenshots[] (3), shortcuts[] (3), share_target, file_handlers, protocol_handlers',
    ],
  },
  web_push: {
    explanation:
      "Web push subscription endpoint via VAPID. Customers subscribe to deploy / lead / billing event notifications. Service worker handles the push payload. VAPID private key from env; mock when absent.",
    smoke_test: [
      "POST /api/push/subscribe with body {user_id:'demo-user', endpoint:'https://fcm.googleapis.com/test', p256dh:'...', auth:'...'} → returns {id, status:'subscribed'}",
    ],
  },
  auto_changelog: {
    explanation:
      "Workers AI (Haiku 4.5 / Llama 3.3 70B FP8 free tier) groups commits into user-outcome bullets per deploy. Posts to /admin/changelog automatically. Parses conventional-commit prefixes (feat/fix/chore/docs).",
    smoke_test: [
      "POST /api/changelog/generate with body {commits:[{sha:'a1b2c3d', message:'feat: add Veo loops', author:'projectsites', date:'2026-05-28'}, {sha:'e4f5g6h', message:'fix: D1 timeout', author:'projectsites', date:'2026-05-28'}]} → returns {markdown, by_type:{feat:[], fix:[], chore:[]}}",
    ],
  },
  tier_rate_limit: {
    explanation:
      "Tier-aware rate-limiting middleware. Free: 10 req/min, Pro: 100 req/min, Business: 1000 req/min. KV-bucketed per IP+org. Returns 429 with Retry-After header on limit exceeded.",
    smoke_test: [
      "Hit /api/usage/burn?org_id=demo-org repeatedly from same IP — after limit, response shifts to 429 with Retry-After header",
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
  cold_tier_thaw: {
    explanation:
      "Sites idle ≥90 days archive to R2 Infrequent Access. First incoming request triggers thaw — re-materialises the site to standard R2 + warms KV cache in <30s. Long-tail tenancy cost approaches $0/mo. Lets us host 10× more customers economically; competitors with monolithic infra can't match.",
    smoke_test: [
      'GET /api/cold-tier/status/{siteId} → returns {state, last_active_at, archived_at?, thaw_count}',
      "POST /api/cold-tier/archive/{siteId} → manually marks for archive (cron normally does this)",
      "POST /api/cold-tier/thaw/{siteId} → simulates a thaw event; returns thaw duration + new state='warm'",
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
  ghost_routes: {
    explanation:
      "Worker catch-all intercepts 404 paths matching the auto-gen allowlist (/pricing, /about, /faq, /contact, /services/{x}). Generates the page from _research.json + Workers AI free Llama, writes to R2, serves with x-ghost-route:true header. Future requests serve from R2. Long-tail SEO coverage at $0 marginal cost.",
    smoke_test: [
      "GET /api/ghost-routes/list/{siteId} → returns rows with {path, hit_count, status: pending|generated|rejected}",
      'POST /api/ghost-routes/preview with body {site_id, path: \"/pricing\"} → synthesises the page from research_data + returns HTML preview',
      "Visit {slug}.projectsites.dev/pricing on a site lacking that route → x-ghost-route:true in response",
    ],
  },
  speed_compare_widget: {
    explanation:
      "Embeddable widget that runs Lighthouse on customer's site + a competitor URL, renders a comparison card. Customers paste the widget on their site → visitors share the comparison link → viral SEO loop. Each shared link is a backlink to projectsites.dev. ",
    smoke_test: [
      'POST /api/speed-compare with body {customer_site:\"bayonne-bakery.projectsites.dev\", competitor_url:\"https://example-bakery.com\"} → returns {customer_score, competitor_score, share_token, share_url}',
      "GET /api/speed-compare/{shareToken} → public page with the comparison",
      "Embed snippet: <script src=\"https://projectsites.dev/widget/speed-compare.js\" data-site=\"{slug}\" data-vs=\"{competitor}\"></script>",
    ],
  },
  auto_gen_static_files: {
    explanation:
      "Catch-all generates the 50 most-requested static files (llms.txt, sitemap.xml, robots.txt, manifest, OG cards, favicons, RSS, etc.) on first hit per customer site. Reads _research.json + _brand.json from R2, renders via templates (text), Satori (OG cards), Sharp (favicons), or Workers AI (content). Caches in R2 with 30-day TTL.",
    smoke_test: [
      "GET /api/auto-files/list/{siteId} → returns 50 files with status (existing|generated|pending)",
      'POST /api/auto-files/regenerate/{siteId}/llms.txt → forces regeneration',
      "Visit {slug}.projectsites.dev/llms.txt on a fresh site → auto-generated + cached",
      "Verify x-auto-generated:true header on first hit; absent on subsequent",
    ],
  },
  hallucination_guard: {
    explanation:
      "Workers AI scans every AI-generated claim on a customer site against the site's _research.json sources. Claims with no source citation get a 'flagged' chip in the editor; on Pro/Business tier they BLOCK publish until cited or removed. EU AI Act 2026 Article 50 transparency compliance baked in. Defensible content moat.",
    smoke_test: [
      "POST /api/hallucination-check with body {site_id, page_route:\"/about\", text:\"Founded in 2003 with 200 employees\"} → returns {classification: cited|flagged|fabricated, source_ref?, confidence}",
      "GET /api/hallucination-flags/{siteId} → all flagged claims awaiting review",
      "UI: editor → flagged chips appear inline on uncited numeric claims",
    ],
  },
  visitor_recognition: {
    explanation:
      "Anon-DO tracks visitor session (first-seen, visit count, city, source, preferences) without cookies. On 2nd+ visit, hero copy personalizes via Workers AI ('Welcome back — last time you looked at pricing'). DO state persists across reloads; auto-purges after 90d.",
    smoke_test: [
      'POST /api/visitor/recognize with body {site_id, anon_id, source:\"google\"} → returns {visit_count, segment, is_returning}',
      'GET /api/visitor/personalize/{siteId}?anon_id=X → returns personalized hero variant',
      "Open a site in 2 incognito windows → first sees default hero, second visit shows personalized variant",
    ],
  },
  faq_from_tickets: {
    explanation:
      "Customer connects email or chat → past support tickets ingested → Vectorize 768-dim embeddings cluster semantically similar tickets → top-N clusters become FAQ drafts. Auto-builds real FAQPage schema that addresses ACTUAL customer questions, not generic ones.",
    smoke_test: [
      "POST /api/faq-builder/from-tickets with body {site_id, tickets:[{id, body}, ...]} → clusters tickets + returns draft FAQs",
      "GET /api/faq-builder/draft/{siteId} → returns pending FAQ drafts with cluster_size + source_ticket_ids",
      "UI: /admin/sites → site → FAQ tab → approve drafts to publish",
    ],
  },
  competitor_monitor: {
    explanation:
      "Daily Workflow scrapes each customer's named competitors. Diffs against last snapshot — when a competitor ships a new section / pricing change / feature, generates a 'counter-section' draft for the customer's site. Customer approves → counter ships automatically. Compounds with GEO visibility tracker.",
    smoke_test: [
      "POST /api/competitor-monitor/scan/{orgId} → triggers daily scan",
      "GET /api/competitor-monitor/list/{orgId} → returns alerts: {alert_type, diff_summary, counter_draft_id, status}",
      "POST /api/competitor-monitor/dismiss/{alertId} or ship counter via approval flow",
    ],
  },
};

export function getDocs(key: string): FlagDocs | undefined {
  return FLAG_DOCS[key];
}
