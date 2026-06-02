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

## 6. Cross-tenant audit queue (P0 — `auth+flag-but-no-org-ownership` pattern)
Closed: `content.ts` approve (already fixed by swarm, verified) · `conversational_edits.ts` (4f7620be) · `swarm.ts` (e6cc063d — also added missing auth). **Still-suspect (low org-check density vs `:siteId` handlers — verify each, fix with `assertSiteOwned`):** `pseo.ts` (14h/2), `reviews.ts` (9h/3), `comparison_pages.ts` (5h/2), `integration_directory.ts` (5h/2), `site_branches.ts` (12h/4), `site_dna.ts` (9h/5), `copilot.ts` (9h/6). Read each before claiming a gap — some may use a different guard; verify per CONVERGENCE.md §6.
