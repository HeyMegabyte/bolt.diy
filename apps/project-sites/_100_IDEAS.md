# 100 High-Effort, High-Value Ideas for ProjectSites.dev

> Each idea = 10-40h senior dev time, high customer-perceived value, durable competitive moat.
> Scored on: **Impact** (1-10) · **Effort** (hours) · **Differentiation** (1-10) · **Revenue Potential** (1-10).
> Sorted within each category by Impact × Differentiation / Effort (ROI density).

---

## 1. AI-Native Platform (Agent-Native Hosting)

These are the "what's possible BECAUSE AI is programming" ideas — the durable moat no traditional builder can match.

### 1. MCP Server Per Tenant Site
**Impact 10 · Effort 35h · Diff 10 · Revenue 9**

Every generated site becomes a live MCP server at `mcp.{slug}.projectsites.dev`. AI agents (Claude, Cursor, ChatGPT) connect via OAuth 2.1 + Resource Indicators and get typed tools: `create_page`, `update_content`, `upload_media`, `read_analytics`, `manage_seo`. The site becomes programmable by any AI agent. Built on the existing `McpAgent` + `mcp_site_tools.ts` foundation.

**Why it's 10h+:** OAuth 2.1 AS per-tenant, dynamic tool registration from site schema, per-tool Zod validation, rate limiting per agent, audit logging, MCP Registry publishing automation.

### 2. Autonomous Site Lifecycle Agent
**Impact 10 · Effort 40h · Diff 10 · Revenue 10**

A Cloudflare Agent (Durable Object) that perpetually manages each site after launch. It monitors: broken links, stale content (>90 days unchanged), Core Web Vitals regressions, security header drift, JSON-LD validity, competitor changes, AI search visibility. It proposes fixes, auto-applies safe ones, alerts the owner for judgment calls. "Your Services page hasn't been updated in 6 months — here are 3 new services competitors added, want me to draft updates?"

**Why it's 10h+:** Agent state machine, monitoring scheduler, competitor diff engine, proposal generation, auto-fix safety gates, owner notification pipeline, Durable Object per site with SQLite state.

### 3. AI Content Strategist with Competitor Gap Analysis
**Impact 9 · Effort 30h · Diff 9 · Revenue 8**

Analyzes the site's current content against top 5 competitors, identifies content gaps, generates a 90-day content calendar with SEO-briefed outlines. Uses DeepSeek for bulk analysis, Workers AI Llama 3.3 for drafting, Anthropic for final polish. Integrates with the existing `seo_autopilot.ts` + `pseo_matrix.ts` infrastructure.

**Why it's 10h+:** Multi-site crawl orchestration, content gap diff algorithm, SEO briefing engine, calendar generation UI, scheduled draft pipeline.

### 4. Multi-Agent Build Pipeline with Specialized Roles
**Impact 9 · Effort 35h · Diff 9 · Revenue 7**

Replace the single-orchestrator container build with a multi-agent pipeline: Content Strategist, Visual Designer, SEO Specialist, Accessibility Auditor, Performance Engineer, Copywriter — each a dedicated agent with its own prompt chain and quality gate. Agents run in parallel where independent, sequenced where dependent. Final integration agent merges outputs.

**Why it's 10h+:** Agent orchestration framework, inter-agent communication protocol, conflict resolution, merge strategies, per-agent quality gates, parallel execution engine.

### 5. Natural Language Site Management (Chat-as-UI)
**Impact 9 · Effort 25h · Diff 8 · Revenue 7**

"Change my hero headline to 'Best Pizza in Brooklyn'" → AI updates the site. "Add a testimonial section with 3 reviews" → AI generates and inserts. Full chat interface that can read, create, edit, and delete any site content. Built on the MCP tool surface + existing `copilot.ts` route.

**Why it's 10h+:** Intent parsing with tool dispatch, safe content mutation with preview/diff, undo stack, permission model, streaming response with progressive rendering.

### 6. AI-Driven A/B Testing Engine
**Impact 8 · Effort 30h · Diff 8 · Revenue 9**

Server-side split testing of headlines, CTAs, hero images, layouts, and full sections. Statistical significance calculator. Auto-declares winners and applies them. No client-side flicker. Built on CF Workers `ctx.waitUntil` + D1 experiment tables + existing Analytics Engine.

**Why it's 10h+:** Experiment assignment (consistent hashing), variant serving without flicker, metrics collection pipeline, statistical engine (Bayesian + frequentist), auto-apply on significance, admin dashboard.

### 7. Code Export to Self-Hosted Cloudflare
**Impact 10 · Effort 20h · Diff 10 · Revenue 6**

One-click export of the entire site as a deployable Cloudflare Worker + D1 + R2 project. Customer gets a zip with `wrangler.toml`, all source, migrations, and a `README.md`. Deploy to their own Cloudflare account with one command. The ultimate lock-in killer — which paradoxically increases trust and conversion.

**Why it's 10h+:** Static analysis to extract site structure, Workers-compatible code generation, D1 schema + data export, R2 asset packaging, wrangler.toml generation, deploy validation.

### 8. AI Website Critic with Visual Diff
**Impact 8 · Effort 20h · Diff 8 · Revenue 6**

Upload a screenshot or URL, AI returns a structured critique: layout problems, contrast issues, copy weaknesses, missing trust signals, SEO gaps. Compares against top-performing sites in the same industry. Generates a prioritized fix list with "Auto-Fix" buttons. Uses GPT-4o vision + existing `vision_qa.ts` route.

**Why it's 10h+:** Screenshot capture pipeline, multi-model vision analysis, industry benchmark database, structured critique schema, auto-fix generation per issue type.

### 9. Per-Site AI Podcast (Audio Overview)
**Impact 7 · Effort 25h · Diff 8 · Revenue 7**

Every site gets a 3-5 minute AI-generated podcast summarizing what the business does, key services, and why choose them. Generated via Piper TTS (self-hosted) with a conversational two-host script. Embedded as an audio player on the homepage. Updates when site content changes significantly. Builds on `page_audio_summary/` feature module.

**Why it's 10h+:** Two-voice script generation, Piper TTS orchestration, audio mixing/post-processing, content change detection for regeneration, accessible audio player component.

### 10. Behavioral Hero Personalization
**Impact 8 · Effort 25h · Diff 9 · Revenue 7**

First-time visitor sees a welcoming hero with business overview. Returning visitor sees latest offers or new content. Visitor from Google search sees content reinforcing their search intent. Visitor from social media sees social-proof-heavy hero. All server-side via Worker request inspection, no client flicker.

**Why it's 10h+:** Referrer/source detection, visitor identity via cookie + KV, variant selection engine, content personalization without layout shift, A/B test integration, analytics attribution.

### 11. AI-Generated Veo/Sora Video Hero
**Impact 8 · Effort 20h · Diff 9 · Revenue 8**

Generate a 60-second cinematic brand video from research data + brand assets. 7-8 clips stitched together with AI voiceover (Piper) and background music. Embedded as hero background. Premium feature that costs credits. Video generation queued via Workflows, delivered async.

**Why it's 10h+:** Multi-segment prompt engineering for video models, clip orchestration, video stitching/encoding, audio mixing, progressive streaming delivery, credit metering.

### 12. White-Label Agency Mode
**Impact 9 · Effort 30h · Diff 7 · Revenue 10**

Agencies resell ProjectSites under their own brand. Custom domain for the admin, white-labeled editor, agency-branded client reports, client management dashboard, bulk site operations, agency-tier pricing with volume discounts. The `agency.ts` route already exists — this is the full productization.

**Why it's 10h+:** Multi-tenant branding engine, agency dashboard, client management CRUD, white-label deploy pipeline, agency billing/payouts, reseller agreement automation.

### 13. Agent-Native Plugin Marketplace
**Impact 8 · Effort 35h · Diff 9 · Revenue 8**

Third-party developers build "site plugins" that are just typed MCP tools. A plugin is a Zod schema + Worker handler + UI component. Installed via the admin dashboard, runs in the site's Worker isolate. Marketplace with ratings, reviews, pricing (free/one-time/subscription). Revenue share.

**Why it's 10h+:** Plugin SDK (Zod + Hono + React), sandboxed execution, plugin registry, installation/update/uninstall lifecycle, billing integration, review system, featured/curation algorithm.

