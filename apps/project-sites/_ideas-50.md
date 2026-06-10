# 50 AI Product Ideas — projectsites.dev (2026-06-09)

Ordered by value. Every item ≥30h dev. Grounded in repo audit + web research (Cloudflare Agents SDK, Veo/Sora, ACP, GEO, computer-use, evals) + competitor whitespace.

## Tier S — Transformational / differentiating

1. **Bundled AI voice receptionist, provisioned at publish** — trained on the generated site's content, answers calls 24/7, books appointments, captures leads. Voice scaffolding exists (`voice_agent.ts`) but no booking loop; standalone category grew 340% YoY ($25–300/mo) and NO builder bundles it. (~70h)
2. **Post-publish autonomous growth agent** — ongoing agent monitors Google Business Profile reviews, competitor pages, drafts replies + social posts, flags "competitor changed pricing." Retention moat; nobody runs a continuous agentic growth layer for SMB. (~80h)
3. **Native booking engine** — catalog-confirmed missing; calendar availability, deposits via the payments rail, confirmation email, TCPA consent. Table-stakes conversion surface for service SMBs. (~70h)
4. **AI-native GEO layer bundled into hosting** — auto-generate citation-bait content (FAQ clusters, expert quotes, structured-data) + track whether ChatGPT/Perplexity/AI-Overviews cite the business. Writesonic charges $199/mo for tracking ALONE. (~50h)
5. **Live operational data baked into pages** — connector layer wiring Google Calendar "next available slot," POS specials, real-time inventory into generated pages. No builder auto-wires live ops data. (~50h)
6. **Visitor-facing AI concierge actually injected into published sites** — `routes/concierge.ts` works server-side but the widget is never auto-injected at serving time, so visitors can't invoke it. Highest-ROI gap to close. (~40h)
7. **Embedded visitor analytics with beacon injection + admin dashboard** — `visitor_events_core`/`site_analytics` exist but flag-off with no beacon in published HTML; owners have zero live traffic data. (~40h)
8. **Edge per-visitor personalization** — Workers reads geo/referrer/device/session at the edge → AI-selected hero image+headline+CTA with no JS overhead. Conversion lift; nobody does AI hero-swap at the CDN for SMB. (~40h)
9. **Visual canvas editing (no-token)** — point-and-click brand/copy edits without burning AI tokens (Lovable "Visual Edits" parity); today post-gen editing is code-editor-only. (~55h)
10. **AI multilingual locale mirrors at publish** — ACS demographic data near the business address triggers `/{locale}/*` mirrors + hreflang automatically. Platform mandate + whitespace + serves underserved communities. (~50h)

## Tier A — Strong

11. **LLM eval + regression harness in CI** — Braintrust-style "failed generation → test case"; evals gate every prompt/model change. Quality moat against silent regressions. (~40h)
12. **Real-time content guardrails on every published block** — Galileo Luna-2-class hallucination/PII/injection detection catches fabricated business claims before they go live. (~40h)
13. **Unified payments rail** — shared idempotency seam + webhook dedup + cross-provider reconciliation across Square/Stripe/Connect; prevents double-charge / dropped charges. (~50h)
14. **URL-to-site cloning** — paste a competitor URL → rebuilt + improved on our stack (10Web parity). Acquisition + benchmarking. (~40h)
15. **AI Code Components** — describe an interactive widget (pricing calculator, multi-step form, gallery) → validated on-brand component (Webflow AI parity). (~50h)
16. **Real-time multi-user collaborative editing** — team co-edit one site with locking/conflict resolution; unlocks team seats already scaffolded. (~70h)
17. **Computer-use QA agent** — Claude Computer Use loads the LIVE published site in a real browser, runs axe + Lighthouse, screenshots all 6 breakpoints, returns structured pass/fail. (~40h)
18. **Hyper-local SEO autopilot** — generate + publish neighborhood landing pages (`/services/plumber-lincoln-park`), schema-mark, submit to directories, monitor map-pack rank. (~50h)
19. **Missed-call → content loop** — voice agent logs an unanswered FAQ 3× → drafts a new FAQ section → one-click publish. Closes call→content→rank loop nobody connects. (~30h)
20. **AI trust content from real third-party data** — auto-fetch + keep-current Google Reviews/BBB/Yelp/Form-990 authority signals embedded in the site. (~40h)

