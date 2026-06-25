# Social ("Pulse Social") — 50 Ranked Recommendations

> Synthesis of a code scan of the Social admin section + 2026 industry/design research
> (X pay-per-use pricing, Bluesky/ActivityPub rise, AI repurposing, composer paradigms).
> Sorted by importance: fix-what's-broken → unique edge → close gaps → platform strategy
> → UX/a11y → future bets. The real ROI is in **#1–20**; #39–50 are polish/future.

## Tier A — Correctness & reliability (broken/risky NOW) — 1–8
1. **Fix hardcoded media domain** in `services/social-publish.ts` `prepareMedia` (`https://projectsites.dev/assets/r2/${key}`, `accountBase` computed-but-unused) — breaks media for any custom-domain tenant. Use the site's primary hostname or a signed R2 URL.
2. **OAuth token auto-refresh lifecycle** — the #1 production failure point. Refresh Meta (IG/FB/Threads) tokens ~50d before 60d expiry; detect revocation; surface a "Reconnect" CTA. No refresh path exists today.
3. **Feature flag + kill-switch per publisher + Auto-Pilot** (`social_publishing`, `social_autopilot`) — zero `social` flags exist; a broken publisher currently needs a redeploy to disable.
4. **Bump stale `REAL_UA`** Chrome 131 → 149 in `social_publishers/types.ts` (matches `fetch-defaults`) — stale UA risks platform rejection.
5. **X cost-aware gating** — show est. $0.015/post, **$0.20/link-post** (Apr 2026) before publish; confirm. Link posts are prohibitive at scale.
6. **Per-account rate-limit budgeting** — track quota per connected account (not per app), log every 429, alert at 80%.
7. **Idempotency on scheduled dispatch** — verify each per-account fanout publish is idempotent so Workflow retries never double-post.
8. **Scheduled-post failure UX** — never silent-drop; surface failed/partial in the post card with one-click retry (step 5 only toasts the owner today).

## Tier B — The unique edge / killer differentiators — 9–16
9. **Repurpose site/page content → multi-platform atoms** — "Turn this page/blog post into a week of posts" (LinkedIn post + IG carousel + Bluesky thread). The killer website-builder workflow — you already own the content. **Build first.**
10. **Brand-voice extraction from site copy** — auto-seed an AI voice profile from existing site content + past posts; feeds AI Assist + Auto-Pilot. Zero manual config.
11. **Active per-platform reformatting** (not just char counters) — strip hashtags for LinkedIn, auto-split to thread for X/Bluesky, hook+CTA for IG — inline in the composer.
12. **AI weekly analytics summary** ("Lumen"-style) — "Top post was X; Wed 2pm runs +38%; replicate" — LLM over existing `social_analytics_snapshots`. High value, cheap.
13. **Approval-required agentic drafting** — Auto-Pilot drafts a week → human approves/edits → schedules. Keep approval the default (31% distrust obvious AI brand content).
14. **Best-time-to-post from per-account history** — replace static best-time chips with engagement-history heuristic/ML.
15. **Live split-pane composer preview** — true per-platform render (limits, link card, hashtag highlight, image crop) while editing. 2026 composer standard.
16. **First-comment scheduling** — IG hashtags / X / LinkedIn follow-up comment; high value, low cost, missing from many tools.

## Tier C — Close the analytics + feature gaps — 17–30
17. **Render the dead `best_posts` leaderboard + `best_times` heatmap** — typed in `social-analytics.component` `AggregateResponse` but never rendered. Data's there.
18. **Register the `social-performance` widget** (currently a pass-through shell) — make analytics more than a totals table.
19. **Attribution analytics** — auto-UTM every link → social clicks to GA4/PostHog → show leads/signups/conversions (Tier-1 decision metric).
20. **Weight saves + shares above likes** (2026 intent signals); show engagement-rate vs platform benchmark (IG 3–6%, TikTok 5–10%, LinkedIn 0.5–1.5%, X 0.5–2%).
21. **Normalize cross-platform metric definitions** (LinkedIn "click" ≠ TikTok "click").
22. **Evergreen queue + recycling** — categorized looping queues (SocialBee/Publer). Strong retention driver.
23. **UTM builder in the composer link field** (not a separate tool).
24. **Thread/carousel composer mode** for X + Bluesky (multi-segment, per-segment media).
25. **Promote RSS import** from a hidden `<details>` to a first-class "Auto-post from feed" (already exists; make it discoverable + reliable).
26. **Bulk actions** in Drafts/Queue (multi-select schedule/delete/duplicate).
27. **Post templates / saved snippets** (recurring CTAs, sign-offs, link-in-bio).
28. **Duplicate-and-edit a sent post** to repost to other networks.
29. **Calendar week-detail + mobile agenda views** alongside the month grid.
30. **Per-platform media validation** (aspect ratio/size/duration) before publish — catch IG/TikTok rejections client-side.

## Tier D — Platform strategy & integrations — 31–38
31. **Tier the platforms**: Bluesky + Mastodon + Instagram + Threads first-class (Bluesky = friendliest 2026 API); X behind cost-aware toggle; **LinkedIn as connect-&-copy/paste-assist** (don't promise automation to non-enterprise).
32. **Evaluate a unified API layer** (Phyllo / Unipile) for LinkedIn + TikTok where native cost is high — buys 4–8 weeks.
33. **TikTok** (≤15/day) + **YouTube Shorts** (quota-aware) as scheduled-only.
34. **Link-in-bio mini-page** generated from the site (you own hosting) — unique cross-sell.
35. **Account health panel** — per-account token status, last-publish result, expiry countdown, one-click re-auth.
36. **Webhook ingestion** for pull-only data where publishing isn't available (LinkedIn metrics).
37. **Mention autocomplete** backed by real per-platform handle lookup (verify it resolves today).
38. **OG-preview hardening** (SSRF-safe) + custom title/desc/image override on the card.

## Tier E — UX, a11y, polish — 39–46
39. **Keyboard-first**: Cmd+Enter to schedule; Cmd+K palette for compose/schedule/connect.
40. **WCAG 2.2 AA** composer pass (4.5:1, focus rings, ARIA on icon buttons) — EU EAA legally required.
41. **OLED dark-mode tuning** to the admin `#060610` base (near-black, not gray).
42. **Optimistic UI + undo** on schedule/delete/reschedule (sync-UI-async-backing).
43. **Empty-state upgrade** — "no drafts" → one-click "Generate this week from your site" (ties to #9).
44. **Composer autosave** — never lose a half-written post.
45. **Char-counter over-limit state** (red + "N over") + auto-trim suggestion.
46. **Calendar color-by-platform + overflow popover**; add keyboard reschedule for a11y (drag already exists).

## Tier F — Advanced / future bets — 47–50
47. **AI image/video in-composer** — defer to v2 (quality/cost still inconsistent in 2026; high ceiling; you have media studios).
48. **Social listening / mentions** — expensive third-party data; only on real customer demand. Skip v1.
49. **A/B test post variants** — the AI variant carousel already generates options; measure which wins.
50. **Team approval workflows + roles** — approver/commenter roles, approval queue, audit trail (you have `audit_logs`).

---
**Sources:** X API pricing (Blotato), Social Media APIs 2026 (Blotato), Buffer 2026 tools roundup, social-analytics metrics (HeroPost), Instagram Graph OAuth/limits (Phyllo), AI social agents (Admove).