### 14. AI-Generated Per-Visitor PDF/Brochure
**Impact 7 · Effort 20h · Diff 8 · Revenue 6**

"Download our services brochure" → AI generates a custom PDF with the pages/products the visitor actually viewed, personalized cover, relevant case studies. Generated on-demand via CF Workers + pdf-lib, cached in R2, served instantly on return visits.

**Why it's 10h+:** Visitor journey tracking, content selection algorithm, PDF layout engine, dynamic image placement, caching strategy, analytics attribution.

### 15. Style Remix — AI Theme Variants
**Impact 7 · Effort 20h · Diff 7 · Revenue 7**

"Show me 3 alternate designs for my site." AI generates complete color/font/layout remixes while preserving all content. User picks one, site updates instantly. Seasonal variants (holiday themes) auto-generated and scheduled. Uses the existing `theme_polarity.ts` + template system.

**Why it's 10h+:** Design token extraction, variant generation with constraints (brand colors preserved), CSS variable remapping, preview/sandbox rendering, scheduled theme rotation.


## 2. Website Building & Generation

### 16. Visual Drag-and-Drop Section Builder
**Impact 9 · Effort 40h · Diff 7 · Revenue 8**

Full visual editor where users drag pre-built sections (hero, features, testimonials, pricing, FAQ, contact) onto a canvas, reorder them, and customize content inline. Generates clean, semantic HTML/CSS — not div-soup. Builds on the existing GrapesJS integration + `visual_point_edit/` module.

**Why it's 10h+:** Canvas rendering engine, drag-drop with auto-layout, inline content editing, section registry with metadata, undo/redo stack, mobile-responsive preview, clean code generation.

### 17. CMS Collections with Rich Relationships
**Impact 10 · Effort 35h · Diff 8 · Revenue 9**

Dynamic content types: Team Members, Services, Testimonials, Portfolio Items, FAQ, Events, Menu Items. Reference fields (article → author, service → team member). Filtered collection pages. Dynamic routing (`/services/{slug}`, `/team/{slug}`). Customers build a directory, job board, or catalog without code. D1-backed, API-first.

**Why it's 10h+:** Schema builder UI, relational field types, dynamic routing engine, collection page templates, API generation per collection, import/export, Zod validation per field.

### 18. AI Site Structure Planner from Competitor Analysis
**Impact 8 · Effort 25h · Diff 8 · Revenue 7**

Crawls top 5 competitor sites, analyzes their information architecture, generates an optimal site structure plan with page types, content recommendations, and SEO keyword mapping. User reviews and approves before build starts. Extends `openai_research.ts` + `pseo_matrix.ts`.

**Why it's 10h+:** Competitor crawl orchestration, IA diff algorithm, page type classifier, keyword-to-page mapping, structure visualization, user approval workflow.

### 19. Instant Preview Environments (Per-Branch Sites)
**Impact 8 · Effort 25h · Diff 8 · Revenue 7**

Every content change creates a preview deployment at `preview-{hash}.{slug}.projectsites.dev`. Shareable link for stakeholder review. Approve → publish to production. Reject → preview expires. Built on `site_branches.ts` + R2 versioning + existing snapshot system.

**Why it's 10h+:** Preview provisioning pipeline, isolated R2 prefix per preview, approval workflow, expiry/sweep cron, diff view between preview and live, comment/annotation on preview.

### 20. Bulk Site Generation for Multi-Location Businesses
**Impact 8 · Effort 30h · Diff 7 · Revenue 9**

A franchise or chain with 50 locations gets 50 sites from one brief + a CSV of location data. Each site shares the brand template but has unique: address, phone, hours, team photos, local SEO, Google Maps embed. The current system builds one site at a time — this is the enterprise multiplier.

**Why it's 10h+:** CSV parsing and validation, template variable system, parallel build orchestration (50 concurrent containers), per-site customization pipeline, bulk management dashboard, per-site analytics aggregation.

### 21. Figma/Design Import to Editable Site
**Impact 7 · Effort 35h · Diff 8 · Revenue 7**

Import a Figma design file and convert it to a fully editable ProjectSites site. Parse Figma's component tree, map to section types, extract design tokens, preserve responsive breakpoints. The `figma_import/` module exists as a skeleton — this is the full implementation.

**Why it's 10h+:** Figma API integration, component tree parser, design-to-section mapping engine, design token extraction, responsive layout inference, interactive element detection, asset export pipeline.

### 22. Multi-Language Site Variants (Full i18n)
**Impact 9 · Effort 30h · Diff 7 · Revenue 8**

Every page gets language variants with proper hreflang, RTL layout switching, locale-specific images, translated URLs. Machine translation first draft (DeepL/Workers AI), human-editable. Automatic language detection + redirect. Builds on `i18n.ts` route.

**Why it's 10h+:** Translation management UI, per-locale content storage, hreflang generation, RTL CSS generation, language detection/redirect, translation memory for repeated phrases, translator collaboration.

### 23. Programmatic SEO Page Generator
**Impact 8 · Effort 25h · Diff 7 · Revenue 8**

Upload a CSV of locations, services, or products → auto-generate hundreds of unique, SEO-optimized pages. Each page has unique content (no duplication penalties), proper internal linking, geo-targeted keywords, and LocalBusiness schema. Built on the Workers AI + D1 infrastructure.

**Why it's 10h+:** CSV schema inference, content generation with uniqueness constraints, internal link graph builder, bulk page creation pipeline, sitemap generation, incremental updates.

### 24. Real-Time Collaborative Editing
**Impact 7 · Effort 40h · Diff 8 · Revenue 6**

Multiple team members edit the same site simultaneously. See each other's cursors, changes sync in real-time via Durable Objects + WebSockets. CRDT-based conflict resolution. Presence awareness. Built on Yjs + CF Durable Objects.

**Why it's 10h+:** CRDT data model for site content, WebSocket connection management, presence/cursor sync, conflict resolution UI, permission model, offline editing with sync on reconnect.

### 25. Accessibility Remediation Engine
**Impact 8 · Effort 25h · Diff 7 · Revenue 7**

Automated accessibility audit → fix generation → one-click apply. Catches: contrast issues, missing alt text, heading hierarchy, ARIA labels, focus order, keyboard traps, form labels, landmark structure. Generates an accessibility statement page. ADA Title II compliance dashboard. Extends the `accessibility-auditor` agent pattern.

**Why it's 10h+:** axe-core integration at build time, per-issue fix generator, safe auto-fix rules (no layout breakage), manual fix guides with code snippets, compliance score tracking, VPAT generation.

### 26. AI-Powered Image Alt Text & Metadata Generator
**Impact 7 · Effort 15h · Diff 6 · Revenue 5**

Every image gets AI-generated alt text, caption, and structured data. Runs on upload and as a bulk operation. Uses GPT-4o vision for complex images, Workers AI Llama 3.2 vision for simple ones. SEO impact is immediate and measurable.

**Why it's 10h+:** Multi-model vision pipeline, confidence scoring per image, bulk processing with queue, human review queue for low-confidence results, existing content update on regeneration.

### 27. Template Marketplace with Revenue Share
**Impact 7 · Effort 30h · Diff 7 · Revenue 8**

Third-party designers submit site templates. Each template is a complete site skeleton with industry-specific sections, copy patterns, and image strategies. Review process, ratings, revenue share. Templates are starting points the AI customizes — not static designs.

**Why it's 10h+:** Template submission/validation pipeline, review queue, marketplace listing with preview, revenue share tracking, template versioning, quality scoring, abuse reporting.


## 3. CMS & Content Management

### 28. Visual Automation Builder (Email + SMS Journeys)
**Impact 10 · Effort 40h · Diff 9 · Revenue 10**

Drag-and-drop visual journey builder: multi-step triggers, conditional branches, delay timers, A/B split testing, goal-based completion. Unlimited steps on all tiers. Replaces ActiveCampaign/Mailchimp automation (gated behind $80-300/mo tiers). Built on Dittofeed's journey engine + existing `campaign_builder.ts`.

**Why it's 10h+:** Visual node editor (React Flow), execution engine with event bus, condition evaluator, split-testing with statistical significance, analytics per step, journey versioning, import/export.

