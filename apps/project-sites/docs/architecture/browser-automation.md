# Browser Automation

> Parent doctrine: [`cloudflare-first.md`](cloudflare-first.md) §5. Worker code:
> `src/services/browser_gateway.ts` (routing LAW) + `src/routes/browser_service.ts`
> (the `/v1/browser/*` service).

## The naming split (HARD)

| Host | Role | Public |
|---|---|---|
| `browser.projectsites.dev` | Product browser-automation abstraction — CF Browser Run + Playwright + Stagehand | Product / internal API |
| `mcp.megabyte.space/browserbase` | Internal Browserbase MCP bridge (Claude Code / agents / ops) | Internal, behind CF Access |
| `skyvern.megabyte.space` | Internal heavy-workflow agent (logged-in portals, 12-step flows) | Internal, behind CF Access |

**Product/agent code calls `browser.projectsites.dev` — never Browserbase or
Skyvern directly.**

## Routing LAW (`chooseBrowserProvider`)

Backend order: **CF Browser Run + Playwright → CF Browser Run + Stagehand →
Browserbase fallback → `skyvern_internal`**.

| Job input | → provider | reason |
|---|---|---|
| default (no preference/specialty) | `cf` | cf-default |
| `backendPreference` set | that provider | backend-preference |
| `specialty` (captcha / residential_proxy / session_replay / live_view / long_session / stealth) | `browserbase` | specialty |
| CF binding absent | `browserbase` | cf-unavailable-fallback |

`skyvern_internal` is **never** chosen by the default LAW or as a fallback — only
when an internal/admin job sets `backendPreference: skyvern_internal`. The product
gateway `connectBrowser` **refuses to execute** Skyvern (throws); the internal
Megabyte layer runs it.

## The service (`/v1/browser/*`)

Nine purposes: `screenshot · pdf · qa · form-test · extract · visual-check ·
metadata · health-check · stagehand`. Every job is tenant-scoped + Zod-validated
(`BrowserJobSchema`):

```ts
{ tenantId, siteId, hostname?, backendPreference?: "cloudflare"|"browserbase"|"skyvern_internal",
  specialty?, budgetCents?, timeoutMs?, priority? }
```

- `400` on an invalid job · `202 { status:'routed', provider, reason, purpose }` on
  accept · `503 BROWSER_PROVIDER_UNAVAILABLE` when the requested backend isn't
  configured.

## Outputs + observability (next sub-slice)

Execution (screenshot/pdf via CF Browser Run; Stagehand for AI-resilient pages)
stores outputs in R2 (screenshots, PDFs, HAR, extraction JSON, QA reports, logs),
job metadata in D1, metrics to Analytics Engine, failures to Sentry with
tenant/site tags. Browserbase fallback usage + Skyvern internal usage are tracked
for the cost-anomaly watchdog.
