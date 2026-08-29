# 0035 — Custom Code Endpoints via Workers for Platforms (replaces "AI Agents")

**Status:** accepted
**Date:** 2026-08-27
**Deciders:** Brian Zalewski
**Supersedes:** the `ai_endpoints` / "AI Agents" admin section (UI-authored endpoints)

## Context

The admin **"AI Agents"** section (`/admin/ai-endpoints`, D1 `ai_endpoints`, `src/routes/ai_endpoints_public.ts`) let owners define backend endpoints through the admin UI — either an AI prompt (`kind='prompt'`) or uploaded code (`kind='worker'` → Workers for Platforms). Brian's direction: **drop the UI-authoring model.** Owners should define endpoints **in their own site code** (in the in-browser editor), and the platform hosts them on **Cloudflare Workers for Platforms (WfP)**.

The WfP foundation already exists in the codebase: `env.USER_DISPATCH?: DispatchNamespace` + `WFP_NAMESPACE_NAME` (`src/types/env.ts:677`), and `libs/features/cloudflare_setup/` does WFP dispatch-namespace status + idempotent auto-setup.

## Decision

Replace UI-authored AI endpoints with **code-defined, file-based endpoints** authored in the site's `functions/` folder, bundled on Publish and dispatched via WfP.

### 1. Authoring — in-editor `functions/` folder
- Owners write endpoints in a `functions/` folder inside their generated site, edited in the existing bolt.diy editor. No separate admin section, no GitHub requirement (GitHub deploys are a possible later follow-on).

### 2. Convention — file-based routing (Cloudflare Pages Functions style), JS/TS only (v1)
- One file per route: `functions/api/quote.ts` → `POST/GET {slug}.projectsites.dev/api/quote`.
- Handlers export `onRequest` / `onRequestGet` / `onRequestPost` `(ctx: { request, env, params, waitUntil, next })`.
- Dynamic segments via `[id].ts` → `:id`.
- **v1 is JS/TS only** (native WfP path). Python/Rust-WASM from the old schema are dropped for v1 (WASM import path is a possible follow-on).

### 3. URL / routing — same-origin `/api/*`, platform paths reserved
- `{slug}.projectsites.dev/api/*` (and any custom hostname for the site) dispatches to the site's WfP Worker; everything else stays the static R2 site.
- **The platform RESERVES a fixed set of `/api/*` paths** (the main worker already serves `*.projectsites.dev/*`): `/api/contact-form/*` and `/api/_ps/*` (analytics beacon, upgrade bar, platform internals). User endpoints own the rest of `/api/*`. Implementation MUST enumerate the current child-subdomain platform `/api/*` routes and add any not already under `/_ps/` to the reserved list (or relocate them under `/_ps/`).
- Dispatch order in `site_serving`: request to a child host → if path matches a reserved platform prefix → existing handler; else if `/api/*` and the site is entitled + has a deployed script → `env.USER_DISPATCH.get('site-<siteId>').fetch(request)`; else → R2 static / 404.

### 4. Old "AI Agents" section — CLEAN BREAK removal
- Remove the admin section + route + all entry-point links + backend routes/service + the D1 table.
- **D1 audit (2026-08-27, prod `project-sites-db-production`):** `ai_endpoints` has **6 rows, ALL test data** — `org-brian-001` (Brian's own `megabytespace`: `hey-copy-2` prompt, `ballzzz` worker) + `e2e-test-org` (`urban-fitness`: `e2e-probe` worker, `e2e-chaos-*` prompts). **Zero real third-party customers** → dropping is safe (no migration). One uploaded WfP script `ai-e2e-site-e2e-probe` must also be deleted from the dispatch namespace.

### 5. Deploy trigger — on Publish
- Publishing the site also bundles `functions/` (esbuild → one Worker script implementing the file-based router) and uploads it to the WfP dispatch namespace as `site-<siteId>`. Endpoints version with the site (see §11).

### 6. Runtime capabilities (all four)
User endpoints receive, namespaced under `env`:
- **`env.AI`** — Workers AI binding (LLM calls; the "AI" value of the old section, code-first).
- **`env.DATA`** — scoped, **read-only** access to the site's own `form_submissions` + site metadata/config/brand. Tenant-scoped; NEVER cross-site/cross-org.
- **`env.KV`** — a per-site KV namespace (scratch storage). **`env.R2`** — a per-site R2 prefix.
- **`env.SECRETS.<KEY>`** — the site's + org's encrypted env-vars (from the existing `ai_env_vars` feature), site value overrides org on key clash.
- **Outbound `fetch()`** to any URL (external APIs). Counts against the subrequest limit (§10).

### 7. Plan gating — any paid plan, entitlement-gated
- Unlocks on **any paid plan** (lowest paid tier and up) via the site-features/entitlements plane. New entitlement key: `custom_endpoints`. Server guard: dispatch returns **404** (not 403) for `/api/*` on a non-entitled site (never leak). UI (editor `functions/` affordance) hidden/locked when not entitled.

### 8. AI billing — consume the existing AI credits ledger
- `env.AI` calls from user endpoints **debit the site's `ai_credits_balance`** (same wallet as the rest of the site's AI). When out of credits, `env.AI` calls fail with a clear error; the endpoint still runs (it can handle the failure).