### 29. Universal Content Scheduler
**Impact 9 · Effort 30h · Diff 8 · Revenue 8**

Schedule any content change: publish a new page on Tuesday, swap the hero image for a holiday variant, enable a promotional banner for the weekend, change the CTA during a campaign. Calendar view, drag-to-reschedule, conflict detection, preview-at-future-date. Extends `content_scheduler.ts`.

**Why it's 10h+:** Temporal content model, scheduler engine, calendar UI, conflict detection, preview-at-timestamp, rollback on schedule completion, recurring schedule support.

### 30. Content Versioning with Visual Diff
**Impact 8 · Effort 25h · Diff 7 · Revenue 7**

Every content edit creates a version. Browse version history, see visual diffs (not code diffs), restore any version. Branch content for major redesigns, merge back. Built on `content_version.ts` + snapshot infrastructure.

**Why it's 10h+:** Content versioning model, visual diff rendering (screenshot comparison), version browser UI, restore with confirmation, branch/merge workflow, storage optimization.

### 31. AI Content Rewriter with Brand Voice Preservation
**Impact 8 · Effort 20h · Diff 7 · Revenue 7**

"Rewrite this page to be more professional" or "Make this sound more friendly." AI rewrites while preserving: brand voice, key facts, SEO keywords, internal links, and calls to action. Learns brand voice from existing content. Preview side-by-side before applying.

**Why it's 10h+:** Brand voice extraction/encoding, constrained generation (preserve entities/links/keywords), tone transfer, side-by-side diff preview, batch rewrite across pages.

### 32. Content Freshness Monitor & Auto-Update
**Impact 7 · Effort 20h · Diff 8 · Revenue 7**

Scans all site content, flags: outdated information (>6 months old), thin pages (<300 words), missing sections competitors have, broken internal links, stale testimonials. Suggests updates with AI-generated drafts. "Your Pricing page mentions 2024 rates — update to 2026?"

**Why it's 10h+:** Content age analysis, competitive gap detection, thin content identification, AI draft generation per issue, scheduled re-scan, owner notification pipeline.

### 33. Multi-Source Content Import
**Impact 7 · Effort 25h · Diff 7 · Revenue 6**

Import content from: WordPress export, Squarespace scrape, Google Docs, Notion, Airtable, CSV, RSS feed, YouTube channel (descriptions → pages). Auto-maps to site structure, preserves SEO metadata, handles redirects from old URLs. Extends `content_import.ts`.

**Why it's 10h+:** Per-source parser, content-to-section mapper, media migration, SEO metadata preservation, redirect generation, import validation/dry-run, incremental import.

### 34. AI FAQ Generator from Customer Conversations
**Impact 8 · Effort 20h · Diff 8 · Revenue 7**

Connect Chatwoot/Intercom/Zendesk → AI analyzes customer questions → generates FAQ page with real Q&A pairs, proper FAQPage JSON-LD schema. Updates as new questions emerge. "Your customers asked about pricing 47 times this month — add this to your FAQ." Extends `faq_from_reviews.ts`.

**Why it's 10h+:** Support ticket ingestion, question clustering/dedup, FAQ generation with accurate answers, JSON-LD generation, scheduled refresh, embedding for semantic search.

### 35. Lead Magnet & Gated Content System
**Impact 8 · Effort 20h · Diff 7 · Revenue 8**

Create downloadable content (PDF guides, checklists, templates) gated behind an email capture form. AI generates the lead magnet from existing site content. Form submission → Dittofeed contact + email delivery + CRM lead creation. Conversion analytics per magnet.

**Why it's 10h+:** PDF generation from content, email-gate integration, email delivery pipeline, conversion tracking, A/B test gate designs, lead scoring integration.

### 36. Multi-Format Content Repurposing Engine
**Impact 7 · Effort 25h · Diff 7 · Revenue 7**

Write once, publish everywhere: one blog post → LinkedIn version, Twitter thread, email newsletter, Instagram carousel script, short video script. Each format adapted to platform conventions. AI handles tone/length/format transformation. Extends `content_repurpose` patterns.

**Why it's 10h+:** Content extraction and chunking, format-specific templates, platform-aware tone adjustment, image generation for social variants, scheduling integration, analytics per format.


## 4. E-Commerce & Payments

### 37. Native Booking/Appointment Engine
**Impact 10 · Effort 40h · Diff 8 · Revenue 10**

Full appointment booking: service selection → calendar with availability → time slot picker → confirmation + reminder emails + SMS. Google Calendar/Outlook two-way sync. Timezone-aware, buffer between appointments, cancellation/reschedule policy, group events. Replaces Calendly/Acuity ($15-50/mo). `native_booking_engine/` module skeleton exists.

**Why it's 10h+:** Calendar sync engine, availability computation, timezone handling, booking lifecycle (create/confirm/reschedule/cancel), reminder pipeline, payment integration (Square for deposits), admin calendar view, embeddable widget.

### 38. Storefront/E-Commerce Engine
**Impact 9 · Effort 40h · Diff 7 · Revenue 10**

Simple e-commerce for service businesses and small retailers: product catalog, inventory management, shopping cart, Square/Stripe checkout, order management, digital downloads. Not competing with Shopify — targeting the "I sell 5-20 products and just need it to work" segment. `storefront_ecommerce/` module skeleton exists.

**Why it's 10h+:** Product catalog CRUD, inventory tracking, cart session management, checkout flow (Square Web Payments SDK), order lifecycle, digital delivery, tax calculation, shipping integration.

### 39. Dynamic Pricing & Discount Engine
**Impact 7 · Effort 25h · Diff 7 · Revenue 8**

Time-based pricing, early-bird discounts, volume discounts, coupon codes, membership pricing, bundle deals. Rules engine with conditions + actions. Works across bookings, storefront, and donations. Built on Lago metering + `billing.ts`.

**Why it's 10h+:** Rules engine with condition evaluator, discount types (percentage/fixed/free-shipping/BOGO), coupon generation and validation, stacking rules, time-window enforcement, usage limits.

### 40. Subscription & Membership Management
**Impact 8 · Effort 30h · Diff 7 · Revenue 9**

Recurring billing, member-only content/pages, membership tiers, member directory, subscription management (pause/cancel/upgrade/downgrade). Built on Stripe Billing + Clerk auth + D1. For gyms, associations, clubs, content creators.

**Why it's 10h+:** Subscription lifecycle, member-only content gating, tier management, member directory with profiles, payment method management, dunning management, member portal.

### 41. AI Payment Agent (Voice/Text Commerce)
**Impact 7 · Effort 25h · Diff 8 · Revenue 8**

"Pay $50 for the consultation" → AI agent processes the payment via Square, sends receipt. Voice-capable via Twilio/Deepgram. Full payment command → confirmation → receipt flow. Built on `ai_payment_command.ts` + `voice_agent.ts`. Safety-gated with human confirmation for charges >$100.

**Why it's 10h+:** Intent extraction from voice/text, payment method resolution, confirmation flow, receipt generation, voice TTS response, fraud detection, transaction audit log.

### 42. Invoice & Quote Generator
**Impact 7 · Effort 20h · Diff 6 · Revenue 7**

Generate professional invoices and quotes from site data + service catalog. Send via email, track status (sent/viewed/paid/overdue), accept payment via Square/Stripe. Invoice history, recurring invoice templates. PDF generation via pdf-lib.

**Why it's 10h+:** Invoice template system, line item management, tax/shipping calculation, PDF generation, email delivery, payment link embedding, status tracking, reminder automation.


## 5. Marketing & SEO Automation

### 43. Local SEO Power Suite
**Impact 10 · Effort 35h · Diff 8 · Revenue 9**

All-in-one local SEO management: (1) NAP sync across 50+ directories via API, (2) review monitoring across Google/Yelp/Facebook with AI-suggested replies, (3) Google Business Profile deep integration (posts, Q&A monitoring, insights), (4) local landing page auto-generation for multi-location businesses, (5) LocalBusiness JSON-LD with full markup. Extends `gbp_assist/` + `seo_autopilot/` modules.

**Why it's 10h+:** Multi-directory API integrations, review aggregation pipeline, AI reply suggestion, GBP API integration, landing page generator, citation consistency checker, ranking tracker.

