# Social Publishing

Social publishing for projectsites.dev consists of two components at different stages of maturity.

---

## Components

| Component | Status | URL | Technology | Investment Level |
|---|---|---|---|---|
| Postiz (reference service) | Live — transition only | social.projectsites.dev | AGPL CF Container | Temporary |
| Native Social (long-term product) | In development | /admin/social | Hono + CF Queues + Durable Objects + CF Workflows | Primary investment |

**The native social system is the long-term product.** Postiz enables fast-start social scheduling while native social is built provider by provider. When a native provider reaches `stable` stage, new account connections for that provider stop going to Postiz.

---

## How They Relate

```
Today (transition period):
  Admin UI → Postiz (social.projectsites.dev) → Twitter / LinkedIn / Facebook / Instagram

When native ships per provider:
  Admin UI → Native Social API (/api/social/*)
               → Provider Durable Object (token management)
               → CF Queue → CF Workflow (scheduled publish)
               → Twitter / LinkedIn / Facebook / Instagram

  Postiz container remains live for existing accounts until all providers are migrated.
```

---

## What to Build In

All new social feature work goes into native social. Postiz receives no new feature investment — it is operated as-is until sunset.

Native social is built on:
- **Hono** route handlers at `/api/social/*`
- **CF Durable Objects** — one DO per connected account (stores tokens, rate-limit state)
- **CF Queues** — publish jobs enqueued by the Worker
- **CF Workflows** — scheduled post execution with step-level retries
- **CF R2** — media storage for post images/videos

Native social is explicitly NOT:
- Dependent on Postiz runtime at all
- Built on Temporal or any external workflow engine
- A wrapper around Postiz

---

## Navigation

| Document | Contents |
|---|---|
| [Native Social Architecture](./native-social-architecture.md) | Full architecture: provider model, Durable Objects, Queues, Workflows, API routes |
| [Postiz Reference](./postiz-reference.md) | What to learn from Postiz; what not to copy; migration plan per provider |
| [Postiz Service Docs](../services/postiz.md) | AGPL isolation rules, deployment, env vars, sunset plan |
