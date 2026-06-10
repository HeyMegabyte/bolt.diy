# Admin Page Notes

Consolidated backlog for all `/admin/*` sections. Items are unshipped and actionable; already-shipped (✅ / WIRED / T20) items are omitted. One section per page, ≤6 bullets each.

---

### Analytics

- **Funnel enhancements** — time-window selector, A/B funnel comparison, custom-event funnel builder, holdout-group overlay, and cohort drill-down with revenue overlay.
- **Attribution + segmentation** — first/last-touch attribution, channel groupings, "From AI search" segment, event taxonomy linter, and behavioral clustering.
- **Live + geo** — real-time visitor list with current URL, country choropleth map, spike alert (PostHog → Slack), browser/OS table, and scroll-depth heatmap.
- **AI + NL** — natural-language query bar ("show sessions where scroll > 50%"), AI search citation rate, revenue-per-cohort overlay, and automated Lighthouse timeline.
- **Sharing + embedding** — public share link for individual charts, embeddable `<iframe>` chart, webhook-on-alert, and dashboard layout customizer (drag-resize panels).
- **Cost metrics** — AI cost per conversion, cheapest-equivalent-model suggestion (from AI Traces), and YoY shadow comparison line on the main trend chart.

---

### AI Endpoints IDE

- **Editor ergonomics** — hover JSDoc tooltip, sticky scroll, code-folding gutters, word-wrap toggle, Vim/Emacs keymap, indent guides, inlay hints.
- **File management** — right-click "New file here", duplicate file, file icons by extension, reveal in explorer, auto-create missing folder, recently-deleted bin, tree filter.
- **Tabs** — pin tabs, close-tabs-to-right/left, drag-reorder tabs, tab overflow scroll, middle-click closes, numbered tab nav.
- **AI features** — AI test scaffolder, AI naming assistant, "Explain this error" inline button, diff-mode suggestion preview, "Ask about selection" command.
- **Deploy / safety** — deploy gate (block deploy when linting errors exist), auto-rollback toggle, snapshot view before publish, export/import endpoint as zip.
- **Discoverability** — onboarding checklist, endpoint READMEs per route, customizable keybindings UI, command palette typeahead improvements.

---

### AI Traces

- **Cost intelligence** — per-org budget caps, cost-per-conversion attribution, cheapest-equivalent-model suggestion, token-usage heatmap by hour, cost diff vs previous period, top-10 most expensive traces.
- **Latency + perf** — TTFT chart, throughput trend, model-router fallback latency, cold-start vs warm, geo-region latency split, cache-hit delta, per-tool latency breakdown.
- **Error triage** — error taxonomy auto-classifier, one-click "retry with same input", stack-trace deep-link to Sentry, auto-create GitHub issue from recurring error, silent-failure and truncation detectors.
- **Search + navigation** — NL search ("show yesterday's failed chat turns > 2s"), faceted sidebar, URL-shareable filter state, "Find similar traces" via embedding, regex mode.
- **Annotation + workflow** — mark as ground-truth example, assign to engineer, move to investigation queue, approval workflow for annotations, severity tagging, audit log.
- **Alerts + safety** — EWMA-based drift detector, PII leak detector, toxicity classifier, cost/latency spike alerts, token-budget exhaustion warning, Slack notification on error burst.

---

### Audit

- **Filter UX** — URL-state sync for active filters, hide-noisy-actions toggle, schema-aware metadata renderer, right-click context menu, inline target preview.
- **Export + compliance** — signed export bundle (HMAC), NDJSON streaming export, PDF compliance report, SCIM/SIEM forwarding, GDPR PII-redaction toggle, role-based column visibility.
- **AI assist** — "Explain this event" AI button, behavioral clustering, workflow-failure correlation, insider-threat scoring.
- **Visualizations** — funnel view, Sankey diagram, compare-periods overlay, top-N actors panel.
- **Notifications** — Slack/Teams/Discord webhooks, PagerDuty, browser push, RSS/Atom feed, burst-rate limiter.
- **Investigation** — time-travel scrubber, investigation cases, chain-of-custody tracking, PostHog session replay deep-link, DuckDB-Wasm for archive queries.

---

### Billing

- **Insights** — plan recommendation engine, cost-anomaly detector with Slack alert, per-site monthly cost sparkline, forecast confidence intervals, YTD summary card.
- **Budget controls** — dollar-mode budget cap (not just token %), hard-stop vs soft-warn toggle, auto top-up, pause-spend kill switch.
- **Invoicing** — per-site invoice PDF download, CFO-friendly PDF report, tax-document download, ACH/bank-debit payment method.
- **Enterprise** — PO number field, net-30 payment terms, volume-discount calculator, enterprise quote form, SOC2/ISO download links, DPA download, region selector.
- **Per-prompt ledger** — per-prompt cost line-item view, cache-hit savings counter, currency selector for multi-currency plans.
- **Cancel + plan changes** — cancel-flow with exit-reason capture, plan-change effective-date picker, invoice email recipient list editor.

