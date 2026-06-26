# Postiz Social Scheduling Service

> **WARNING: AGPL-3.0 License — Strict Isolation Required**
>
> Postiz is licensed under AGPL-3.0. Any code that imports or links to Postiz source code
> may be subject to the AGPL copyleft requirement, which would require open-sourcing the
> entire application. To avoid this:
>
> 1. Postiz code MUST NEVER be imported into the main Worker or any shared package.
> 2. Communication with Postiz is HTTP API ONLY — no shared libraries, no shared types.
> 3. Postiz is a transition service while native social publishing is built. See [native-social-architecture.md](../social/native-social-architecture.md).
> 4. When native social reaches beta, this container is decommissioned.

---

## Overview

Postiz runs as a Cloudflare Container at **social.projectsites.dev**. It provides social media scheduling while the ProjectSites-native social publishing system is under development. It is an isolated, standalone AGPL service that the main Worker communicates with via HTTP only.

---

## Deployment: CF Container

```toml
# apps/project-sites/wrangler.toml (Postiz container section)

[[containers]]
  name = "postiz"
  image = "ghcr.io/gitroomhq/postiz-app:latest"
  port = 3000

  [[containers.bindings]]
    type = "durable_object_namespace"
    name = "POSTIZ_DO"
    class_name = "PostizContainerDO"
```

### Container Environment (set via wrangler secrets)

```bash
wrangler secret put POSTIZ_DATABASE_URL --env production  # Neon Postgres
wrangler secret put POSTIZ_REDIS_URL --env production     # Upstash Redis
wrangler secret put POSTIZ_JWT_SECRET --env production
wrangler secret put POSTIZ_BACKEND_INTERNAL_URL --env production
wrangler secret put POSTIZ_NEXT_PUBLIC_BACKEND_URL --env production
```

---

## Environment Variables (Main Worker)

These variables let the main Worker communicate with Postiz via HTTP API. They do NOT represent an import dependency.

| Variable | Description | Example |
|---|---|---|
| `POSTIZ_URL` | Base URL of the Postiz container | `https://social.projectsites.dev` |
| `POSTIZ_API_KEY` | API key for authenticating Worker requests | `...` |
| `POSTIZ_SECRET` | Shared secret for webhook verification | `...` |

```bash
wrangler secret put POSTIZ_URL --env production
wrangler secret put POSTIZ_API_KEY --env production
wrangler secret put POSTIZ_SECRET --env production
```

---

## AGPL Isolation Rules

| Rule | Rationale |
|---|---|
| No `import` from Postiz source | AGPL contamination — copyleft propagates to the importer |
| No shared TypeScript types from Postiz codebase | Types are code; importing them is importing the library |
| No shared database tables or Drizzle schemas | Schema sharing creates an implicit coupling |
| HTTP API only | The HTTP boundary is the AGPL firewall |
| Postiz container runs in its own CF Container | Process isolation ensures zero code sharing |
| No Postiz npm packages in `package.json` | Even dev dependencies can trigger AGPL obligations in some interpretations |

---

## HTTP API Integration

The main Worker calls Postiz endpoints via HTTP. Keep integration surface minimal.

```typescript
// apps/project-sites/src/services/postiz.ts
// NOTE: No Postiz types imported. All shapes are locally defined.

interface PostizPost {
  id: string;
  content: string;
  status: 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'FAILED';
  publishDate?: string;
  platformId: string;
}

async function createPost(
  env: Env,
  params: {
    content: string;
    publishDate?: string;
    platformIntegrationId: string;
  },
): Promise<{ id: string } | null> {
  const res = await fetch(`${env.POSTIZ_URL}/api/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.POSTIZ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) return null;
  return res.json<{ id: string }>();
}

async function listPosts(env: Env): Promise<PostizPost[]> {
  const res = await fetch(`${env.POSTIZ_URL}/api/posts`, {
    headers: { Authorization: `Bearer ${env.POSTIZ_API_KEY}` },
  });

  if (!res.ok) return [];
  const data = await res.json<{ posts: PostizPost[] }>();
  return data.posts ?? [];
}

async function deletePost(env: Env, postId: string): Promise<boolean> {
  const res = await fetch(`${env.POSTIZ_URL}/api/posts/${postId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.POSTIZ_API_KEY}` },
  });
  return res.ok;
}
```

---

## When to Use Postiz vs Native Social

| Criterion | Use Postiz | Use Native Social |
|---|---|---|
| New social account connections | Yes — until native social ships for that provider | Yes — once native provider is built and flagged stable |
| Scheduling social posts | Yes (Postiz UI at social.projectsites.dev) | Yes — once Workflow-based scheduling ships |
| Analytics/insights on posts | Yes (Postiz built-in) | Yes — once PostHog + ClickHouse integration ships |
| Embedded in admin workflow | No — redirect to social.projectsites.dev | Yes — native UI in /admin/social |
| Multi-tenant isolation | Partial (Postiz workspace isolation) | Full (per-tenant Durable Object) |

---

## Sunset Plan

Postiz is explicitly a transition service. The decommission sequence:

1. Native social ships TwitterProvider — stop routing Twitter connections to Postiz.
2. Native social ships LinkedInProvider — stop routing LinkedIn connections to Postiz.
3. Native social ships FacebookProvider + InstagramProvider — all providers covered.
4. Migrate remaining Postiz-scheduled posts: export via Postiz API, import to native queue.
5. Flip `postiz_container` feature flag to `killswitch`.
6. Decommission CF Container: remove from `wrangler.toml`, delete container.

---

## Related Docs

- [Social publishing overview](../social/README.md)
- [Native social architecture](../social/native-social-architecture.md)
- [Postiz as reference implementation](../social/postiz-reference.md)
