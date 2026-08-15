# e2e/flows/ — the FLOW_CATALOG.md specs (TDD backlog)

One file per catalog flow: `flow-NNN-slug.spec.ts` (NNN = the catalog number, zero-padded).
These are the loop's **outside-in TDD** targets — write the failing spec FIRST, build the feature
or fix the bug, verify GREEN against prod.

## Conventions

- **Source of truth**: `../FLOW_CATALOG.md`. Every spec's header comment cites its flow number + title.
- **Naming**: `flow-011-live-build-logs-widget.spec.ts`, `flow-027-visit-increments-analytics.spec.ts`, …
- **Homepage-first**: `goto('/')` → real UI sign-in (`helpers/auth` Pathway C / `E2E_API_KEY`) → click to navigate. Never `page.goto()` a private route as a shortcut for an acceptance flow.
- **Gating** (env, so a normal cert stays green while flows are RED):
  - `E2E_FLOWS=1` — run the flow specs at all (default: skipped, so RED flows don't break the cert).
  - `E2E_REAL_BUILD=1` — additionally allow the ~$5-15/~40-min real container build (flows in Groups A/D + any that build). The loop does NOT auto-fire paid builds.
  - `RUN_BROWSERBASE=1` — the agentic Chaos-Monkey (#100) + deep-visual flows.
- **Clean gates every spec asserts**: 0 console.error/warn, 0 pageerror, 0 unexpected 4xx/5xx, axe 0 critical on touched surfaces, and a display↔store reconciliation where data is shown.
- **Enrollment**: a flow graduates into `playwright.prod.config.ts` `testMatch` (as `flows/flow-NNN-*.spec.ts`) ONLY once it is GREEN — never enroll a RED spec into the cert.
- ⚠️ **Do not touch** `admin.component.*` / `nav-icon` / `admin-navigation-responsive.e2e.ts` — a concurrent session owns the admin shell.

## Priority order (see FLOW_CATALOG.md status tags)

1. ⭐ Live-logs build widget (Group B, flows 11–13) — the flagship feature.
2. ⭐ Analytics visit→count (27), Snapshots+Lighthouse (41–42), Editor own-LLM (53–54).
3. The rest by group, hardest/weirdest (Group G/I) last — they need the happy paths solid first.

## Seed

- `flow-011-live-build-logs-widget.spec.ts` — the flagship RED acceptance test for the live
  Claude-Code-logs widget on `/waiting` (drives building the feature).
- `create-edit-publish-flow.spec.ts` (parent `e2e/` dir) is the flagship REAL 10-step build (Flow #1),
  gated `E2E_REAL_BUILD=1`.