---

### Docs (API Explorer)

- **History + bookmarks** — star/name/export history items, compare two responses side-by-side, recently-viewed and pinned endpoints, per-endpoint open issues/PRs link.
- **Snippets + clients** — SDK-style snippets with retry+timeout, HTTP/2 variants, async/await, download Postman/Insomnia/Bruno/Hoppscotch, generate TS/Python/Go/Zod clients.
- **Navigation** — fuzzy-match nav, method/tag/auth filter chips, URL-sync search, J/K keyboard navigation, per-tag intro card, "most-asked" endpoints leaderboard.
- **Request builder** — body templates dropdown, beautify/minify JSON, variable interpolation, per-endpoint env profiles, cURL→form parser, GraphQL playground, WebSocket panel, SSE streaming reader.
- **Response tools** — JSON path picker, response-vs-schema validator, response diff, save response, render Markdown/image/PDF bodies, response chart, latency waterfall.
- **Discovery + onboarding** — "Tour" overlay, suggested-next-call recommendation, curated endpoint playlists, sample data button, per-endpoint usage analytics.

---

### Domains

- **Bulk operations** — bulk "Make primary" with disabled tooltip, bulk transfer-out, bulk-tag, bulk-set TTL, select-all-in-status, keyboard range-select Shift+click.
- **DNS advisor** — WHOIS lookup, CAA record advisor, apex vs www advisor, TTL recommendation, DNS propagation visualizer, DNSSEC status panel.
- **Email / routing** — per-rule anti-spam/disposable-alias/mailing-list/auto-responder config, email-forwarding wizard (already wired) enhancements: per-domain reply-from override.
- **Health + security** — multi-region latency panel, blacklist check, phishing/Safe-Browsing status badge, cert-transparency delta, right-click context menu per row.
- **Per-domain site config** — redirect-map editor, header-overrides, robots.txt inline editor, bulk-subdomain import, wildcard subdomain rule, subdomain templates, save favorites in AI search.
- **TLD search** — TLD filter chips, price-range filter, bulk multi-select register flow, "Show similar" TLDs, brand-fit score, trademark check badge, transfer step indicator.

---

### Editor (bolt.diy iframe)

- **Viewport controls** — DPR toggle, throttle-network selector, safe-area outline, user-agent spoof selector, picture-in-picture detach.
- **AI assist** — rotate AI suggestions, "Apply to this section only" mode, inline AI chat dock, streaming token preview, voice prompt input, @route/#section autocomplete.
- **Version management** — per-version diff preview, pin version, compare current→historical, auto-name versions by diff, version tagging, branch-from-snapshot, time-travel slider.
- **Route inspector** — mini-thumbnails per route, drag-and-drop route reorder, Add route button, route right-click context, LCP/CLS/INP badges per route, color-code by audit status.
- **Visual overlay** — click-to-coordinate overlay, color picker/dropper, font-swap quick switcher, snapping rulers, section delete with undo, duplicate-section, drag-reorder sections.
- **Quality sidebar** — one-click a11y fix buttons, SEO score sidebar, brand-consistency checker, "Compare 3 variations" generator, copy-readability gauge, continuous Lighthouse.

---

### Forms (Inbox/CRM)

- **Lead management** — flag/priority levels, auto-archive ghosted leads (30-day inactivity), assign to teammate, activity timeline per lead, drag-and-drop kanban view.
- **Messaging** — schedule-send / send-later queue, per-user email signature, link click tracking, send Loom video reply, collapse old messages thread.
- **Search + filter** — field-specific search (message contains / from / subject), IP filter, negative filters, NL search, language detection + auto-translate, duplicate detection.
- **AI actions** — "Re-run AI" per row (re-classify intent + spam), schedule callback via Cal.com, subscribe-to-newsletter one-click, partner referral one-click.
- **Analytics** — form-level conversion rate, best-day/best-hour heatmap, response-time SLA tracker, won-revenue total, spam ratio trend, AI confidence histogram, template performance.
- **Config + UX** — per-form auto-reply template, per-form notification email routing, Slack/Discord webhook preview, density toggle (compact/comfortable), mobile bottom-sheet detail panel.

---

### Milestones

