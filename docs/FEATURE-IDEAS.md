# Feature Ideas — Consolidated Backlog

Replaces the former `cx-improvements/*` + `page-improvements/editor-100.md`. Priority: **P0** ship now · P1 next · P2 later. Long-tail collapsed — full ranked lists in git history.

---

## 1. AI-Endpoints IDE — `/admin/ai-endpoints`

> Bar: Cursor / Zed / VS Code Web / Bolt / v0. CodeMirror 6, lazy extensions, IDE chunk ≤320KB gz.

Best ideas (all P0): multi-cursor (Alt-click + Cmd-D); find & replace (`@codemirror/search`, regex/case/whole-word); bracket-pair color + auto-close; format-on-save (Prettier-lite, debounced) + auto-save 500ms + "Saved · 2s ago" pill; Cmd+P fuzzy file finder; F2 inline rename; right-click tree menu; drag-reorder; search files & content (Cmd+Shift+F); tabs (Cmd+E recent, Cmd+1-4 jump, middle-click close, pin, dirty-dot); breadcrumb bar with symbol jump; command palette (Cmd+Shift+P) + line ops (Alt+↑↓ move, Shift+Alt dup, Cmd+L select, Cmd+G goto); side AI Chat (project context ≤16k chars) + Cmd+I inline AI (Explain/Rewrite/Add tests/Optimise); AI client-snippet generator (cURL/Python/JS/TS/Rust) + embed-widget generator per endpoint; deploy progress drawer (SSE log) + rollback drawer (last 10) + env-var editor (reveal-once secrets); KV/R2/D1 binding browser; cron visualiser; status bar + problems panel + terminal (`wrangler tail` via SSE) + theme picker + settings (Cmd+,). Lazy-load CM6 packs; build-fail gate >320KB gz; full keyboard access; reduced-motion.

P1/P2: Vim/Emacs keymaps, sticky scroll, split editors, minimap, git gutter+blame, AI cost estimator, agent fix-loop, code lens — plus ~60 more in git history.

---

## 2. Stripe Payment Buttons (P0) — inline checkout on customer sites

> Owner connects Stripe (Connect, shipped), creates products in `/admin/products`, drops `<a class="ps-buy-button">`. Visitor clicks → Stripe Checkout → webhook records order.

Best P0: D1 `site_products` + `site_orders` (price_cents, currency, image_url, FK to sites); `POST/GET/PATCH/DELETE /api/sites/:siteId/products` (CRUD + Stripe sync); `POST /api/sites/:slug/checkout` (public, owner acct, 1.5% platform fee); webhook `checkout.session.completed` on connected accounts → upsert `site_orders`; `/admin/products` Angular (list + create modal + edit + delete + orders panel + image upload). P1/P2: multi-currency, inventory, variants, Stripe Tax, shipping, discount codes, inline Elements modal, Apple/Google Pay, subscriptions, refund button, CSV export, abandoned-cart cron, digital downloads, AI description/photo gen, AI price suggestion — ~35 more in git history.

### P0 acceptance criteria
- [ ] Migration `0026_live_site_features.sql` adds `site_products` + `site_orders`.
- [ ] `POST /api/sites/:siteId/products` → 201 + Stripe product ID + price ID.
- [ ] `POST /api/sites/:slug/checkout` → valid Checkout URL (mode=payment, application_fee_amount=1.5%).
- [ ] Webhook upserts `site_orders` on `checkout.session.completed`.
- [ ] `/admin/products` lists/creates/edits/deletes with image upload.
- [ ] Unit tests 8+ (CRUD, checkout, webhook, fee math, FK). E2E: create product → buy button → checkout → mock webhook → order appears.

---

## 3. AI-Chat KB Auto-Trained (P0) — widget answers from site content

> Every publish reindexes paragraphs/headings into `site_kb_chunks`, embeddings in D1, retrieval via in-process cosine → top-5 chunks injected into the LLM prompt.

