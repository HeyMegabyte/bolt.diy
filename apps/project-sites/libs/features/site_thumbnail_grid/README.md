# site_thumbnail_grid

Browser-rendered thumbnails for published projectsites.dev sites, cached in R2.

## What it does

- `GET /api/sites/:siteId/thumbnail` checks R2 for a cached PNG thumbnail.
- If found, returns the CDN URL immediately (no generation cost).
- If not found, calls the Cloudflare Browser Rendering screenshot API (1280x720), stores the result in R2, and returns the CDN URL.
- On any error (missing CF credentials, API failure) returns `{ thumbnailUrl: null, generated: false }` — never throws.

## Flag key

`site_thumbnail_grid`

## Rollout defaults

- `enabled: 0`
- `rollout_percent: 0`
- `stage: experimental`

## Safe disabled behavior

When the flag is off the route returns 404. No R2 objects are written. Existing cached thumbnails in R2 remain accessible via CDN directly.

## Required env bindings

- `SITES_BUCKET` — R2Bucket binding (already wired in wrangler.toml)
- `CF_ACCOUNT_ID` — Cloudflare account ID (worker secret)
- `CLOUDFLARE_API_TOKEN` — API token with Browser Rendering permission (worker secret)

## R2 paths

Thumbnails are stored at `thumbnails/{siteId}.png` and served from `https://cdn.projectsites.dev/thumbnails/{siteId}.png`.

## Routes

| Method | Path                          | Auth     |
|--------|-------------------------------|----------|
| GET    | /api/sites/:siteId/thumbnail  | required |

## Register in index.ts

```ts
import { siteThumbnailGrid } from '../libs/features/site_thumbnail_grid/handlers.js';
app.route('/', siteThumbnailGrid);
```