### 44. Unified Social Inbox with AI Triage
**Impact 9 · Effort 35h · Diff 8 · Revenue 8**

Single inbox combining comments, DMs, mentions, and reviews from all connected platforms (Facebook, Instagram, Twitter/X, LinkedIn, Google Business Profile). AI triage: flags urgent messages, suggests replies, routes to team members. Eliminates 4-6 hours/week of cross-platform checking.

**Why it's 10h+:** Multi-platform streaming APIs, message normalization, AI classification (urgent/spam/question/ complaint), reply suggestion, team assignment, response time SLA tracking.

### 45. AI Social Media Agent with Human-in-the-Loop
**Impact 9 · Effort 40h · Diff 9 · Revenue 9**

Autonomous social media agent: monitors content calendar + industry news + competitor activity → proposes daily/weekly posts with captions, images, hashtags → human reviews and approves with one click → agent monitors engagement and suggests reply drafts. Weekly performance wrap-up. Reduces social media management time by 85%. Extends `social_auto_pilot.ts`.

**Why it's 10h+:** Content proposal engine, news/trend monitoring, engagement tracking, reply suggestion, performance analytics, approval workflow, multi-platform publishing, content recycling/evergreen queue.

### 46. Generative Engine Optimization (GEO) Toolkit
**Impact 9 · Effort 25h · Diff 9 · Revenue 8**

Optimize content for AI answer engines (ChatGPT, Gemini, Perplexity, Claude, Google AI Overviews). Dual scoring: traditional SEO + AI discoverability. Factual claim extraction, citation formatting, FAQ schema optimization, source authority scoring, AI visibility tracking. AI-referred sessions grew 527% YoY — this is the next SEO.

**Why it's 10h+:** AI visibility tracker (is content cited by major AI engines?), factual claim extraction, citation generator, answer-engine-specific formatting, dual-scoring content analyzer, competitive AI visibility benchmarking.

### 47. Automated Content Distribution Network
**Impact 7 · Effort 25h · Diff 7 · Revenue 7**

Publish a blog post → auto-distribute to: email newsletter, social media (platform-optimized formats), Medium, Dev.to, LinkedIn Articles, Reddit (appropriate subreddits), Quora. Track performance per channel. One-click publish everywhere.

**Why it's 10h+:** Per-platform content adaptation, API integrations, scheduling optimization per platform, performance tracking, canonical URL management, duplicate content prevention.

### 48. Smart Popup & Lead Capture Engine
**Impact 7 · Effort 20h · Diff 6 · Revenue 7**

Intelligent popups: exit-intent, scroll-depth, time-on-page, page-specific, source-specific. A/B test popup designs and offers. Lead capture → CRM/email list. Conversion analytics. No annoying "immediate popup" — behavior-triggered only.

**Why it's 10h+:** Trigger engine (exit-intent/scroll/time/source), variant management, A/B testing, lead capture integration, analytics dashboard, frequency capping, mobile optimization.

### 49. Review Generation & Management System
**Impact 8 · Effort 20h · Diff 7 · Revenue 7**

Automated review request campaigns: after purchase/appointment → email/SMS asking for review → links to Google/Yelp/Facebook. Negative review triage (private feedback form first). Review display widgets with schema markup. Review monitoring with alerts.

**Why it's 10h+:** Review request automation, multi-platform link generation, negative review triage flow, review widget generation, schema markup, monitoring/alerting, response template library.

### 50. Referral & Affiliate Program Engine
**Impact 7 · Effort 25h · Diff 7 · Revenue 8**

Customer referral program: unique referral links, reward tracking (discount/credit/cash), fraud detection, payout management. Affiliate program for influencers/partners. Dashboard for participants. Built on D1 tracking + Stripe Connect payouts.

**Why it's 10h+:** Referral link generation/tracking, reward calculation engine, fraud detection (self-referral, fake accounts), payout management, participant dashboard, campaign management, performance analytics.

### 51. Abandoned Cart/Form Recovery
**Impact 7 · Effort 15h · Diff 6 · Revenue 7**

Track partial form fills and abandoned carts. Auto-email with saved state: "You left items in your cart" or "Finish your booking — your details are saved." Recovery emails with one-click completion links. Recovery rate analytics.

**Why it's 10h+:** Form state capture (periodic save), abandoned detection (session timeout), recovery email generation with state restoration, one-click resume links, analytics dashboard, frequency capping.


## 6. Social Media Management

### 52. Multi-Platform Content Calendar with AI Planning
**Impact 9 · Effort 30h · Diff 7 · Revenue 8**

Visual content calendar across all connected platforms. Drag-to-reschedule. AI suggests optimal posting times per platform based on historical engagement. Content pillars and category balance tracking. "You post 80% promotional, 20% educational — aim for 50/50."

**Why it's 10h+:** Multi-platform calendar UI, posting time optimization engine, content category classifier, balance tracking, AI planning suggestions, team approval workflow.

### 53. Evergreen Content Recycling System
**Impact 7 · Effort 20h · Diff 7 · Revenue 7**

Mark posts as evergreen, set re-sharing cadence (every 30/60/90 days), auto-update timestamps, skip recently-served content. Only SocialBee offers this among major schedulers. Content lifecycle management: create → publish → recycle → retire.

**Why it's 10h+:** Content lifecycle state machine, recycling queue with frequency caps, duplicate detection, performance-based recycling priority, content freshness scoring, retirement policy.

### 54. Social Listening Lite
**Impact 8 · Effort 30h · Diff 8 · Revenue 8**

Monitor brand mentions + 5 keywords across social platforms. Sentiment analysis. Weekly digest email. Top mention alerts. Competitive mention tracking. Enterprise tools (Brandwatch, Sprout Social advanced) cost $500+/mo — this is the SMB-accessible version at $20-30/mo.

**Why it's 10h+:** Multi-platform mention streaming, sentiment analysis, entity extraction, digest generation, alerting engine, competitive tracking, historical trend analysis.

### 55. TikTok/Reels/Shorts Video Scheduler with AI Scripting
**Impact 7 · Effort 25h · Diff 7 · Revenue 7**

AI generates short-form video scripts optimized for TikTok/Reels/Shorts. Reminder-based scheduling (API limitations prevent direct publishing). Caption + hashtag + music suggestion. Performance tracking. Video idea generator based on trending formats.

**Why it's 10h+:** Script generation per platform format, trend analysis, reminder scheduling with push notifications, performance analytics, content library, hook/CTA optimization suggestions.

### 56. Account Safety & Session Isolation
**Impact 6 · Effort 15h · Diff 6 · Revenue 5**

When agencies manage 10+ client accounts, platforms flag them as suspicious. Documented session management, browser profile guidance, activity pattern analysis, warnings about behaviors that trigger bans. Not glamorous but critical for agency customers managing client accounts.

**Why it's 10h+:** Session architecture documentation, activity pattern analysis, warning system, browser profile management guide, IP/device fingerprinting education, platform-specific safety guides.


## 7. Analytics & Observability

### 57. Unified Marketing Dashboard
**Impact 10 · Effort 40h · Diff 8 · Revenue 9**

Single dashboard pulling: website analytics, email campaigns, social media posts, ad platforms (Google/Meta Ads), ecommerce. Widget-based customizable layout. Total traffic, leads, conversion rate, revenue attribution, cost per acquisition, ROI per channel. Replaces 3-4 separate analytics dashboards.

**Why it's 10h+:** Multi-source data connectors, data normalization engine, attribution modeling (first-touch/last-touch/linear/time-decay), widget framework, customizable dashboard, scheduled report generation.

### 58. Conversational Analytics AI
**Impact 9 · Effort 30h · Diff 9 · Revenue 8**

Natural language analytics: "How many people visited my site last week?" "Which email subject line got the most opens?" "Show me my top 5 pages by revenue." Text-to-SQL over Tinybird + D1, with cached metric definitions. Intuit Mailchimp and Xero both launched this in 2026 — it's becoming table stakes.

**Why it's 10h+:** NL-to-SQL engine, metric definition catalog, query caching, conversational UI component, context-aware follow-ups, result visualization, ambiguous query disambiguation.

### 59. Smart Alerting with Anomaly Detection
**Impact 8 · Effort 25h · Diff 8 · Revenue 7**