Best P0: D1 `site_kb_chunks(id, site_id, text, embedding BLOB, source_url, source_section, indexed_at)`; `kb_indexer.ts` (extract from R2 HTML, chunk ≤512 chars, embed `@cf/baai/bge-base-en-v1.5`); `kb_retriever.ts` (embed query, cosine scan, top-5); workflow step `index-kb` on publish (non-blocking); extend `/api/sites/:slug/chat` to inject chunks; admin `GET/POST .../kb`, `.../kb/reindex`, `.../kb/test`. P1/P2: chunk dedup (SHA-256), PDF/DOCX upload, hybrid BM25+cosine RRF, cross-encoder rerank, citations, feedback, per-locale KB, anti-prompt-injection, PII redaction, knowledge-gap detector, RAG eval harness, Vectorize at >500 chunks, voice, WhatsApp/SMS — ~30 more in git history.

### P0 acceptance criteria
- [ ] Migration `0026_live_site_features.sql` adds `site_kb_chunks`.
- [ ] `kb_indexer.indexSite(siteId)` writes ≥1 chunk for any non-empty site.
- [ ] `kb_retriever.retrieveTop(siteId, query, 5)` returns 5 most similar.
- [ ] Workflow step `index-kb`; failure does NOT block publish.
- [ ] Chat endpoint injects chunks; graceful fallback when KB empty.
- [ ] `/admin/settings` → AI Chat → AI Knowledge: count + sample + reindex + tester.
- [ ] Unit tests 6+ (chunking, embed, cosine, top-k, dedup, retrieval). E2E: publish → indexed → admin count → tester answers.

---

## 4. Industry-Benchmark Overlay (P0) — `/admin/analytics`

> "Your conversion rate (3.2%) vs salons (2.1% avg)" with dashed p50 line + AI commentary below p50.

Best P0: D1 `industry_benchmarks(industry, metric, p50, p75, p90, p99, samples_count, updated_at)`; seed 10 industries × 5 metrics (conversion_rate, bounce_rate, avg_session_duration_sec, pages_per_session, mobile_share); `GET /api/admin/analytics/benchmarks?industry=salon` + `.../recommendation` (AI tip when < p50); service `industry_benchmarks.ts` (`getBenchmark`, `getAllForIndustry`, `recommendFor`); frontend dashed p50 overlay + chip + inline AI commentary; industry inference from cached `site.industry`. P1/P2: monthly anonymized aggregation cron, sub-industry/geo/size brackets, seasonality, peer cohort, "beat the benchmark" badges, AI action plan to p75, Lighthouse benchmarks, revenue-per-visitor + AOV, confidence intervals, PDF export — ~40 more in git history.

### P0 acceptance criteria
- [ ] Migration adds `industry_benchmarks` + seed 10×5.
- [ ] `GET /api/admin/analytics/benchmarks` → valid JSON all metrics.
- [ ] Analytics overlays dashed industry line per chart.
- [ ] Below-p50 commentary chip with AI 1-sentence tip.
- [ ] Unit tests 5+ (lookup, percentile math, inference, missing-industry graceful). E2E: open `/admin/analytics` → chip visible → AI tip below p50.

---

## 5. bolt.diy Editor — `/admin` editor section (iframe + postMessage)

> Bar: bolt.diy, StackBlitz, CodeSandbox, v0, Replit, Lovable, Cursor Composer.

Best ideas (all P0): device toolbar (Mobile/Tablet/Desktop/Fluid) + custom width + orientation flip; floating AI command bar (Cmd+K) + inline AI suggestion banner + quick-prompt chips + undo last AI (`PS_UNDO_AI`); save-state indicator + last-saved timestamp + auto-save countdown; deploy FAB + build/deploy status pill click-to-logs; Lighthouse mini-card + axe-core scanner + iframe console capture; page navigator (route thumbnails) + Cmd+P quick-find + site-stats mini-card; element inspector (click → source path + classes); keyboard cheatsheet (`?`), Cmd+S Save&Deploy, Cmd+Shift+R reload; iframe load-failure fallback + retry + health dot; first-visit guided tour. P1/P2: dual viewport, named snapshots + version diff + rollback, inline text/color/spacing/font edit, SEO sidebar, broken-link checker, presence + comment-on-element, focus mode, command palette, auto-reconnect, crash-report bundler, restore unsaved buffer — plus ~80 more in git history.

### P0 implementation set
20 P0 items behind one `EditorToolbarComponent` mounted above the iframe + reactive signals on `AdminEditorComponent`. Covered by `e2e/admin-editor.spec.ts` + `editor.component.spec.ts`.