- **Rule management** — milestone-rule library (reusable templates), drag-reorder pinned rules, multi-select bulk actions, per-rule notification/recipient/cooldown overrides.
- **AI-generated content** — AI-suggested next milestone, AI-written share copy, auto-draft investor update, auto-draft founder letter, annual-report photo gallery.
- **Social + celebration** — auto-tweet/LinkedIn/Discord/Slack on milestone hit, confetti matches brand colors, voice celebration, discount-code earned per milestone, profile-XP bar.
- **Timeline + analytics** — achievement timeline animation, per-metric trend chart, trend-anomaly callouts, heatmap of day-of-week, time-of-day patterns.
- **Sharing** — public-shareable milestone page, embeddable widget, download share image, print/frame-able PDF certificate, notify accountability buddy, public hall-of-fame.
- **Gamification** — unlock-feature per milestone, level-up animation, AI-coach reflection prompt, journal/voice-memo/photo attached to milestone, annual-recap reel.

---

### Products

- **Catalog richness** — multi-image gallery, video/3D model upload, AR preview, tags/categories, collections, cross-sell/up-sell recommendations, bundle builder.
- **Inventory + variants** — variant image/stock/SKU/price/weight override, inventory holds, backorder toggle, pre-order release-date, made-to-order lead time, restocking notifications.
- **Product types** — gift-card, digital-download, license-key, membership, donation/tip-jar product type toggles; subscription/recurring product toggle.
- **SEO + schema** — per-product OG-image editor, Schema.org JSON-LD preview, slug editor, custom CSS per product, per-product alt text via AI generation.
- **Orders + fulfillment** — shipping-label print, tracking-number field, customer-comm thread per order, refund/partial-refund button, issue store-credit, CSV-import error preview.
- **Integrations** — auto-sync with Square/Shopify/WooCommerce, print-on-demand, wholesale/B2B pricing, min/max order quantity, Apple Pay/Google Pay/BNPL toggles.

---

### Settings

- **Tab navigation** — tab badges with pending counts, sticky sub-nav, mobile bottom-sheet tab picker, "last visited" tab persisted to localStorage.
- **Import / export / diff** — diff against org golden template, apply diff partially, export to YAML/TOML, import history log, per-environment column with inheritance arrows, promote staging→prod.
- **Team management** — resend-invite button, magic-link copy, per-member 2FA enrollment status, SCIM/SSO provisioning, SAML group→role mapping, owner transfer wizard, member activity timeline, suspend member.
- **AI persona** — system-prompt version history, per-language persona variants, A/B-test two personas, prompt-injection lint, knowledge-file freshness column.
- **MCP grid** — per-MCP last-call + error rate, per-MCP token-rotation reminder, bulk-disconnect MCPs, MCP health-check per row, MCP-quota indicator, deferred-load for large MCP grid.
- **Danger zone / a11y** — soft-delete grace window, self-service undelete, schedule a future deletion, skip-link, live-region toast, prefers-reduced-motion kill, Lighthouse perf budget per tab.

---

### Snapshots

- **View options** — compact/comfortable/expanded density toggle, table-view alternative, group by week, pinned snapshots row, virtual scroll when >50 rows, empty-search illustration.
- **Promotion workflow** — auto-rollback policy editor, schedule a promotion, promotion approval workflow, promote with dry-run preview, canary promote, instant rollback button.
- **Diff + review** — side-by-side HTML diff (Monaco), CSS diff, JSON diff, visual screenshot diff, "Files changed" count, AI-generated changelog summary, threaded comments on diff lines.
- **Metadata + naming** — semver hint when auto-naming, lock production snapshots, auto-tag "last-known-good", star/favorite, folder/grouping by release train, "Why was this deleted" required reason field.
- **Quality metrics** — Lighthouse score chip, bundle-size delta, Web Vitals delta, cold-start latency chart, top-3 errors panel, error-rate sparkline, crash-free sessions %.
- **Integrations** — GitHub Release → snapshot mapping, "Push tag" on promote, PR-preview deploys, fork-from-snapshot, webhook on snapshot events, API key + CLI command shown per snapshot.

---

### User Settings

- **Profile** — cover-image upload, bio markdown editor, social-links list, public profile URL toggle, vanity slug, avatar from Gravatar, AI portrait generator, phone-number with country-code dropdown.
- **Locale + display** — locale autocomplete, 12h vs 24h toggle, week-starts-on toggle, number format preference, currency-display preference, color-blind palette mode.
- **Accessibility** — reduced-transparency toggle, text-size slider, cursor-size slider, focus-ring intensity slider, prefers-reduced-motion linked to motion-intensity.
- **Layout preferences** — sticky-header toggle, sidebar default-collapsed, tab-vs-panel layout toggle, auto-save delay slider, confirmation-prompts toggle, default sort order per table, saved filter presets.
- **Editor preferences** — editor tab-size, word-wrap, minimap, keymap, diff-view default, markdown-preview side-by-side, auto-link domains, spell-check, AI-write-with-me opt-in.
- **Privacy + compliance** — Sentry/PostHog/GA opt-out granular toggles, CCPA "Do not sell", GDPR consent log download, cookie preferences center, telemetry opt-out, sign-out-everywhere button.