Not just "traffic went down" but contextual: "Traffic dropped 40% vs last Tuesday — this looks abnormal. Top 3 possible causes: (1) your Google Ads campaign ended, (2) your homepage returns 500 errors, (3) your SSL certificate expired." Baseline learning per metric. Configurable thresholds. Multi-channel alerts (email/SMS/in-app).

**Why it's 10h+:** Baseline computation per metric, anomaly detection (statistical + ML), root cause correlation, alert rule engine, notification dispatch, alert history/dashboard.

### 60. Funnel & Conversion Path Visualization
**Impact 8 · Effort 25h · Diff 7 · Revenue 7**

Visualize complete visitor journey: first visit → pages viewed → conversion point. Multi-touch attribution models. Segment-based funnels: how does journey differ for organic vs paid vs email visitors? Drop-off analysis with improvement suggestions. Built on PostHog + Tinybird.

**Why it's 10h+:** Journey reconstruction from events, funnel visualization, attribution model calculation, segment comparison, drop-off analysis, improvement suggestion engine.

### 61. Automated Client/Stakeholder Reports
**Impact 7 · Effort 20h · Diff 6 · Revenue 8**

White-label PDF reports auto-generated weekly/monthly. Executive summary with AI-written insights ("Traffic up 23% driven by your new blog content on X"). Charts, raw data, exportable. No-code report builder: pick metrics, date range, schedule, recipients. Agency gold.

**Why it's 10h+:** Report template system, AI insight generation, chart rendering, PDF generation, scheduling engine, white-label customization, multi-client management.

### 62. Industry Benchmarking
**Impact 7 · Effort 25h · Diff 8 · Revenue 7**

Anonymized aggregate data showing comparative performance: "Your site's conversion rate is 2.1% — 15% above the average for landscaping businesses." Percentile rankings across: traffic, engagement, conversion, SEO health. Requires building an aggregate data pool from platform users.

**Why it's 10h+:** Data anonymization pipeline, industry classification mapping, percentile computation, privacy-preserving aggregation (differential privacy), benchmark refresh scheduling, visualization.

### 63. Real-Time Site Change Detection & SEO Regression Alerts
**Impact 7 · Effort 15h · Diff 6 · Revenue 6**

Alert when changes cause SEO regressions: broken pages, missing schema, changed meta data, broken redirects, removed internal links. ContentKing charges $39/mo for this standalone. Native inclusion is a strong differentiator.

**Why it's 10h+:** Change detection crawler, SEO health scoring, regression detection rules, alerting engine, historical trend, comparison view, fix suggestions.


## 8. Developer Platform & API

### 64. Full Public REST API with Developer Portal
**Impact 9 · Effort 35h · Diff 8 · Revenue 9**

Public API for every platform capability: sites CRUD, content management, analytics, media, domains, billing, social publishing. Developer portal with docs, SDKs (TypeScript, Python), API keys (Unkey), rate limiting, usage dashboards. OpenAPI 3.1 spec derived from Zod schemas via `@asteasolutions/zod-to-openapi`. Extends `api.ts` + Unkey integration.

**Why it's 10h+:** API gateway with rate limiting, per-endpoint Zod→OpenAPI generation, developer portal UI, SDK generation (Stainless), API key management, usage analytics, webhook subscriptions, sandbox environment.

### 65. Webhook Engine with Guaranteed Delivery
**Impact 8 · Effort 30h · Diff 7 · Revenue 7**

Customer-configurable webhooks for every platform event: site.published, form.submitted, payment.completed, review.received, content.updated. Signature verification, retry with exponential backoff, dead-letter queue, delivery dashboard. Built on `outbound_webhooks.ts` + `webhook_dispatch.ts`.

**Why it's 10h+:** Event catalog, webhook subscription management, signature generation/verification, retry engine with backoff, dead-letter queue with replay, delivery analytics, payload templating.

### 66. GraphQL API for Site Content
**Impact 7 · Effort 25h · Diff 7 · Revenue 6**

GraphQL endpoint for site content: query pages, collections, media, settings with field selection. Perfect for headless CMS use cases. Built on Hono + GraphQL Yoga. Generated schema from Zod content types. Cacheable queries via CF Cache API.

**Why it's 10h+:** GraphQL schema generation from Zod, resolver auto-generation, query complexity analysis, persisted queries, CDN caching, playground UI.

### 67. CLI Tool for Site Management
**Impact 7 · Effort 20h · Diff 7 · Revenue 5**

`npx projectsites deploy`, `npx projectsites pull`, `npx projectsites logs`, `npx projectsites env`. Full CLI for developer workflows. Local dev server that mirrors production Worker. Built on the public API + `cli_sandbox_config.ts`.

**Why it's 10h+:** CLI framework (yargs/commander), authentication flow, local dev server with Miniflare, deploy pipeline, env management, log streaming, site scaffolding.

### 68. Custom Code Injection & Serverless Functions
**Impact 8 · Effort 30h · Diff 8 · Revenue 8**

Let developers write custom Worker code that runs in the site's isolate. Sandboxed, resource-limited, API-gated. Use cases: custom form handlers, API proxies, data transforms, webhook receivers, A/B test logic, custom redirects. Code editor with type definitions, testing, and deploy.

**Why it's 10h+:** Code sandbox (CF Sandbox SDK or isolated Worker), API surface for custom code, editor with types/LSP, testing/deploy pipeline, resource limits, security review, error handling.

### 69. GitHub/GitLab Sync for Site Content
**Impact 7 · Effort 20h · Diff 7 · Revenue 6**

Site content stored as markdown + YAML in a GitHub repo. Push to repo → site updates. Edit in dashboard → PR to repo. Content-as-code workflow for teams. Git-based version history. Branch → preview deploy. Builds on `git.ts` service.

**Why it's 10h+:** Git integration (push/pull/PR), content-to-markdown serializer, markdown-to-content parser, webhook receiver for push events, branch-to-preview mapping, merge conflict resolution UI.

### 70. Embeddable Site Components (Web Components)
**Impact 7 · Effort 25h · Diff 6 · Revenue 6**

Generate embeddable components from site content: booking widget, contact form, testimonial carousel, service menu, pricing table. Drop into any external site via `<script>` tag. Syncs with source site. Use case: a restaurant's menu widget embedded on a food delivery platform.

**Why it's 10h+:** Web Component generation, cross-origin data sync, theming/styling, responsive design, performance optimization, analytics passthrough, versioning.


## 9. Infrastructure & Operations

### 71. Global CDN & Edge Caching Rules Engine
**Impact 8 · Effort 25h · Diff 7 · Revenue 8**

Granular caching rules per site: cache TTL by content type, cache tags for purging, stale-while-revalidate, cache everything except auth endpoints. Edge-side includes for dynamic content in cached pages. Built on CF Cache API + Workers.

**Why it's 10h+:** Cache rule builder UI, cache tag system, purge by tag/URL/prefix, surrogate key support, edge-side includes, cache analytics (hit rate, bandwidth saved), cache warming.

### 72. Disaster Recovery & Cross-Region Failover
**Impact 8 · Effort 30h · Diff 7 · Revenue 8**

Multi-region D1 with read replicas. Automated failover. Point-in-time recovery within 30 days (D1 Time Travel). R2 cross-region replication. Automated backup verification (restore test weekly). DR runbook auto-generation. Status page integration.

**Why it's 10h+:** D1 read-replica provisioning, failover automation, backup verification pipeline, R2 cross-region sync, DR runbook generator, recovery time objective tracking, status page automation.

### 73. Automated Security Scanning & Patching
**Impact 8 · Effort 25h · Diff 7 · Revenue 7**

Weekly security scan of every generated site: dependency vulnerabilities (npm audit), CSP header validation, cookie security, HTTPS enforcement, exposed secrets, OWASP Top 10 checks. Auto-patch safe fixes, alert on manual-needed issues. Security score per site.

**Why it's 10h+:** Dependency scanner, CSP analyzer, header security checker, secret scanner, auto-patch pipeline, security scoring, alerting, compliance report generation.

### 74. Database Sharding & Tenant Isolation Framework
**Impact 8 · Effort 35h · Diff 8 · Revenue 7**

