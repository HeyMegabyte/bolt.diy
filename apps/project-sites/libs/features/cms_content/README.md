# cms_content

The worker-side half of the Payload CMS ↔ generated-site loop. Generated sites
consume an edge-cached blog feed through our own domain, and a publish in the CMS
purges that cache within seconds via an HMAC-signed webhook.

Pairs with the Payload side already shipped: `infra/payload/app/src/hooks/notify-sites.ts`
(the webhook-out) and `infra/payload/app/src/endpoints/blog.ts` (the upstream feed).

## Endpoints

```
GET  /api/cms/blog.json?limit=50      Public (flag-gated). CORS-open, 5-min edge cache.
POST /api/cms/revalidate              Payload notify-sites receiver. HMAC-verified.
```

### GET /api/cms/blog.json

Proxies `cms.projectsites.dev/api/blog.json`, caches the validated result in
`CACHE_KV` for 5 minutes, and serves it CORS-open so any generated site can fetch
it client-side or at build time. Degrades to `{ "count": 0, "posts": [] }` on any
upstream failure — a stale CMS never 500s a consuming site.

### POST /api/cms/revalidate

Receives the `notify-sites` webhook. Verifies `X-PS-Signature`
(`HMAC-SHA256(rawBody, SITES_REVALIDATE_SECRET)`, hex) in constant time, then
purges the cached feed pages.

- Secret unset → `503` (dark-safe; receiver ships ahead of the secret)
- Bad signature → `401`
- Malformed payload → `400`
- Valid → `200 { ok: true, purged: true }`

## Reaching the Access-gated CMS

`cms.projectsites.dev` is behind Cloudflare Access. The service reuses the existing
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` service token (already used for
container builds) as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers.
Alternatively add a CF Access bypass for the public `/api/blog.json` path.

## Feature flag

Key: `cms_content` — `enabled=0, rollout_percent=0, stage='experimental'`.
When off, both endpoints return `404` (never 403).

## Wire-up

`src/index.ts`:

```ts
import { cmsContent } from '../libs/features/cms_content/handlers.js';
app.route('/', cmsContent);
```

`src/modules/feature_flags/registry.ts` — add a `cms_content` entry.

## Required secret (both sides must match)

```bash
# Generate once, then set the SAME value on the worker and the Payload container:
openssl rand -hex 32
npx wrangler secret put SITES_REVALIDATE_SECRET --env production
# Payload container env: SITES_REVALIDATE_SECRET + SITES_REVALIDATE_URL=https://projectsites.dev/api/cms/revalidate
```

## Safe disabled behavior

Both endpoints 404 when the flag is off. The Payload `notify-sites` hook is itself
a no-op until `SITES_REVALIDATE_URL` is set, so nothing fires before both halves
are configured.
