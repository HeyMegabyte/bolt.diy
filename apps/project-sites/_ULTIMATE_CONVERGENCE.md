# Ultimate Convergence Prompt — projectsites.dev

> The canonical loop guide. Each loop fire = ONE round. The longer this runs, the better the
> platform gets: rounds walk a fixed priority ladder (most-important → least-important), and
> every round must leave the app more correct, more complete, more cohesive, and better tested
> than it found it. "Nothing left to do" is FALSE CONVERGENCE unless the Definition of Done
> (bottom) is fully, verifiably true. Complements (does not replace) `CONVERGENCE.md` §6 honesty rules.

---

## 0. Hard resolved facts (never re-litigate these)

- **Brand = CYAN / BLACK.** `--ps-accent` cyan `#00E5FF` on `#060610` (the cockpit system). **NOT orange** — "orange" was contamination for **bricklabor.com** (a different repo, which matches its own homepage). Treat any "orange" in a projectsites brief as a mistake.
- **NEVER duplicate existing behavior.** Before building ANY module, cross-check `FEATURE_CATALOG.md` + the 46 `libs/features/*` + the 151 flag keys + the admin sections + **snapshots**. If the capability already exists, EXTEND or POLISH it — do not rebuild it under a new name.
  - **Canonical example: backup/restore = SNAPSHOTS.** Snapshots (`snapshots.component`, `snapshots-diff`, `changeset_service`, `site_branches`) already ARE git-style versioning + restore. A "backup_restore" module is a DUPLICATE — forbidden. Apply this reasoning to every candidate.
- **git worktrees isolate edits** → committing to `main` is safe even with many agent worktrees active. Only avoid **racing concurrent R2 deploys**: commit always; deploy only when no other deploy is mid-flight (else commit + let the deploy cycle pick it up).
- **Worker deploys are Docker-gated locally** (container DO image build). Worker-backend changes: commit; they ship on a push → Workers Builds. **Frontend (`/admin` Angular SPA) ships to R2** with no Docker.
- **Honesty (CONVERGENCE.md §6):** never claim a result you didn't verify. Never claim "tooling corruption" without a `diff <(git show HEAD:path) path` that actually disagrees. Run the test before recording it green. A stopped-with-evidence round beats a fabricated one.

---

## 1. Priority ladder — work top tier to exhaustion, then descend

Each round picks the **highest-priority unmet item still in reach** (safe + verifiable from the current environment). Never skip down a tier while a P0/P1 item is both unmet AND reachable.

### P0 — Correctness & Trust (the app must WORK and be SAFE before it's pretty)
1. Cross-tenant / ownership leaks (e.g. approve/publish another org's draft, read another org's changeset). Fix `forbidden`→`notFound` existence leaks; add `assertOwned` guards + regression tests.
2. Dead controls / silent failures — buttons POSTing to missing routes → wire them OR give a graceful disabled "coming soon" state (never a silent 404). No dead buttons.
3. Console errors, CSP/Trusted-Types violations, full-page reloads on internal nav (must be SPA `routerLink`).
4. Fake/demo/dead UI + fake-data leaks → remove (only when no active worktrees) or flag as coming-soon.
5. Input validation at every boundary (Zod) on any flag being promoted; protect admin routes; verify destructive actions.