Automatic sharding of tenant D1 databases across multiple D1 instances as the platform scales to 100K+ sites. Shard router, capacity planning, rebalancing. Per-tenant isolation guarantee. Extends `db_sharding.ts` + `shard_connection.ts`.

**Why it's 10h+:** Shard router with consistent hashing, capacity monitoring, rebalancing automation, cross-shard query support, shard provisioning, migration coordination, tenant move tool.

### 75. Infrastructure-as-Code Site Provisioning
**Impact 7 · Effort 25h · Diff 7 · Revenue 6**

Every site's infrastructure (D1 database, KV namespace, R2 bucket prefix, Worker routes, DNS records) defined as code. Version-controlled, reproducible, auditable. `projectsites infra apply` provisions or updates. Drift detection between desired and actual state. Extends `provisioning_plan.ts`.

**Why it's 10h+:** IaC engine (HCL or YAML DSL), state management, drift detection, plan/apply workflow, rollback support, multi-environment support, audit logging.

### 76. Custom Domain Management 2.0
**Impact 7 · Effort 20h · Diff 6 · Revenue 7**

Full domain lifecycle: search → purchase → DNS configuration → SSL provisioning → verification. Bulk domain management. Domain transfer in/out. DNSSEC. Email forwarding. Subdomain management. Extends `domains.ts` + `domain_stack.ts`.

**Why it's 10h+:** Domain purchase flow (registrar API), DNS template system, bulk operations, transfer automation, DNSSEC management, email forwarding, expiry monitoring/renewal.

### 77. Traffic Spike Auto-Scaling & DDoS Protection
**Impact 7 · Effort 20h · Diff 7 · Revenue 6**

Automatic detection of traffic spikes. Rate limiting at edge. DDoS protection via CF. Origin shielding. Traffic prioritization (paying customers > free tier). Auto-scaling rules. Spike analytics. Load shedding for non-critical features under extreme load.

**Why it's 10h+:** Spike detection algorithm, rate limit rule automation, traffic prioritization, auto-scaling triggers, load shedding rules, analytics dashboard, alerting.


## 10. Business Operations & CRM

### 78. Built-in CRM with Lead Scoring
**Impact 10 · Effort 40h · Diff 8 · Revenue 10**

Contact profiles with full history: emails opened, pages visited, forms submitted, purchases made. Lead scoring (fit + engagement + behavior). Pipeline tracking (simple deal stages). Task management. Email integration (connect Gmail/Outlook). Replaces a separate CRM ($30-100/mo). Extends `crm_leads.ts` + `lead_pipeline.ts` + Twenty CRM integration.

**Why it's 10h+:** Contact profile with timeline, lead scoring engine (RFM + behavioral), pipeline management, task/workflow automation, email sync (IMAP/API), segmentation, CSV import/export, GDPR tools.

### 79. Customer Portal with Client-Specific Pages
**Impact 8 · Effort 30h · Diff 8 · Revenue 9**

Password-protected client portals: file delivery, invoice history, message board, appointment history, project updates. Each client sees only their content. Magic link auth (no password). Use case: agencies, consultants, law firms, therapists, accountants.

**Why it's 10h+:** Client isolation model, magic link auth per client, file sharing with permissions, message/notification system, portal customization per client, activity audit trail.

### 80. Unified Inbox 2.0 (Email + Chat + SMS + Social)
**Impact 9 · Effort 35h · Diff 8 · Revenue 8**

Single inbox for ALL customer communication: website contact forms, Chatwoot live chat, email replies, SMS, social media DMs/comments, WhatsApp. AI triage and suggested replies. Conversation assignment. Response time SLA tracking. Extends `inbox.ts` + `unified_inbox/` module.

**Why it's 10h+:** Multi-channel message ingestion, unified thread model, AI classification/routing, reply suggestion, assignment workflow, SLA tracking, conversation history, customer context sidebar.

### 81. Workflow Automation (If-This-Then-That for Business)
**Impact 9 · Effort 35h · Diff 8 · Revenue 9**

Visual automation builder: "When a contact form is submitted → create CRM contact → send welcome email → notify owner via SMS → create task to follow up in 2 days." Pre-built templates for common workflows. Trigger catalog (form submitted, payment received, appointment booked, review left, page published). Action catalog (send email, send SMS, create task, update CRM, post to Slack, call webhook).

**Why it's 10h+:** Visual workflow builder, trigger/action catalog, execution engine with retry, condition evaluator, template library, execution history/debugging, error handling.

### 82. Smart Contract & Proposal Generator
**Impact 7 · Effort 25h · Diff 7 · Revenue 8**

Generate service contracts, proposals, and SOWs from templates + site data + client info. E-signature integration (DocuSign/HelloSign). Track status (draft/sent/viewed/signed). Client portal for document access. Use case: service businesses, agencies, freelancers.

**Why it's 10h+:** Document template engine, variable substitution from CRM data, e-signature integration, document lifecycle tracking, client portal, template library by industry, PDF generation.

### 83. Team Collaboration & Permissions
**Impact 7 · Effort 25h · Diff 6 · Revenue 7**

Multi-user team accounts. Role-based access: Owner, Admin, Editor, Viewer, Billing. Per-feature permissions. Activity log (who did what when). Team mentions and comments on content. Approval workflows for publish. Extends `team_permission.ts`.

**Why it's 10h+:** RBAC engine with custom roles, permission granularity per feature, activity audit log, comment/mention system, approval workflow, team management UI, invitation system.

### 84. Customer Feedback & NPS System
**Impact 7 · Effort 20h · Diff 6 · Revenue 7**

Embed NPS surveys, collect feedback, analyze sentiment. Trigger surveys after key events (purchase, support ticket resolved, milestone reached). Dashboard with trends, sentiment analysis, key themes. Integrate feedback into lead scoring and churn prediction. Extends existing PostHog surveys.

**Why it's 10h+:** Survey builder, trigger engine, response collection, sentiment analysis, theme extraction, trend dashboard, integration with CRM lead scoring, churn risk flagging.


## 11. Advanced AI & Emerging Tech

### 85. Voice-Activated Site Management
**Impact 8 · Effort 30h · Diff 9 · Revenue 8**

"Hey ProjectSites, add a holiday closure notice to my homepage." Voice commands via Twilio phone call or in-browser microphone. Deepgram STT → intent parsing → action execution → Piper TTS response. Full voice interface for site management. Extends `voice_agent.ts` + `voice_orchestrator.ts`.

**Why it's 10h+:** Voice pipeline (STT→intent→action→TTS), Twilio integration, intent catalog for site operations, confirmation flow for mutations, multi-turn conversation management, accessibility use case.

### 86. AI Site Translation with Human Review
**Impact 8 · Effort 25h · Diff 7 · Revenue 8**

One-click translation of entire site into 10+ languages. Machine translation first pass (DeepL quality). Human review queue for each page. Translation memory for repeated phrases. Hreflang auto-generation. RTL layout for Arabic/Hebrew. Language switcher component. Extends `i18n.ts`.

**Why it's 10h+:** Translation pipeline per page, translation memory, review queue UI, hreflang generator, RTL CSS generation, language detection/redirect, translator collaboration, content change detection for re-translation.

### 87. AI Image & Video Generation Suite
**Impact 7 · Effort 25h · Diff 8 · Revenue 7**

Integrated media generation: hero images (DALL-E 3), section backgrounds (Stability AI), product photos (AI background removal + scene generation), social media graphics (Ideogram), short videos (Sora/Veo), logo variations (brand-consistent). Credit-gated premium feature. Extends `image_generation.ts` + `media.ts`.

**Why it's 10h+:** Multi-model orchestration, brand-consistent generation, credit metering, generation queue, preview/approval flow, media library integration, prompt template library per use case.

### 88. Predictive Churn Prevention
**Impact 8 · Effort 25h · Diff 8 · Revenue 9**

ML model predicts which customers are likely to churn based on: login frequency, site update cadence, support ticket volume, payment history, feature usage. Proactive outreach: "We noticed you haven't updated your site in 3 months — here's a free site refresh." Extends `churn_prediction.ts`.

**Why it's 10h+:** Feature engineering pipeline, churn model training/deployment, risk scoring, intervention recommendation engine, automated outreach integration, A/B test intervention effectiveness.

### 89. AI-Generated Case Studies from Customer Data
**Impact 7 · Effort 20h · Diff 8 · Revenue 7**

