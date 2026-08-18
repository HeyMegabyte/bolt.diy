# Long-Tail E2E Inventory — slow surfaces (editor / WebContainer / AI / build lifecycle)

The chaos specs are fast by design; the surfaces below are SLOW (WebContainer cold
boots, AI generations, workflow runs) and were systematically skipped — the exact
omission that let the "editor answers nothing" defect through (Brian 2026-08-18).

**Operating rules (per `feedback_loop_method_is_real_browser_clicking_e2e_tdd`):**
- Every /loop fire: run `chaos-15` (keystone editor AI round-trip) — red = fire blocked.
- Every fire also implements 4-5 `[ ]` entries below (parallel agents, distinct files).
- Mark `[x]` only when GREEN against prod; never delete entries.
- Status key: `[ ]` todo · `[~]` in-progress · `[x]` green (add date) · `[-]` n/a (note why).
- "Long-tail" = slow-by-design; budget the wait, never skip the surface.

## Group A — Editor core (the bolt iframe + WebContainer + AI chat) — 15
- [x] A1 editor boots cold, answers a typed prompt, re-answers after nav-away+return — `chaos-15-editor-journey.e2e.ts` (2026-08-18)
- [ ] A2 multi-turn conversation: 3 back-to-back prompts, each answered; context carries turn 1 into turn 2
- [ ] A3 prompt suggestions endpoint: bolt's "suggest prompts" chips render + clicking one fills the chat box
- [ ] A4 code-edit round-trip: prompt "change the hero heading to X" → file tree shows the changed file → preview iframe reflects it
- [ ] A5 file-tree navigation: click through src/ → open a file → contents visible in the editor pane
- [ ] A6 terminal pane: booted WebContainer's terminal accepts a command (`ls`) and prints output
- [ ] A7 preview iframe: after boot the app preview renders (inner iframe has real DOM, not blank)
- [ ] A8 editor × 4 viewports (375/768/1280/1920): chat input + file tree + preview all reachable at each
- [ ] A9 editor deep-link `?embedded=true` direct hit stays on the embed gate (no standalone UI leak)
- [ ] A10 logout → editor iframe detached/cleared (no stale authed editor after sign-out); login → fresh boot
- [ ] A11 session expiry: seeded expired token → editor section shows the auth prompt, not a silent hang
- [ ] A12 chat-state mirror: send 2 messages → `POST /api/bolt/sites/by-slug/:slug/chat-state` fires → D1 row lands (reconcile)
- [ ] A13 voice/vision endpoints: `/api/bolt/transcribe` + `/api/bolt/vision-ocr` return sane shapes (not 5xx, not silent)
- [ ] A14 editor error boundary: break a generated file intentionally → recovery card, never a white iframe
- [ ] A15 warm-boot latency: after first visit, `/admin/editor` re-entry has chat input ≤30s (no second cold boot)

## Group B — Editor × whole app (entry states / cross-feature) — 15
- [ ] B1 from Dashboard: Getting Started hub's "Open the Editor" CTA routes into the booting editor
- [ ] B2 from site detail: selecting site X in the admin, then Editor, loads site X's context (slug in iframe src)
- [ ] B3 from Snapshots: create snapshot → open editor → snapshot exists in bolt's snapshot UI
- [ ] B4 from Forms: form-submission inbox → "open in editor" for a submission resolves (no dead-end)
- [ ] B5 from Voice: agent-settings save → editor still boots clean (cross-tab clobber regression)
- [ ] B6 from Billing: free plan editor → billing upsell appears, editor still functional behind it
- [ ] B7 from Domains: add a custom hostname → editor's deploy menu reflects the new primary hostname
- [ ] B8 after publish: publish from editor → live site serves the new content (prod-E2E round-trip)
- [ ] B9 after reset: reset a site → editor context refreshes to the fresh build (no stale files)
- [ ] B10 two sites: switch site A→B inside editor → bolt re-boots with B's slug, no A leftovers
- [ ] B11 zero sites: org with no sites → editor section shows the create-first empty state (not a hang)
- [ ] B12 feature-flag flip: killswitch an editor-adjacent flag → editor degrades gracefully, no crash
- [ ] B13 with Cmd+K open: palette overlay + editor iframe coexist (focus trap doesn't swallow bolt)
- [ ] B14 deep link `/admin/editor?site=<id>`: preselected site honors the param
- [ ] B15 back/forward: editor → back to dashboard → forward to editor → state intact, single iframe (no duplicate boot)

## Group C — AI generation + build lifecycle (the product's golden path) — 10
- [ ] C1 create-from-search full workflow: search business → create site → research/build status stream → published
- [ ] C2 waiting screen live progress: build in flight shows real step updates, not a stuck spinner
- [ ] C3 workflow logs: per-site build logs render entries with timestamps (no empty "no logs" while running)
- [ ] C4 build limits: 2 rapid resets → rate-limit UX is friendly (actionable message, not a raw 429)
- [ ] C5 zip deploy: upload a site zip → deploy → live URL serves it (reconcile against R2)
- [ ] C6 bolt publish: editor publish button → site status flips published → build version bumps (D1 reconcile)
- [ ] C7 research.json: post-build `/api/sites/by-slug/:slug/research.json` returns the research payload (not stale/empty)
- [ ] C8 AI gateway routing: a premium-tier call logs a gateway span + returns content (no silent provider fallback)
- [ ] C9 snapshot restore: create snapshot → restore → served content reverts (reconcile served bytes)
- [ ] C10 build timeout path: intentionally stuck build → honest error card + retry affordance (no infinite spinner)

## Group D — Slow cross-system integrations — 10
- [ ] D1 WebContainer restart: kill + reopen editor → single iframe reuse (BoltEmbedService), no double boot
- [ ] D2 domain RDAP round-trip in picker: search domain → availability chip flips to a REAL verdict (not all-unknown)
- [ ] D3 Stripe checkout: billing upgrade opens real embedded checkout (no card submit — assert UI only)
- [ ] D4 email delivery: magic-link request → Resend/SES 202 → link verify completes auth (prod round-trip)
- [ ] D5 webhook delivery: trigger a stripe test webhook → webhook_events row + idempotency (reconcile D1)
- [ ] D6 notification polling: trigger an admin action → notification bell count increments within 60s (reconcile)
- [ ] D7 task tray: post an AskUser task from a workflow → tray renders it → resolve → workflow resumes
- [ ] D8 hostname provisioning: add custom hostname → CF for SaaS provisions → status flips active (slow poll)
- [ ] D9 media upload + S3/R2: upload 5MB asset → media library lists it → raw endpoint streams it back
- [ ] D10 offline recovery: network offline mid-editor-session → banner shows, then re-connect → session resumes (PWA)

---

**Totals:** 50 entries (A15 · B15 · C10 · D10). Implemented: 1. Red/blocked: 0.
**Keystone:** `chaos-15-editor-journey.e2e.ts` — every fire runs it FIRST; red = fire blocked.
