# Research: Backlog Ideas #90–100 (Performance & Infrastructure + Accessibility)

> Compiled 2026-05-26. Light-search pass (~10 WebSearch calls across 11 ideas).
> Evidence → ranked recommendation for the v2 doctrine planner.

---

## Performance & Infrastructure (90–95)

### #90: D1 multi-region read replicas via Sessions API bookmarks
- **evidence**: Cloudflare D1 Read Replication public beta (Apr 2025). Sessions API attaches commit-token "bookmark" per query → sequential consistency across replicas. Case study (Jack Pearce, 2025): Australian API response dropped from 5s+ → 1-2s (**~95.7% latency cut**) with one toggle + small code change. Built-in, zero extra storage cost — same `rows_read`/`rows_written` billing.
  URL: https://blog.cloudflare.com/d1-read-replication-beta/ + https://www.jackpearce.co.uk/posts/improving-api-response-times-using-d1-global-read-replication/
- **recommendation**: STRONG — zero-cost toggle, dramatic global-latency win, already partially wired into worker stack (per `apps/project-sites/CLAUDE.md` Sessions API note).

### #91: Hyperdrive in front of external Postgres for tenant analytics
- **evidence**: Hyperdrive now GA, free on Workers Free plan. Eliminates 7 round-trips (TCP+TLS+auth) per cold connection. Cloudflare changelog (Mar 2025): **"up to 90% latency reduction"** on uncached queries by relocating pools near origin DB. Benchmarks: **17-25× faster cached, 6-8× faster uncached** vs direct connection from Workers.
  URL: https://developers.cloudflare.com/changelog/2025-03-04-hyperdrive-pooling-near-database-and-ip-range-egress/ + https://blog.cloudflare.com/how-hyperdrive-speeds-up-database-access/
- **recommendation**: MODERATE — strong tech but only matters if we adopt external Postgres (Neon). Per CLAUDE.md PART 4 "Cloudflare-first, Neon only when D1 cannot meet requirements" — defer until tenant analytics genuinely exceeds D1.

### #92: R2 lifecycle: Standard → Infrequent Access after 30 days
- **evidence**: R2 IA is $0.01/GB-month vs Standard $0.015 (**~33% storage savings**). Trade-offs: 2× Class A/B operation cost, **$0.01/GB retrieval fee**, 30-day minimum storage duration billed even if deleted early. One-way transition only (no IA→Standard via lifecycle policy). Egress free across both tiers.
  URL: https://developers.cloudflare.com/r2/buckets/storage-classes/ + https://developers.cloudflare.com/r2/pricing/
- **recommendation**: MODERATE — meaningful only for snapshots NOT accessed > monthly. Worth wiring with a 90-day (not 30-day) cutoff to preserve restore UX; cost-benefit thin until snapshot volume crosses ~100GB.

### #93: Workers Queues for background jobs (snapshots, email, image proc)
- **evidence**: Throughput ~**5,000 msg/sec per queue**, 128KB message cap (use R2 for larger payloads). No CPU time limit on consumer (vs Workers fetch handler limit). At-least-once delivery → idempotency required. One DIY case study reported **1000+ jobs/min** on free tier as alternative to AWS SQS ($400/mo).
  URL: https://architectingoncloudflare.com/chapter-08/ + https://developers.cloudflare.com/queues/
- **recommendation**: STRONG — decouples worker request from snapshot generation + email + image proc; aligns with `apps/project-sites/CLAUDE.md` note "QUEUE binding optional in Env type — NOT yet enabled". Highest-leverage missing infra piece.

### #94: Speculation Rules per-route prerender
- **evidence**: Ray-Ban case study (web.dev): LCP **4.69s → 2.66s mobile (43% drop)**, mobile conversion **+101%**, desktop conversion **+156%**. Monrif news: LCP -17.9%, engagement +8.9%. Cloudflare Speed Brain (Sep 2024) ships speculation rules by default → 45% LCP reduction on successful prefetches. ~28% of nav successfully prefetched at "moderate" eagerness. **Caveat**: prerender double-counts GA4 pageviews; skip on landing pages where analytics integrity matters (per `[[always]]`).
  URL: https://web.dev/case-studies/rayban-speculation-rules + https://web.dev/case-studies/monrif-cwv
- **recommendation**: STRONG — proven 30-50% LCP cut, near-zero implementation cost (declarative JSON). Apply to dashboard nav clicks first (highest navigation density), skip marketing home.

### #95: Beasties critical-CSS extraction per route
- **evidence**: Render-blocking CSS adds **~200ms p50** to FCP; on slow mobile, render delay = **69% of total LCP** (2025 Web Almanac). 85% of mobile pages still fail render-blocking-resources audit. Beasties (Critters successor) automates extraction + inlining. CoreDash data: Next.js sites with inlined critical CSS show **median FCP -400ms**. Caveats: HTML size balloons, cache invalidation per page, App Router incompatible with streaming.
  URL: https://web.dev (render-blocking insights) + https://tukanft.com/en/posts/how-beasties-enhances-page-load-speed-by-inlining-critical-css
- **recommendation**: MODERATE — meaningful FCP win but only if LCP is currently CSS-blocked. Measure first via Long Animation Frames API before adopting; Angular + Vite already does some CSS code-splitting per route.

---

## Accessibility & Inclusive Design (96–100)