Analyze customer's business data (sales, growth, customer feedback) + website analytics → AI writes a compelling case study with metrics, quotes, and narrative. Multiple formats: web page, PDF, social media post, email. Review/approve before publish. Builds trust and social proof automatically.

**Why it's 10h+:** Data analysis for compelling metrics, narrative generation, quote extraction/synthesis, multi-format output, approval workflow, brand voice matching, fact verification step.

### 90. Knowledge Base & AI Chatbot from Site Content
**Impact 8 · Effort 25h · Diff 7 · Revenue 8**

Auto-generate a knowledge base from site content. Embed an AI chatbot that answers customer questions using only the site's content (no hallucination). Vectorize embeddings for semantic search. Chatbot can also perform actions (book appointment, check order status). Extends `rag.ts` + Chatwoot integration.

**Why it's 10h+:** Content-to-knowledge-base converter, Vectorize embedding pipeline, RAG chatbot with source attribution, action-execution capability (booking/order lookup), chatbot customization, analytics on chatbot effectiveness.

### 91. AI Competitor Monitoring & Alerting
**Impact 8 · Effort 25h · Diff 8 · Revenue 8**

Monitor competitor websites for changes: new pages, pricing changes, new services, design refresh, new testimonials, new team members. Weekly digest. Real-time alerts on significant changes. "Competitor X just launched a new service page — here's what they're offering." Built on `deepcrawl.ts` + `benchmark.ts`.

**Why it's 10h+:** Scheduled competitor crawling, change detection, significance classification, digest generation, alerting, competitive intelligence dashboard, historical trend.

### 92. Autonomous SEO Agent
**Impact 9 · Effort 35h · Diff 8 · Revenue 9**

A durable agent that continuously optimizes site SEO: monitors keyword rankings, suggests content improvements, builds internal links, optimizes meta tags, generates new content for keyword gaps, monitors backlinks, tracks competitors, adjusts strategy based on performance data. "Set it and forget it" SEO. Extends `seo_autopilot.ts`.

**Why it's 10h+:** Keyword rank tracking, content gap analyzer, internal link optimizer, meta tag optimizer, backlink monitor, competitor rank tracker, strategy adjustment engine, monthly performance report.

### 93. Accessibility Agent (Continuous Compliance)
**Impact 8 · Effort 25h · Diff 8 · Revenue 7**

Like the SEO agent, but for accessibility. Continuously monitors WCAG 2.2 AA compliance. Detects regressions on content changes. Auto-fixes safe issues (alt text, ARIA labels, heading hierarchy). Alerts on manual-needed issues. Generates accessibility statement and VPAT. ADA Title II compliance tracking.

**Why it's 10h+:** axe-core scheduled scanning, regression detection, auto-fix pipeline, manual issue tracking, compliance score dashboard, accessibility statement generator, VPAT generator, deadline tracking.

### 94. AI Logo & Brand Kit Generator
**Impact 7 · Effort 20h · Diff 7 · Revenue 7**

Generate complete brand kit from business description: logo (multiple variants), color palette, typography pairings, icon set, brand guidelines PDF. AI-generated with DALL-E/Ideogram + GPT-4o review. Human selects from 3-5 options. Extends `image_generation.ts` + brand research pipeline.

**Why it's 10h+:** Multi-variant logo generation, color palette extraction, font pairing recommendation, brand guidelines generation, preview across mockups (business card, site header, social), brand asset export.

### 95. Predictive Lead Scoring & Enrichment
**Impact 8 · Effort 25h · Diff 7 · Revenue 8**

Automatically score and enrich leads: company size, industry, revenue range, tech stack, social profiles. Behavioral scoring based on site interactions. Fit scoring based on ideal customer profile. Predict conversion likelihood. Route hot leads to sales. Extends `lead_scanner_score.ts` + `lead_propensity.ts`.

**Why it's 10h+:** Data enrichment APIs (Clearbit/People Data Labs), behavioral scoring model, fit scoring model, conversion prediction, lead routing rules, scoring transparency, model performance tracking.


## 12. Enterprise & Platform

### 96. Enterprise SSO & SCIM Provisioning
**Impact 8 · Effort 30h · Diff 7 · Revenue 9**

SAML/OIDC SSO. SCIM user provisioning/deprovisioning. Directory sync (Azure AD, Okta, Google Workspace). Per-organization IdP configuration. Just-in-time provisioning. Session management with IdP-initiated logout. Extends `sso_config.ts` + `sso_session.ts` + Better Auth enterprise.

**Why it's 10h+:** SAML SP implementation, OIDC RP, SCIM server, directory sync, IdP configuration UI, JIT provisioning, session management, compliance documentation (SOC 2, ISO 27001).

### 97. Audit Trail & Compliance Dashboard
**Impact 8 · Effort 25h · Diff 7 · Revenue 8**

Complete audit trail: who did what, when, from where, with what result. Immutable audit log in D1. Compliance dashboards for SOC 2, ISO 27001, GDPR, CCPA. Automated evidence collection for audits. Data retention policy enforcement. Extends `audit_trail.ts` + `audit.ts`.

**Why it's 10h+:** Immutable audit log, compliance framework mapping, evidence collection automation, data retention enforcement, compliance dashboard, audit report generation, alerting on policy violations.

### 98. Usage-Based Billing 2.0
**Impact 8 · Effort 30h · Diff 7 · Revenue 9**

Granular usage metering: API calls, build minutes, AI tokens, storage GB, bandwidth GB, email sends, SMS messages, social posts. Real-time usage dashboard. Budget alerts. Hard/soft caps. Overage billing. Usage forecasting. Built on Lago + `usage_metering.ts`.

**Why it's 10h+:** Multi-metric metering pipeline, real-time aggregation, budget alerting, cap enforcement, overage calculation, usage forecasting, customer-facing dashboard, invoice itemization.

### 99. Multi-Organization Management (Agency/Enterprise)
**Impact 8 · Effort 30h · Diff 7 · Revenue 9**

Manage multiple organizations from one account. Switch between orgs. Aggregate billing. Cross-org analytics. Centralized user management. Template and setting sharing across orgs. Agency: manage all client sites from one dashboard.

**Why it's 10h+:** Org switching, cross-org aggregation, centralized user management, template sharing, billing consolidation, permission model across orgs, activity audit per org.

### 100. Platform Status Page with Incident Management
**Impact 7 · Effort 20h · Diff 6 · Revenue 6**

Public status page (status.projectsites.dev). Automated incident detection from health checks. Incident creation, updates, resolution timeline. Subscriber notifications. Historical uptime. Component-level status. Built on `health_aggregator.ts` + `status_page_live/` module.

**Why it's 10h+:** Health check aggregation, incident detection/creation, status page UI, subscriber notifications, uptime calculation, incident timeline, postmortem template, API for customer status pages.

---

## Summary Matrix

