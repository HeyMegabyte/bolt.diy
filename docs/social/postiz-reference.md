# Postiz as Reference Implementation

Postiz is used as a reference during native social development — not as a dependency. This document records what to study in Postiz, what to avoid, and the per-provider migration plan.

---

## What to Learn From Postiz

Postiz is a well-designed multi-provider social scheduler. Study these patterns when designing native equivalents.

| Pattern | Postiz Location | What to Borrow |
|---|---|---|
| Provider abstraction | `packages/backend/src/integrations/integration.manager.ts` | Interface shape for `connect`, `publish`, `getStatus`, `disconnect` |
| OAuth state management | `packages/backend/src/integrations/` | PKCE flow, state parameter signing, token refresh logic |
| Scheduling UI concepts | `packages/frontend/src/components/schedule/` | Date/time picker UX, queue visualization, calendar view |
| Media upload flow | `packages/backend/src/media/` | Pre-upload to storage before platform submission, MIME validation, size limits |
| Platform-specific quirks | Each provider file | Rate limits, character limits, media type restrictions per platform |
| Post preview rendering | `packages/frontend/src/components/preview/` | Per-platform preview mockups |
| Bulk scheduling | `packages/backend/src/posts/posts.service.ts` | Batching logic for high-volume scheduling |

---

## What NOT to Borrow

| Category | Why |
|---|---|
| Any AGPL-licensed source code | AGPL copyleft — importing triggers open-source obligation on the entire application |
| Database schema (Prisma migrations) | Tight Prisma/PostgreSQL coupling; native social uses D1 via parameterized SQL |
| NestJS module structure | Native social uses Hono; NestJS DI patterns do not translate |
| Postiz npm packages (`@gitroom/nestjs-*`, `@gitroom/react`) | All AGPL-licensed |
| Postiz Docker image layers | Not applicable — native social is Workers, not containers |

### The Safe Zone

Reading Postiz source to understand patterns is **safe** — AGPL restricts distribution of derived works, not the act of reading. The restriction triggers when Postiz code (modified or unmodified) is included in the projectsites.dev codebase.

---

## HTTP API Integration (During Transition)

While native social is being built, the main Worker routes social requests to Postiz via HTTP API. Only these endpoints are used:

| Endpoint | Method | Description |
|---|---|---|
| `/api/posts` | `POST` | Create a new scheduled post |
| `/api/posts` | `GET` | List posts (with status filter) |
| `/api/posts/:id` | `DELETE` | Cancel/delete a post |
| `/api/integrations` | `GET` | List connected platform accounts |

All requests use `Authorization: Bearer {POSTIZ_API_KEY}` header. No session cookies.

```typescript
// Safe integration pattern — HTTP only, no imports
const POST_POSTIZ = `${env.POSTIZ_URL}/api/posts`;

const res = await fetch(POST_POSTIZ, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.POSTIZ_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ content, platformIntegrationId, publishDate }),
});
```

---

## Per-Provider Migration Plan

When a native provider reaches `stable` stage, new accounts for that platform stop being routed to Postiz. Existing Postiz accounts are migrated.

### Migration Trigger Conditions

A provider is ready to migrate away from Postiz when:
- Feature flag `social_{platform}` is at stage `stable`, `rollout_percent = 100`
- E2E test suite for the provider passes on production
- At least 1 week at stable without a P1 incident

### Migration Steps Per Provider

1. Set `NATIVE_SOCIAL_{PLATFORM}_ENABLED = true` in Worker config.
2. New OAuth connections for that platform go to native social.
3. Export existing Postiz accounts for that platform via Postiz API:
   ```bash
   GET /api/integrations?platform=twitter
   ```
4. Re-authorize each account through the native social OAuth flow (tokens cannot be transferred — re-auth is required).
5. Export pending scheduled posts for that platform:
   ```bash
   GET /api/posts?status=QUEUE&platform=twitter
   ```
6. Re-create pending posts in the native social queue.
7. Once all accounts migrated, remove the Postiz routing code for that platform.
8. When all providers migrated: decommission the Postiz container per the sunset plan in [postiz.md](../services/postiz.md).

---

## Platform-Specific Notes (From Postiz Research)

### Twitter / X

- OAuth 2.0 with PKCE; scopes: `tweet.read tweet.write users.read offline.access`
- Media upload is two-step: upload media first → get `media_id` → attach to tweet
- Rate limit: 300 tweets per 15 minutes per app (not per user)
- Character limit: 280 (plain text); URLs count as 23 characters

### LinkedIn

- OAuth 2.0; scopes: `r_liteprofile r_emailaddress w_member_social`
- Image upload requires `registerUpload` step before the post
- Character limit: 3000 characters for posts
- Rate limit: 100 requests per day per member (very conservative)

### Facebook

- OAuth 2.0 via Facebook Graph API; requires Page access token (not user token)
- Image posts: `/{page-id}/photos`, text posts: `/{page-id}/feed`
- Rate limit: tier-based; ~200 calls per hour per user token

### Instagram

- Requires Facebook Business account + Instagram Professional account linked
- Two-step: create media container → publish container
- Supported media: JPEG/PNG images, MP4 videos
- Character limit: 2200 characters for captions

---

## Related Docs

- [Social publishing overview](./README.md)
- [Native social architecture](./native-social-architecture.md)
- [Postiz service docs](../services/postiz.md)
