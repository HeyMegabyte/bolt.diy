# ProjectSites.dev — AI Observability & Governance

> Every AI feature on ProjectSites.dev is traced, evaluated, version-tracked, budget-capped, and
> fallback-routed. No AI surface ships without these. Routing layer: `llm.projectsites.dev`
> (LiteLLM) behind Cloudflare AI Gateway. Stack source: `docs/STACK.md` §AI / §7.

## Required for every AI feature

- [ ] **Trace** every LLM call (Langfuse)
- [ ] **Eval** suite with a rubric (Promptfoo) wired into CI
- [ ] **Prompt + version tracking** (registry, not inline strings)
- [ ] **Budget cap + killswitch** (per-org spend ceiling that hard-stops)
- [ ] **Fallback routing** (LiteLLM via AI Gateway)
- [ ] **Grounding / hallucination checks** on outputs that feed customer sites
- [ ] **Zod-validated output contract** — never consume raw model output

## Traces (Langfuse)

- Wrap every model call with a Langfuse trace: prompt name + version, model, latency, token counts, cost, `featureSlug`, `orgId` (redacted PII).
- Link traces to the request `correlationId` so a trace joins app logs + Sentry.
- Score traces post-hoc: feed eval/judge scores back via `gateway().patchLog()` to close the loop.

## Evals (Promptfoo)

- Every AI capability has a `promptfoo` eval set: golden inputs + expected shape + rubric.
- Run `--mock-only` in CI (no keys needed); `--live-only` pre-release to catch contract drift.
- A regression in eval pass-rate blocks the merge. New AI capability with no eval = build-fail.
- Track pass-rate + cost per eval run; alert on regression vs last run.

## Model routing (LiteLLM + AI Gateway)

Provider cost tiers (the application-call axis):

| Tier | Provider | Use for |
|------|----------|---------|
| **Premium** | Anthropic (Claude) / OpenAI | Architecture, planning, security/payment/auth, ALL vision |
| **Mid-grade (default)** | DeepSeek (`deepseek-chat`) | Most generation/implementation/build volume |
| **Instant** | Cloudflare Workers AI (`@cf/meta/llama-*` FP8) | Pre-routing, classification, moderation, embeddings |

- Route every call through **Cloudflare AI Gateway** for caching + rate-limit + observability (per-request `cacheKey` + `cacheTtl`; 30–70% hit rate on repeated surfaces).
- LiteLLM normalizes providers and routes by cost/quality, picking the cheapest model that clears the quality bar per request.
- `DEEPSEEK_API_KEY` is always a `wrangler secret` / get-secret entry — never committed.

## Fallback policy

1. Primary model per tier (above).
2. On 429 / timeout / 5xx → LiteLLM retries with backoff, then falls to the next model in the tier chain.
3. On total provider outage → degrade gracefully (cached result, deterministic fallback, or a user-facing "try again" — never a silent wrong answer).
4. Vision has no DeepSeek fallback → premium-only; if premium is down, the vision feature returns a typed error, not a fabricated result.

## Prompt versioning

- Prompts live in the prompt registry (`apps/project-sites/prompts/` + `src/prompts/`), not inline literals.
- Each prompt carries a version; the version is logged on every call (Langfuse `promptVersion`).
- Changing a prompt bumps the version + re-runs its eval set before deploy.

## Cost & budget controls

- **Per-org AI budget cap** (`org_ai_budget_cap`) — a hard ceiling that STOPS a runaway bill, not just a meter.
- **Credit-metered wallet** debits every expensive action (container minutes, vision, image/video gen, full rebuilds).
- AI Gateway logs cost per call; alert when an org approaches its cap.
- Free tier gets a small credit float + no custom domain; $50/mo per site is the paid floor.

## Grounding / hallucination checks

- Outputs that feed a customer site (copy, schema, claims) are grounded against the research bundle (`_research.json` / `_brand.json` / `_citations.json`) — no fabricated facts, no fabricated people, every claim cited.
- A grounding check (retrieval-match or judge) gates publish; ungrounded claims are rejected, not shipped.
- Generated JSON-LD claims must match visible content (cross-checked by the JSON-LD validator).

## See

- `docs/STACK.md` §AI / §7 · `docs/generated-site-quality.md`
- `rules/model-routing` · `rules/contract-first-ai` · `rules/evals` · `rules/auto-meta-work` (AI Gateway wiring)
