# Payload CMS — cms.projectsites.dev

Payload 3.85 (Next.js standalone) on a Cloudflare Workers Container. Schema + content
in Neon Postgres; media in R2; behind Cloudflare Access. Admin at `/admin`, public
frontend at `/`.

## Schema migrations (REQUIRED — `push:true` is dev-only)

Payload's postgres `push:true` does NOT create the schema in production. Apply
migrations with `./migrate.sh` (runs the Payload CLI in a Node-22 container against
Neon — the local Mac's Node 26 breaks Payload's tsx loader). Run once for the initial
schema, and again after any collection change. Tables come from `app/src/migrations/*`,
NOT from a boot-time push. First admin: `/admin/create-first-user`.

- `./migrate.sh` — create (diff schema → new migration) + apply.
- `./migrate.sh apply` — apply existing migrations only (also runs on container boot).

## Architecture

- **Collections** — `Posts` (blog), `Pages` (page-builder blocks), `Categories`
  (nested taxonomy), `Tags`, `Media` (R2 + responsive sizes), `Users` (roles + auth).
- **Globals** — `Header`, `Footer`, `SiteSettings`.
- **Access** (`src/access/`) — role-based + row-level helpers (`admins`, `editors`,
  `publishedOrAuth`, `adminsOrSelf`, field-level `adminsFieldLevel`).
- **Editor** (`src/lexical.ts`) — fixed/inline toolbar, internal-doc links, inline blocks.
- **Blocks** (`src/blocks/`) — Hero, Content, MediaBlock, CallToAction, Archive.
- **Hooks** (`src/hooks/`) — `populatePublishedAt`, virtual `readingTime`, on-demand
  ISR `revalidate`.
- **Plugins** — SEO, redirects, search, form-builder, nested-docs, S3 storage, Resend email.
- **Frontend** (`src/app/(frontend)/`) — renders published Pages + Posts, `/posts` blog,
  draft preview (`/next/preview`), live preview.
- **Delivery** — `sitemap.xml`, `robots.txt`, `feed.xml` (RSS), `/healthz` probe.
- **Jobs** — queue with `autoRun` cron (every minute) so scheduled-publish fires in-container.

## Env (forwarded into the container by `worker.ts`)

`DATABASE_URI`, `PAYLOAD_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `PAYLOAD_PUBLIC_SERVER_URL`.

## Deploy

`wrangler deploy` (needs Docker — builds `app/Dockerfile`). Run `./migrate.sh` first
when collections changed, so the new schema exists before the container boots.