### #96: AI-generated live captions on embedded video (Workers AI Whisper)
- **evidence**: Whisper Large-v3 hits **2.7% WER on LibriSpeech (clean)** — top accuracy among ASR models per MLPerf 2025. Real-world English audio: **5-12% WER** (meetings/podcasts/calls); psychiatric-interview study reported 14.8% median WER (Amazon Transcribe 8.9% on same set). YouTube auto-caption typically 10-20% WER. Whisper-Large-v3-Turbo: 5.4× faster, minor accuracy loss. Newer open-weights models (NVIDIA Canary Qwen 2.5B, Parakeet TDT) now surpass Whisper on AA-WER benchmark.
  URL: https://mlcommons.org/2025/09/whisper-inferencev5-1/ + https://artificialanalysis.ai/speech-to-text/models/whisper
- **recommendation**: STRONG — Workers AI binding already wired; 5-12% WER beats "no captions" and matches YouTube auto-caption quality. WCAG 1.2.2 (Captions) is Level A → legal requirement under DOJ Title II 2027/2028 deadlines.

### #97: Alt-text writer-assistant (AI proposes alt for uploaded images)
- **evidence**: WebAIM Million 2025: **18.5% of all images** lack alt text; **55.5% of homepages** have ≥1 missing-alt image. 11% of present alt-text is "questionable" (filename, "image", "graphic"). Comparative AI study (2026, n=200): Claude 3.5 Sonnet scored 8.4/10 accessibility + 8.7/10 factual; GPT-4o 8.6/10 accuracy at 28-word descriptions; Gemini 2.5 strongest on landscapes/landmarks. All require **human review** — AI cannot distinguish decorative from informative images reliably.
  URL: https://webaim.org/projects/million/2025 + https://www.sammapix.com/blog/ai-alt-text-accuracy-test-2026
- **recommendation**: STRONG — closes the #2 most-common WCAG failure on the web. Implement as "suggest, never auto-publish" workflow; pair with `data-confidence="ai-draft"` until owner verifies.

### #98: Color-blindness simulator preview (deuteranopia / protanopia / tritanopia)
- **evidence**: **~1 in 12 men (8%) and 1 in 200 women** globally have CVD (~300M people). Deuteranomaly most common (5% of men); deuteranopia 1.2%, protanopia 1%, tritanopia 0.01%. Northern European descent skews higher; East Asian populations ~5-7% male prevalence. China has 107M affected, India 74M, USA 32M. CVD is **underdiagnosed** — users often don't know they have it, so design must default-accommodate.
  URL: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12385717/ + https://colorblind.io/learn/statistics
- **recommendation**: STRONG for the SIMULATOR (designer tool — cheap CSS filter, huge a11y QA payoff). MODERATE for runtime end-user toggle (most users won't know to enable it; better to design palette to be CVD-safe by default per WebAIM contrast guidance).

### #99: Cognitive load mode (simpler language, fewer choices per screen)
- **evidence**: No single canonical study, but WebAIM Million 2025: pages now average **1,257 elements** (+61% over six years) → increasing cognitive load is measurable. WCAG 2.2 added 2.4.11 (focus appearance), 3.2.6 (consistent help), 3.3.7 (redundant entry) explicitly to reduce cognitive load. CDC: ~6.8% of US adults have cognitive disability (~17M); WHO: 15-20% of population is neurodivergent. Flesch ≥60 reading-ease (CLAUDE.md PART 12) is the copy-side analog.
  URL: https://webaim.org/projects/million/2025 + https://www.w3.org/WAI/WCAG22/Understanding/ (WCAG 2.2 new criteria)
- **recommendation**: MODERATE — high ethical payoff (served-population ethos), but "cognitive load mode" risks bifurcating the design system. Better: bake Flesch ≥60 + WCAG 2.2 cognitive criteria into the DEFAULT, ship an optional "summary view" toggle per long-form route only.

### #100: Font-size scaler (90/100/110/125%) persistent per user
- **evidence**: WCAG 1.4.4 (Resize Text) is Level AA — text must scale to 200% without loss of content/function. Browser zoom already handles this generically (chrome://settings/fonts); the user-need filled by an app-level scaler is for users who DON'T know how to use browser zoom (≈the same population the WebAIM "questionable alt text" problem hits). Low-vision affects **~12M US adults** (CDC 2024). Persistence across SPA navigation is the real win — browser zoom resets on some auth/SSR boundaries.
  URL: https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html + https://webaim.org/projects/million/2025
- **recommendation**: WEAK — duplicates browser zoom. SHIP only if user research shows >5% of admin users size-up text manually; otherwise invest in default fluid `clamp()` type scales + respecting `prefers-reduced-motion` + WCAG 2.2 focus-visible mandates.

---

## Summary scoreboard

| # | Idea (short) | Recommendation |
|---|--------------|----------------|
| 90 | D1 read replicas + Sessions API | **STRONG** |
| 91 | Hyperdrive | MODERATE |
| 92 | R2 IA lifecycle | MODERATE |
| 93 | Workers Queues | **STRONG** |
| 94 | Speculation Rules prerender | **STRONG** |
| 95 | Beasties critical CSS | MODERATE |
| 96 | Whisper captions | **STRONG** |
| 97 | AI alt-text assistant | **STRONG** |
| 98 | Color-blind simulator | **STRONG** (designer tool) |
| 99 | Cognitive load mode | MODERATE |
| 100 | Font-size scaler | WEAK |

**Ship-first batch**: #90, #93, #94, #96, #97 — all STRONG, all already-wired or near-trivial on the Workers + D1 + Workers AI stack.