## Tier B — Valuable

21. **Veo 3.1 hero reel per site** — native audio+video co-generation of a 5–8s branded hero with synced VO. (~40h)
22. **Sora 2 "about us" narrative film** — long-form brand film for high-value service businesses. (~40h)
23. **Agentic commerce storefront (ACP)** — machine-readable product + checkout endpoints so ChatGPT/Gemini shopping agents transact directly (4.4× conversion vs search). (~70h)
24. **A/B testing engine on generated sites** — experiment assignment + edge variant serving + significance; `visitor_events_core` already records conversions. (~50h)
25. **Onboarding copilot** — guided AI assistant through search→details→build (CLAUDE.md PART 6 mandate, currently absent). (~40h)
26. **Real DAM / media library** — owner-facing organize/tag/resize/replace-across-pages/bulk ops over `media.ts`. (~50h)
27. **Per-tenant knowledge agent with memory** — Vectorize namespace per site; chat/voice does RAG over only that tenant's data + remembers across sessions. (~40h)
28. **Auto GBP + directory submission agent** — Skyvern/Browser-Use claims Google Business Profile + submits to local directories + claims social handles right after generation. (~40h)
29. **Cloudflare Sandboxes build preview** — run generated site code in a real shell/filesystem before publish; safe preview without external VMs. (~40h)
30. **NL site-editing agent w/ tenant-ownership guards** — promote `conversational_edits.ts` to a real natural-language editing agent + close the cross-tenant write gap. (~40h)
31. **Figma-to-site import** — paste a Figma URL → deployed on-brand site (Framer/v0/Bolt parity). (~50h)
32. **AI pricing optimizer (real)** — turn the `big_bets.ts` mock into a real analyzer that reads conversions + suggests pricing-page changes. (~40h)
33. **Mandatory pre-publish AI security scan** — vuln + secret + unsafe-embed gate before any site goes live (Lovable parity). (~30h)
34. **Native email service** — Cloudflare Email: agent drafts transactional templates + verifies SPF/DKIM/DMARC in-loop, no third-party dependency. (~40h)
35. **Realtime voice concierge over WebSockets** — Cloudflare Agents SDK voice pipeline (no Twilio) for site visitors, trained on site content. (~50h)
36. **Generative design system per org** — extend `site_dna.ts` taste graph into a full brand design system that generates on-brand section variants. (~50h)
37. **AI review management** — collect, AI-respond, sentiment-surface, and request reviews from a single admin surface. (~40h)
38. **Post-publish content freshness re-eval** — scheduled sweep re-scores live copy vs updated banned-words/SEO/fact-drift and queues rewrites. (~30h)
39. **Agentic lead enrichment → site personalization** — Clay-style intent/CRM signals drive dynamic page content per visitor cohort. (~60h)
40. **Continuous accessibility remediation agent** — ongoing WCAG 2.2 AA fixes on live sites, not just a one-time audit. (~40h)

## Tier C — Solid (still 30h+)

41. **Multimodal intake → instant site update** — photo + voice of a storefront → branded section; extends `multimodal_intent.ts`. (~40h)
42. **Per-visitor generative PDF** — AI-narrated brochure/quote generated on demand from site + visitor context. (~30h)
43. **AI podcast per page** — NotebookLM-style 3-min audio summary auto-generated for each route. (~40h)
44. **Competitor page-diff surveillance** — weekly AI diff of top-3 competitors → "they added X, here's your counter-move" advisory. (~40h)
45. **AI internal-linking + content-cluster optimizer** — auto-optimize cross-route linking + topic clusters for SEO/GEO. (~30h)
46. **Self-healing site agent** — monitors Sentry/perf signals → regenerates broken/underperforming sections autonomously. (~50h)
47. **Rich-results expansion + validation loop** — auto-expand JSON-LD coverage + run Google Rich Results validation as a gate. (~30h)
48. **Cohort campaign generator** — turn site-analytics segments into AI-drafted email/social campaigns. (~40h)
49. **Domain → full brand kit fast path** — domain name → logo/favicon/palette/voice kit in one standalone flow. (~40h)
50. **Portfolio swarm orchestration** — the swarm panel monitors a whole portfolio, auto-optimizes the lowest performers without human initiation. (~80h)