### P1 — Revenue & core satisfaction (the bottom-line + must-work flows)
6. **Brian-prioritized platform modules (build these first among adds):**
   - **#4 review_approval_links** — shareable preview + comment + approve-before-publish.
   - **#8 team_seats_rbac** — seats, roles, invites, transfer-ownership (seat expansion = ARR).
   - **#10 outbound_webhooks** — customers subscribe endpoints to site events (signed, retried).
   - **#11 automation_builder** — no-code trigger→action recipes (Zapier-lite).
   - **#12 email_deliverability_wizard** — SPF/DKIM/DMARC + inbox-placement test + warmup.
   - **#17 bulk_site_ops** — apply a change/section/flag across ALL your sites at once.
   - (Full list: `_extra-feature-modules-50.md`. **#14 backup_restore is DROPPED — snapshots already do it.**)
7. CRUD reliability everywhere: real validation + success/failure states + safe refresh + useful errors. No half-working flows.
8. Highest-ROI client-site revenue modules (per `_extra-feature-modules-50.md` §B): abandoned-cart recovery, coupon engine, lead-capture popups.
9. AEO autopilot (#1) — the defensible platform wedge: citation tracking → auto-fix → measured lift.

### P2 — Cohesion, a11y, performance (founder-grade polish)
10. Cyan/black design-system cohesion: every screen intentionally designed; reusable primitives (states/empty/skeleton/error, tables, nav, dialogs); tokens not hardcoded values.
11. WCAG 2.2 AA: keyboard nav, focus-visible, ARIA, contrast, semantics — across every route.
12. Performance: lazy-load heavy admin modules, reduce layout shift, optimize tables/lists. (Known: ag-grid is eager 782 KB → migrate audit/ai-logs grids to TanStack Table to close the bundle budget — a real wave, see `frontend/CLAUDE.md`.)
13. Responsive: mobile/tablet/desktop at every breakpoint.

### P3 — Least important (do last; never before P0–P2 are exhausted)
14. Decorative motion flourishes beyond the functional set.
15. Secondary verticals / exotic integrations / experimental flags not yet requested.

---

## 2. Per-round protocol (do every fire — ship, don't just report)

1. **Inspect** current `/admin` UX + code; read `MEMORY.md` + `_extra-feature-modules-50.md` + this file.
2. **De-dup check** (mandatory): does the candidate already exist (catalog/modules/flags/snapshots)? If yes → extend/polish, never rebuild.
3. **Pick** the highest-priority unmet, *reachable*, *safe* item (P0 first).
4. **Test first** — write/update the Playwright (or Karma unit) test describing expected behavior; watch it fail where behavior is broken.
5. **Implement** the smallest correct slice.
6. **Verify** — re-run the test green; typecheck; build; manually reason through the route.
7. **Commit to `main`** (additive/new files preferred when worktrees are busy). Deploy frontend to R2 only if no deploy is mid-flight; else commit and let the cycle deploy.
8. **Summarize** the exact change + what's next. Then continue to the next item.
- At least ONE **visible cyan/black UX improvement per round** unless the round is exclusively fixing a blocking test or a P0 correctness bug.

---

## 3. Self-improvement engine (longer it runs → better it gets)

- After each round ask **"what is now the single highest-impact unmet item?"** and do that next — the ladder guarantees importance order.
- Raise the bar each pass: re-audit finished surfaces against the public site + competitors; if a surface no longer beats best-in-class, it re-enters the queue.
- The loop terminates ONLY at the Definition of Done — never on time, tokens, or "good enough."
- Record durable lessons + new dedup hazards back into this file + `MEMORY.md` so they compound.

---

## 4. Definition of Done (anti-false-convergence)

Done only when ALL are verifiably true:
- Every `/admin` route is visually polished + cohesive in cyan/black, intentionally designed.
- Every visible feature works or is intentionally flagged coming-soon (no dead buttons, no silent failures, no fake-data leaks).
- The Brian-prioritized modules (4, 8, 10, 11, 12, 17) are shipped or flag-staged; no duplicates of existing behavior exist (esp. no backup_restore — snapshots own it).
- Playwright + unit tests cover all critical admin flows AND pass; every fixed bug has a regression test.
- Zero TODOs / console errors / CSP-TT violations / full-page reloads / layout bugs / untested critical workflows.
- WCAG 2.2 AA clean; performance budgets met; SPA-only nav.
- Target felt result: a premium Cloudflare-native SaaS control center — fast, beautiful, cyan/black, reliable, fully tested, responsive, accessible, genuinely useful.

---

## 5. Dedup ledger (extend as new near-dups are spotted — "make 14 not pop up")
- **backup_restore → DROP.** Snapshots (+ changeset_service + site_branches) already provide versioning/restore.
- **fundraising_campaigns (#45)** → EXTEND `donations_engine`, don't fork a second payments path.
- **content_calendar (#13)** → EXTEND `content_freshness`, share its draft model.
- **visitor_accounts (#49)** ≠ `membership_paywall` (visitor auth vs operator paywall) — distinct, OK.
- **staging_slots (#21)** ≠ snapshots (separate environment vs frozen version) — distinct, OK, but reuse snapshot plumbing.
- Rule: any candidate within one concept of an existing module must declare EXTEND-vs-NEW and justify it here before code.
- **Ownership guard → `services/site_ownership.ts` `assertSiteOwned(env, orgId, siteId)`** is the SINGLE source of truth. Every site-scoped `:siteId` route uses it (404 on missing/foreign, never 403/leak). Do NOT re-implement inline (conversational_edits + swarm already consolidated onto it).
- **⚠️ "archive" ≠ "soft-delete".** The existing `DELETE /api/sites/:id` path (`api.ts:1961`) sets BOTH `status='archived'` AND `deleted_at=now()` — that is a DELETE (the row drops out of every `deleted_at IS NULL` query). A reversible "archive" (bulk_site_ops #17, or any archive feature) MUST set `status='archived'` ONLY, never `deleted_at`. Reusing the soft-delete path for "archive" silently deletes sites. Verify which semantic you want before reusing a status-writing path.

## 6. Cross-tenant audit queue (P0 — missing org-ownership on `:siteId` routes)
Closed: `content.ts` approve · `conversational_edits.ts` (4f7620be) · `swarm.ts` (e6cc063d, +auth) · `pseo.ts` (68cd750d — LIVE) · `reviews.ts` (3daf721b) · `copilot.ts` (70d62c1d — admin handlers trusted a client `x-org-id` header; now session-org + ownership). **SWEEP COMPLETE for the surfaced candidates.**
**Verified ALREADY-GUARDED (do NOT re-audit):** `mcp_site.ts` (`assertSiteOwnership` ×7), `site_branches.ts` (`assertOwner` ×6), `ai_components.ts` (service-layer `WHERE site_id=? AND org_id=?` in `listSiteComponents`/`getComponent` + insert `org_id`). The `own=0` scan signal is UNRELIABLE (helpers vary: `assertOwner`/`assertSiteOwnership`/`row.org_id!==orgId`/service-layer scoping). Reliable gap-finder = "`:siteId` route file with ZERO ownership-check signature anywhere" → remaining: `features.ts` (31h) — EXCLUDED per `apps/project-sites/CLAUDE.md` gotcha #10 (do NOT mass-retrofit; guard per-feature on promotion). **Next round: leave P0-cross-tenant (done) → advance to P1 build-first modules (#4/8/10/11/12/17) or P2 cohesion/a11y.**
**Lessons (fold forward):** (a) **prioritize routes with NO feature-flag gate** — LIVE (any authed user), worse than dormant; grep `:siteId` handlers lacking BOTH `isFlagOn` AND an ownership check. (b) **mutations must scope by parent `site_id`, not child id alone** — always `WHERE id = ? AND site_id = ?`. (c) **NEVER derive tenant identity from a client-supplied header** (`x-org-id` etc.) — always `c.get('orgId')` from the authed session; a header is attacker-controlled (copilot bug). (d) ownership can live at the route OR service layer — verify the actual query (`WHERE … org_id=?`) before claiming a gap. New site-scoped routes MUST use `assertSiteOwned` (or equivalent) from day one.

## 7. P1 + P2 progress notes
- **✅ P1 #12 `email_deliverability_wizard` — FULLY WIRED + DARK-LAUNCHED (407de810 core, f26fd351 wiring).** First Brian-prioritized module shipped end-to-end via the **bottom-up loop strategy** (2 rounds, no dedicated pass needed):
  - Round 1 (407de810): pure injectable-`fetch` core `src/services/email_deliverability.ts` + 6 green unit tests (`src/__tests__/email_deliverability.test.ts`). Score = SPF 35 + DMARC 35 + policy(quarantine|reject) 10 + DKIM 20; DoH to `cloudflare-dns.com`; graceful `score 0` on failure.
  - Round 2 (f26fd351): `GET /api/sites/:siteId/deliverability` (`src/routes/email_deliverability.ts`) — `auth` 401 → `isFlagOn('email_deliverability_wizard')` 404 → **`assertSiteOwned`** 404 → domain from `?domain=` (the actual sending domain) else primary `custom_cname` hostname else 400 → `checkDeliverability(fetch, domain)`. Flag added to `registry.ts` (`experimental`, off). Manifest `libs/features/email_deliverability_wizard/feature.manifest.ts` (registry-entry-only, `unitTests:['__tests__/email_deliverability.test.ts']` — resolves as `src/<path>`). Mounted in `src/index.ts` before the `api` catch-all. **drift 0 · tsc 0 · 6/6 unit.** Ships on push (Docker-gated).
  - **Deferred (intentional, not a gap):** no D1 seed migration for the flag (flag defaults off via `registry.ts` so the route is correctly dark without it; a seed migration races the swarm's migration numbers — add it on promotion so the flag surfaces in `/admin/feature-flags`). An Angular admin surface to display the score+fixes is the beta gate.
- **✅ VALIDATED LESSON — build worker-backed P1 modules bottom-up in the loop (2 rounds, zero dedicated pass):** Slice 1 = pure core + unit tests (additive new files → zero drift/migration/Docker exposure, verifiable locally NOW). Slice 2 = route+guard+flag+manifest+mount (drift-coherent; run `validate:features:quick` before staging since the pre-commit `feature-drift` hook is all-or-nothing once `libs/`+`registry.ts` are staged). Beats both "force `gen:feature`" (kebab/snake friction) and "defer to a dedicated pass." **Apply this to the remaining P1 modules #4/#8/#10/#11/#17.** Key drift facts confirmed: manifest `unitTests`/`e2eTests` paths resolve as `src/<p>` / `e2e/<p>` (so `'__tests__/x.test.ts'` → `src/__tests__/x.test.ts`); no e2e dir or D1 migration required for drift to pass; flag in `registry.ts` alone makes the route behave (off by default).
- **🟡 P1 #17 `bulk_site_ops` — CORE + PREVIEW ENDPOINT WIRED (5f53f275 core, ac8f12ab route), 2 of 3 slices.** Pure `planBulkOperation` (`src/services/bulk_site_ops.ts`, 7 green unit tests) + `POST /api/sites/bulk` (`src/routes/bulk_site_ops.ts`): auth + `isFlagOn('bulk_site_ops')` + Zod `.strict()` body + org-scoped resolve (`SELECT id,status FROM sites WHERE org_id=? AND deleted_at IS NULL`) → `planBulkOperation` → `{ ok, dryRun:true, plan }`. Flag (experimental, off) + manifest + mount. drift 0 · tsc 0 · 7/7. De-dup verified clean (env_vars/api/super_admin "bulk" hits = dotenv-import/file-export/cache-purge, NOT apply-across-sites). **The planner is the safety heart (ownership filter → never cross-tenant; per-op validity; `MAX_BULK_SITES=100` cap). **ARCHIVE EXECUTOR LANDED (6211adf1):** route gates on `dryRun` (default true=preview); `dryRun:false` runs `executeBulkArchive` — a **reversible status-only** `UPDATE sites SET status='archived', updated_at=… WHERE id=? AND org_id=? AND deleted_at IS NULL` (NEVER `deleted_at` — that's soft-delete; see §5 hazard), per-id `{archived, failed}` results, scoped by org_id as defense-in-depth. 11/11 unit (7 planner + 4 executor via mock D1). `set_flag`/`republish` + `dryRun:false` → **400 NOT_IMPLEMENTED** (loud, never silent). **REMAINING for #17 (full DoD):** `set_flag` executor → `feature_flag_overrides` (no public write helper — read migration 0037 schema first); `republish` executor → existing publish path; per-archive **audit-log writes** (`writeAuditLog`, deferred — archive is reversible); Angular admin surface. Then promote.
- **Older note (still true):** `gen:feature` wants a **kebab-case** slug vs the codebase's **snake_case** — skip the generator, hand-author the registry-entry-only manifest instead; data-backed modules (#8 seats, #10 webhooks, #11 automations) need a **D1 migration** (claim the number atomically — it races the swarm).
- **P2 state-primitive contract coverage (in progress):** `empty-state` (9596424e) ✓ · `error-card` (b1dd9d92) ✓ · `skeleton` ✓ — TRILOGY COMPLETE. All three verified already production-grade (token-driven, focus-visible, reduced-motion, ARIA) — coverage locks the contract; do NOT invent cosmetic "visible" churn on already-excellent primitives.