### 9. Data scope — form submissions + site metadata, read-only
- `env.DATA` exposes read-only, tenant-scoped access to the site's `form_submissions` + site config/brand/metadata. No write path in v1; no access to other tables, other sites, or org-wide data.

### 10. Limits — platform defaults (proposed; Brian to confirm here)
- **CPU:** 50 ms/request default. **Subrequests:** 50/request (CF paid default; includes outbound fetch). **Requests/day per site:** 100,000/day default → 429 past it. **Script size:** ≤ 10 MB bundled (CF WfP limit). All tunable per plan later. *(These are proposals — adjust inline if desired.)*

### 11. Versioning — endpoints version WITH the site
- A snapshot captures `functions/` alongside the site. Restoring a snapshot re-deploys that snapshot's endpoints (WfP script re-uploaded from the snapshot's `functions/`). Front-end + back-end roll back together.

### 12. Local testing — publish-to-test + a preview slot at `/api/test-publish`
- No local runner in v1 (real Workers can't run in the WebContainer — `workerd` is a native binary; a mock-runtime shim has a "works-locally-breaks-live" fidelity gap, explicitly rejected).
- **Build a preview deploy slot:** deploying to **`/api/test-publish`** pushes the current `functions/` to a **preview** WfP script (`site-<siteId>-preview`), separate from the live one, which the owner hits live to test before a real Publish promotes it.

### 13. Observability — feed the existing Logs/Traces
- User-endpoint invocations + errors flow into the existing Log Explorer / Traces so owners can debug their code (reuses `/admin/logs`).

## Consequences

- **Positive:** endpoints live in the owner's code (versioned, diffable, no UI CRUD); real WfP isolation per tenant; the "AI" capability survives as `env.AI` without a bespoke UI; one deploy path (Publish); observability reuses Logs/Traces.
- **Negative / locked-in (one-way doors):** the `/api/*` URL contract on child subdomains is now a public contract (reserved-path policy must never silently change); WfP is a paid CF add-on (cost per tenant script); dropping `ai_endpoints` is irreversible (safe here — test data only); versioning-with-snapshots adds WfP script bookkeeping.
- **Neutral:** GitHub-repo authoring, WASM/Python, a real local runner, and `env.DATA` write access are explicit non-goals for v1 (possible follow-ons).

## Removal inventory (clean break — execute in order, verify green at each stage)

**Frontend (delete/neutralize):** `sections/ai-endpoints.component.ts`(+spec); `app.routes.ts` `ai-endpoints` route; `command-palette-actions.service.ts` `nav-endpoints`+`act-add-endpoint`(+spec); `admin-section-labels.ts` `ai-endpoints`; `not-found.component.ts` hint; `forms.component.ts` empty-state link; `onboarding-checklist.component.ts` step; `api.service.ts` ai-endpoints methods; `docs.component.ts` refs; `ai-budget-meter.component.ts` label; `empty-state.component.spec.ts` fixture. KEEP `ai-logs`/Traces (general AI-call logging) — only remove its endpoint-navigation refs. **Do NOT touch `admin.component.html` this window (dirty in a concurrent session; the section isn't in the sidebar anyway).**

**Backend (delete/neutralize):** `libs/features/ai_endpoints/` (feature module); `src/routes/ai_endpoints_public.ts` (old execution path); ai-endpoints handlers in `src/routes/ai_admin.ts` + `libs/features/admin_ai/handlers.ts` + `src/lib/ai_admin_kit.ts` (surgical); route mounts in `src/index.ts`; the flag(s) in `src/modules/feature_flags/registry.ts`; refs in `src/routes/docs.ts` + `src/routes/feature_e2e.ts`.

**D1 + infra:** new migration `DROP TABLE ai_endpoints` (6 test rows, no real customers); delete WfP script `ai-e2e-site-e2e-probe` from the dispatch namespace.

## Build stages (post-removal — the new feature)
1. `functions/` convention + esbuild bundler → single WfP router script; scaffold an example `functions/api/hello.ts` + README in the site template.
2. WfP upload/delete on Publish (`site-<siteId>`), keyed off entitlement `custom_endpoints`; preview slot (`-preview`) behind `/api/test-publish`.
3. `site_serving` dispatch: reserved-path guard → `env.USER_DISPATCH` dispatch for `/api/*`.
4. Binding injection: `env.AI` (credit-metered), `env.DATA` (scoped read), `env.KV`/`env.R2` (per-site), `env.SECRETS` (site+org env-vars).
5. Snapshot capture/restore of `functions/`; Logs/Traces wiring; limits enforcement.

## Alternatives considered
- **Keep AI-prompt endpoints in the UI (code OR prompt):** rejected — Brian wants code-only.
- **Single `_worker.ts` / export a Hono app instead of file-based:** rejected — file-based `functions/` is the most approachable "define endpoints" model.
- **Dedicated API subdomain / user Worker owns the whole site:** rejected — same-origin `/api/*` with a static site is the least disruptive.
- **Local runner (miniflare/mock shim) in v1:** rejected — infeasible/low-fidelity in the WebContainer; preview slot at `/api/test-publish` covers it.

## Additional decisions (rounds 4–9, 2026-08-27/28) — feature name: **"Functions"**

- **Secret scope (updates §6):** inject **site + org** env-vars (site value overrides org on key clash) as `env.SECRETS.<KEY>`. Owners manage them in the **existing env-vars admin surface** (org/site scopes) — no new secrets UI.
- **Runtime binding contract (confirmed, namespaced under `env`):** `env.AI` · `env.DATA` · `env.KV` · `env.R2` · `env.SECRETS.<KEY>`.
- **`env.DATA` shape:** **typed helper methods** — `env.DATA.forms.list({limit})`, `env.DATA.site()` (read-only, tenant-scoped). No raw-SQL surface.
- **npm dependencies:** **allowed** — a `package.json` in `functions/`; we `npm install` + esbuild-bundle into the WfP script. Watch the WfP size cap + lockfile/supply-chain.
- **Streaming/WebSocket:** **HTTP request→response only in v1** (add streaming/SSE/WS later).
- **State:** **stateless — `env.KV` + `env.R2` only** in v1 (no Durable Objects).
- **Custom domains:** **yes** — dispatch `/api/*` on any hostname bound to the site (custom domain + subdomain).
- **Reserved-path collision:** a `functions/` file on a reserved path (e.g. `functions/api/contact-form.ts`) is a **publish/build error** ("that path is reserved") so they rename it. No silent platform-wins.
- **Bad `functions/` build on Publish:** **publish the static site, keep the last-good functions live, surface the build error.** Never take live endpoints down for a content publish.
- **Template scaffold:** generated sites **ship a starter** `functions/api/hello.ts` (commented) + short README. **No** dedicated onboarding-checklist step — discovery is the scaffold + docs.
- **Endpoint auth:** **provide optional helpers** — `ctx.verifyOwnerSession()` + a Turnstile-verify helper — but endpoints are **public by default** (auth is opt-in).
- **Abuse protection:** **default per-IP edge rate-limit** on user endpoints + a **Turnstile opt-in** helper. Tunable.
- **Request body cap:** **~25 MB** (tunable per plan) so endpoints can accept uploads streamed to `env.R2` (vs the 256 KB platform-API cap).
- **WfP compute cost:** **absorbed within plan limits** (bounded by the requests/day cap in §10); no separate compute metering in v1.
- **Scheduled/cron handlers:** **allowed (the most powerful option)** via `functions/_scheduled.ts` — but **sequenced as a fast-follow (Stage 6)** after the core HTTP path ships, so it doesn't gate v1.

## Convergence

The full, ordered acceptance-criteria checklist that drives implementation to completion lives in **`docs/FUNCTIONS-CONVERGENCE.md`** (the convergence-loop ledger). A recurring convergence loop reads this ADR + that ledger, implements the next incomplete AC TDD-first, verifies (typecheck → unit → build → deploy → prod-E2E), checks it off, and repeats until every AC is green + zero recommendations remain.
