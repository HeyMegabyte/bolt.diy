# Current Architecture (2026)

This document describes the projectsites.dev platform architecture as deployed. It is the authoritative reference for service boundaries, hosts, and responsibilities.

---

## Components

| Component | Technology | Host | URL | Purpose |
|---|---|---|---|---|
| Main Worker | Hono + TypeScript | CF Workers | projectsites.dev | API gateway, site serving, business logic, auth |
| Frontend Admin | Angular 21 + Nx | CF Pages | projectsites.dev/admin | Tenant administration UI |
| bolt.diy Editor | Remix + Vite | CF Pages | editor.projectsites.dev | AI-powered web IDE (embed only) |
| ClickHouse | ClickHouse 24.x | Fly.io (iad) | Internal HTTP only | High-volume analytics warehouse |
| Chatwoot | Rails + Sidekiq | Fly.io (iad) | support.projectsites.dev | Customer support |
| Postiz | Next.js (AGPL) | CF Container | social.projectsites.dev | Social scheduling (transition service) |
| Inngest | Inngest CE | CF Container | events.projectsites.dev | Background event bus |
| LiteLLM | Python | CF Container | llm.megabyte.space | LLM proxy / routing |
| Twenty CRM | Node.js | CF Container | crm.projectsites.dev | Internal CRM |
| Payload CMS | Node.js | CF Container | cms.projectsites.dev | Content management |
| Listmonk | Go | CF Container | mail.projectsites.dev | Mailing list / transactional email |

---

## Data Layer

| Store | Technology | Host | Used For |
|---|---|---|---|
| Primary DB | Cloudflare D1 (SQLite) | CF D1 | Sites, users, orgs, billing, feature flags, domains |
| Analytics Cache | Cloudflare KV | CF KV | Host resolution (60s TTL), prompt cache, flag snapshots |
| File Storage | Cloudflare R2 | CF R2 | Generated sites, marketing homepage, social media |
| Analytics Warehouse | ClickHouse 24.x | Fly.io | page_views, events, site_builds |
| Postgres (services) | Neon (shared project) | Neon Cloud | Chatwoot, Twenty CRM, other service DBs |
| Redis (services) | Upstash Redis | Upstash Cloud | Chatwoot action cable, Sidekiq, service caches |
| AI Inference | CF Workers AI | CF Workers AI | Llama 3.1 for site generation |

---

## Key Design Decisions

- **No Supabase** — D1 via parameterized SQL handles all relational needs for Workers; Supabase JS SDK is incompatible with the Workers runtime.
- **R2 paths are version-keyed** — `sites/{slug}/{version}/{file}` enables instant rollback without redeployment.
- **Dot subdomains for sites** — `{slug}.projectsites.dev` serves generated sites; the routing Worker reads the subdomain from the `Host` header.
- **No global interceptor for Angular HTTP** — use `ApiService` (not raw `HttpClient`) for all authenticated calls; raw `HttpClient` sends no bearer token.
- **Persistent bolt.diy iframe** — `BoltEmbedService` owns the iframe lifecycle across admin sub-routes; the iframe lives in `AdminComponent`, not in the editor route, so WebContainer cold-boot (~30-60s) happens once per session.
- **CF Access on all internal services** — Chatwoot, LiteLLM, Twenty CRM, Payload CMS, Listmonk, events.projectsites.dev are behind CF Access using the `projectsites-infra` service token.
- **Sentry fully removed** — replaced by PostHog (errors + analytics + session recording) + Axiom (structured logs) + OTel (trace correlation).
- **One dialog primitive** — all admin modals render via `DialogShellComponent`; custom modals are not permitted.
- **Design tokens in `_polish.scss`** — `--ps-bg`, `--ps-ink`, `--ps-accent`, `--ps-z-overlay-takeover`, `--ps-radius-xl`, `--ps-shadow-modal`. Hard-coded brand colors fail audits.
- **Postiz is AGPL-isolated** — communication via HTTP API only; no Postiz code imported anywhere.

---

## Service Communication

```
Browser
  |
  +--[HTTPS]--> CF Edge
  |               |
  |               +--[Workers]---> Main Worker (Hono)
  |               |                 |
  |               |                 +--[D1 SQL]-----> Cloudflare D1
  |               |                 +--[KV get/put]--> Cloudflare KV
  |               |                 +--[R2 get/put]--> Cloudflare R2
  |               |                 +--[Queue send]--> CF Queue --> Analytics Consumer
  |               |                 +--[Workflow]----> Site Generation Workflow
  |               |                 +--[Workers AI]--> Llama 3.1
  |               |                 +--[HTTP]--------> Chatwoot (Fly) [CF Access]
  |               |                 +--[HTTP]--------> Postiz (CF Container)
  |               |                 +--[HTTP]--------> ClickHouse (Fly) [internal]
  |               |                 +--[HTTP]--------> Resend (email)
  |               |                 +--[HTTP]--------> Stripe (billing)
  |               |
  |               +--[Pages]-----> Angular Admin SPA (CF Pages)
  |               +--[Pages]-----> bolt.diy Editor (CF Pages) [embed-only]
  |
  +--[HTTPS]--> support.projectsites.dev --> Chatwoot (Fly) [CF Access]
  +--[HTTPS]--> social.projectsites.dev  --> Postiz (CF Container)
  +--[HTTPS]--> events.projectsites.dev  --> Inngest (CF Container) [CF Access]
```

---

## Security Perimeter

| Layer | Technology | Scope |
|---|---|---|
| DDoS + WAF | Cloudflare WAF | All traffic to `*.projectsites.dev` |
| Bot mitigation | Cloudflare Turnstile | Public forms, checkout |
| Internal service auth | Cloudflare Access (CF Access) | Chatwoot, LiteLLM, Twenty CRM, Payload CMS, Inngest, Listmonk |
| Service-to-service | CF Access service token (`projectsites-infra`) | Worker → internal services |
| API auth | HMAC-signed JWT (Clerk M2M for admin) | `/api/*` routes |
| WAF MCP skip rule | CF WAF custom rule | `/api/mcp/*` and `/oauth/*` skip origin challenge |

---

## Related Docs

- [CF vs Fly split decision](./fly-cloudflare-split.md)
- [Observability stack](../observability/README.md)
- [ClickHouse warehouse](../analytics/clickhouse.md)
- [Chatwoot service](../services/chatwoot.md)
- [Postiz service](../services/postiz.md)
- [Native social architecture](../social/native-social-architecture.md)