| # | Idea | Impact | Hours | Diff | Revenue |
|---|------|--------|-------|------|---------|
| 1 | MCP Server Per Tenant Site | 10 | 35 | 10 | 9 |
| 2 | Autonomous Site Lifecycle Agent | 10 | 40 | 10 | 10 |
| 3 | AI Content Strategist | 9 | 30 | 9 | 8 |
| 4 | Multi-Agent Build Pipeline | 9 | 35 | 9 | 7 |
| 5 | Natural Language Site Management | 9 | 25 | 8 | 7 |
| 6 | AI-Driven A/B Testing Engine | 8 | 30 | 8 | 9 |
| 7 | Code Export to Self-Hosted CF | 10 | 20 | 10 | 6 |
| 8 | AI Website Critic | 8 | 20 | 8 | 6 |
| 9 | Per-Site AI Podcast | 7 | 25 | 8 | 7 |
| 10 | Behavioral Hero Personalization | 8 | 25 | 9 | 7 |
| 11 | AI-Generated Video Hero | 8 | 20 | 9 | 8 |
| 12 | White-Label Agency Mode | 9 | 30 | 7 | 10 |
| 13 | Agent-Native Plugin Marketplace | 8 | 35 | 9 | 8 |
| 14 | Per-Visitor PDF Brochure | 7 | 20 | 8 | 6 |
| 15 | Style Remix — AI Theme Variants | 7 | 20 | 7 | 7 |
| 16 | Visual Drag-and-Drop Builder | 9 | 40 | 7 | 8 |
| 17 | CMS Collections with Relationships | 10 | 35 | 8 | 9 |
| 18 | AI Site Structure Planner | 8 | 25 | 8 | 7 |
| 19 | Instant Preview Environments | 8 | 25 | 8 | 7 |
| 20 | Bulk Multi-Location Site Gen | 8 | 30 | 7 | 9 |
| 21 | Figma/Design Import | 7 | 35 | 8 | 7 |
| 22 | Multi-Language i18n | 9 | 30 | 7 | 8 |
| 23 | Programmatic SEO Pages | 8 | 25 | 7 | 8 |
| 24 | Real-Time Collaborative Editing | 7 | 40 | 8 | 6 |
| 25 | Accessibility Remediation Engine | 8 | 25 | 7 | 7 |
| 26 | AI Alt Text Generator | 7 | 15 | 6 | 5 |
| 27 | Template Marketplace | 7 | 30 | 7 | 8 |
| 28 | Visual Automation Builder | 10 | 40 | 9 | 10 |
| 29 | Universal Content Scheduler | 9 | 30 | 8 | 8 |
| 30 | Content Versioning | 8 | 25 | 7 | 7 |
| 31 | AI Content Rewriter | 8 | 20 | 7 | 7 |
| 32 | Content Freshness Monitor | 7 | 20 | 8 | 7 |
| 33 | Multi-Source Content Import | 7 | 25 | 7 | 6 |
| 34 | AI FAQ Generator | 8 | 20 | 8 | 7 |
| 35 | Lead Magnet System | 8 | 20 | 7 | 8 |
| 36 | Content Repurposing Engine | 7 | 25 | 7 | 7 |
| 37 | Native Booking Engine | 10 | 40 | 8 | 10 |
| 38 | Storefront/E-Commerce | 9 | 40 | 7 | 10 |
| 39 | Dynamic Pricing Engine | 7 | 25 | 7 | 8 |
| 40 | Subscription Management | 8 | 30 | 7 | 9 |
| 41 | AI Payment Agent | 7 | 25 | 8 | 8 |
| 42 | Invoice Generator | 7 | 20 | 6 | 7 |
| 43 | Local SEO Power Suite | 10 | 35 | 8 | 9 |
| 44 | Unified Social Inbox | 9 | 35 | 8 | 8 |
| 45 | AI Social Media Agent | 9 | 40 | 9 | 9 |
| 46 | GEO Toolkit | 9 | 25 | 9 | 8 |
| 47 | Content Distribution Network | 7 | 25 | 7 | 7 |
| 48 | Smart Popup Engine | 7 | 20 | 6 | 7 |
| 49 | Review Generation System | 8 | 20 | 7 | 7 |
| 50 | Referral Program Engine | 7 | 25 | 7 | 8 |
| 51 | Abandoned Cart Recovery | 7 | 15 | 6 | 7 |
| 52 | Content Calendar with AI | 9 | 30 | 7 | 8 |
| 53 | Evergreen Content Recycling | 7 | 20 | 7 | 7 |
| 54 | Social Listening Lite | 8 | 30 | 8 | 8 |
| 55 | Short-Form Video Scheduler | 7 | 25 | 7 | 7 |
| 56 | Account Safety System | 6 | 15 | 6 | 5 |
| 57 | Unified Marketing Dashboard | 10 | 40 | 8 | 9 |
| 58 | Conversational Analytics AI | 9 | 30 | 9 | 8 |
| 59 | Smart Alerting & Anomaly Detection | 8 | 25 | 8 | 7 |
| 60 | Funnel Visualization | 8 | 25 | 7 | 7 |
| 61 | Automated Client Reports | 7 | 20 | 6 | 8 |
| 62 | Industry Benchmarking | 7 | 25 | 8 | 7 |
| 63 | SEO Regression Alerts | 7 | 15 | 6 | 6 |
| 64 | Full Public REST API | 9 | 35 | 8 | 9 |
| 65 | Webhook Engine | 8 | 30 | 7 | 7 |
| 66 | GraphQL API | 7 | 25 | 7 | 6 |
| 67 | CLI Tool | 7 | 20 | 7 | 5 |
| 68 | Custom Code Injection | 8 | 30 | 8 | 8 |
| 69 | GitHub Content Sync | 7 | 20 | 7 | 6 |
| 70 | Embeddable Web Components | 7 | 25 | 6 | 6 |
| 71 | Edge Caching Rules Engine | 8 | 25 | 7 | 8 |
| 72 | Disaster Recovery | 8 | 30 | 7 | 8 |
| 73 | Security Scanning | 8 | 25 | 7 | 7 |
| 74 | DB Sharding Framework | 8 | 35 | 8 | 7 |
| 75 | IaC Site Provisioning | 7 | 25 | 7 | 6 |
| 76 | Domain Management 2.0 | 7 | 20 | 6 | 7 |
| 77 | Traffic Spike Protection | 7 | 20 | 7 | 6 |
| 78 | Built-in CRM | 10 | 40 | 8 | 10 |
| 79 | Customer Portal | 8 | 30 | 8 | 9 |
| 80 | Unified Inbox 2.0 | 9 | 35 | 8 | 8 |
| 81 | Workflow Automation | 9 | 35 | 8 | 9 |
| 82 | Contract Generator | 7 | 25 | 7 | 8 |
| 83 | Team Collaboration | 7 | 25 | 6 | 7 |
| 84 | NPS System | 7 | 20 | 6 | 7 |
| 85 | Voice Site Management | 8 | 30 | 9 | 8 |
| 86 | AI Site Translation | 8 | 25 | 7 | 8 |
| 87 | AI Media Generation Suite | 7 | 25 | 8 | 7 |
| 88 | Predictive Churn Prevention | 8 | 25 | 8 | 9 |
| 89 | AI Case Studies | 7 | 20 | 8 | 7 |
| 90 | Knowledge Base Chatbot | 8 | 25 | 7 | 8 |
| 91 | Competitor Monitoring | 8 | 25 | 8 | 8 |
| 92 | Autonomous SEO Agent | 9 | 35 | 8 | 9 |
| 93 | Accessibility Agent | 8 | 25 | 8 | 7 |
| 94 | AI Brand Kit Generator | 7 | 20 | 7 | 7 |
| 95 | Predictive Lead Scoring | 8 | 25 | 7 | 8 |
| 96 | Enterprise SSO & SCIM | 8 | 30 | 7 | 9 |
| 97 | Audit Trail & Compliance | 8 | 25 | 7 | 8 |
| 98 | Usage-Based Billing 2.0 | 8 | 30 | 7 | 9 |
| 99 | Multi-Org Management | 8 | 30 | 7 | 9 |
| 100 | Platform Status Page | 7 | 20 | 6 | 6 |

**Grand totals:** 100 ideas · ~2,700 total dev-hours · 51 already have skeleton services/modules in codebase

---

## Top 20 by ROI Density (Impact × Differentiation / Effort)

1. **Code Export to Self-Hosted CF** (#7) — 5.00
2. **AI Content Strategist** (#3) — 2.70
3. **MCP Server Per Tenant** (#1) — 2.86
4. **GEO Toolkit** (#46) — 3.24
5. **Autonomous Site Lifecycle Agent** (#2) — 2.50
6. **Behavioral Hero Personalization** (#10) — 2.88
7. **AI Website Critic** (#8) — 3.20
8. **Natural Language Site Management** (#5) — 2.88
9. **CMS Collections** (#17) — 2.29
10. **AI Social Media Agent** (#45) — 2.03
11. **Visual Automation Builder** (#28) — 2.25
12. **Conversational Analytics AI** (#58) — 2.70
13. **Local SEO Power Suite** (#43) — 2.29
14. **Autonomous SEO Agent** (#92) — 2.06
15. **AI-Generated Video Hero** (#11) — 3.60
16. **Native Booking Engine** (#37) — 2.00
17. **Built-in CRM** (#78) — 2.00
18. **Multi-Agent Build Pipeline** (#4) — 2.31
19. **Unified Marketing Dashboard** (#57) — 2.00
20. **White-Label Agency Mode** (#12) — 2.10
