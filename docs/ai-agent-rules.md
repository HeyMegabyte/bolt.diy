# ProjectSites.dev — AI Agent Rules

> **Canonical doctrine is global** (`~/.agentskills`): `projectsites-cloudflare-first`,
> `package-preference-registry`, `cloudflare-lock-in-is-leverage`, `drift-detection`. This file
> is the **repo-specific delta + entry pointer** for an agent touching this repo — not a
> restatement of universal CF-first/package rules.
> Infra doctrine: `apps/project-sites/docs/architecture/cloudflare-first.md`.

## Cloudflare-first policy (non-negotiable)

1. **Prefer no database** — static/edge-rendered, KV, R2, or DO storage before any SQL.
2. **Cloudflare-native first** — Workers · Pages · D1 · KV · R2 · DO · Queues · Workflows · Hyperdrive · Vectorize · Analytics Engine · AI Gateway · Workers AI · Browser Rendering · Turnstile · Cloudflare for SaaS · Workers for Platforms · Secrets Store.
3. **Neon Postgres via Hyperdrive** only for real Postgres semantics/RLS/scale.
4. **Upstash Redis** only for true Redis semantics (sorted sets, streams, atomic counters at scale).
5. **Fly.io** only for stateful containers that don't fit CF Containers/Workers.
6. **Never default** to Google Cloud Run, Supabase, Firebase, or random managed services.

## No duplicate packages

- One canonical tool per job — see **Preferred libraries** below + the global `package-preference-registry` rule.
- Before adding any dep: grep `package.json` for an existing solver. If one exists, use it.
- An "inferior duplicate" (second router, second ORM, second validation lib) is a build-fail unless it serves a clearly separate role documented in `DECISIONS.md`.

## Preferred libraries (the short list)

- **Contracts/runtime:** Hono · Zod · Effect (targeted) · Drizzle · jose · DOMPurify · Nano ID.
- **OpenAPI:** `hono-openapi` + `@asteasolutions/zod-to-openapi` — never hand-maintain a spec.
- **Admin (Angular):** Spartan UI + CDK only. No PrimeNG/Material.
- **React surfaces:** Radix/shadcn/Puck/Plate.js/cmdk — never imported into the Angular bundle.
- **AI:** MCP TS SDK · Cloudflare Agents SDK · AI Gateway · Workers AI · Langfuse · Promptfoo.
- **Lint:** ESLint + Prettier + Oxlint + Knip. **Never Biome.**

## Package selection rubric (status gate)

| Status | Rule |
|--------|------|
| **Core** | May be installed soon; already shapes the platform |
| **Recommended** | Install only when a concrete feature needs it |
| **Conditional** | Needs an architecture note in `DECISIONS.md` (runtime fit + duplicate check) before install |
| **Study / borrow** | Never install; read for patterns, promote with justification |
| **Avoid for now** | Documented anti-choice; reverse only via ADR |

Run the 7-question gate for every candidate: have an equivalent? · feature truly needs it? · license OSS/free? · Workers/Angular compatible? · bundle/perf impact? · CF-compatible (adapter)? · is a lighter existing option enough? → install / defer / adapter-only / reject + record why.

## Integration checklist (every adoption)

- [ ] API contract exists (typed boundary)
- [ ] Zod schema validation at the boundary
- [ ] Unit + E2E tests (failing-first, TDD)
- [ ] Observability (logs/traces/events carry correlation + `featureSlug`)
- [ ] Security review done (authz, sanitization, secret handling)
- [ ] Cost/scale impact noted (1M-site tenancy)
- [ ] Cloudflare compatibility checked (Workers runtime / adapter)
- [ ] Agent instructions updated (this file)

## Repo cleanup rules

- Every folder ≤10 direct items; split or absolute-colocate past that.
- One canonical doc per class — no duplicate stack/roadmap/tooling docs. Duplicates collapse to a pointer.
- Generated output (`dist/`, `.wrangler/`, coverage, screenshots) is gitignored, never tracked.
- Dead code/flags/routes: grep callers first, then delete (reversible via git).
- Fold the good idea from a scratch file into the real owner, then delete the scratch.

## How to update TODOs

- The canonical build queue is `apps/project-sites/_LOOP_LEDGER.md` (the consolidated requirements list).
- Prefer checkboxes; check the box in the SAME change that lands the work.
- Merge duplicate TODO sections — never create a parallel list.
- A TODO in source (`// TODO(slug): …`) is allowed for real future work; banned in shipped user-visible strings.

## How to avoid bloating markdown

- Tables beat prose for tool/status lists. One idea per row.
- Don't restate what another doc owns — link it; this file owns the repo-specific rules.
- Cut filler ("please", "make sure", "in order to"). Imperative voice.
- A doc that only restates another becomes a pointer or is deleted.

## See

- `docs/generated-site-quality.md` · `docs/OBSERVABILITY.md` · `docs/security-supply-chain.md`
- `apps/project-sites/docs/architecture/cloudflare-first.md` — binding infra doctrine
