# Services & Social

## Social publishing

Two components: **Postiz** (transition only) and **Native Social** (long-term product). When a native provider reaches `stable`, new connections for that provider stop routing to Postiz; the Postiz container stays live for existing accounts until all providers migrate.

| Component | Status | URL | Tech |
|---|---|---|---|
| Postiz (reference) | transition only | social.projectsites.dev | AGPL CF Container |
| Native Social | in development | /admin/social | Hono + CF Queues + Durable Objects + CF Workflows + R2 |

All new social work goes into Native Social; Postiz gets no new features. Native Social is NOT dependent on Postiz runtime, NOT built on Temporal/any external workflow engine, NOT a wrapper around Postiz.

### Native architecture (CF primitives)

- **One Durable Object per connected account** (`SocialAccountDO`, keyed `{platform}:{accountId}`): encrypted OAuth tokens, rate-limit state (default 1 min between posts), publish history (last 100). wrangler: `[[durable_objects.bindings]] name="SOCIAL_ACCOUNT_DO" class_name="SocialAccountDO"` + `[[migrations]] new_sqlite_classes=["SocialAccountDO"]`.
- **CF Queues** decouple publish from execution; **CF Workflows** run scheduled posts with step-level retries; **R2** stores media before platform upload. Every provider behind a flag (`social_twitter`, `social_linkedin`, …); never instantiated when flag off.

**`SocialProvider` interface** (`src/services/social/provider.ts`): `connect({tenantId,redirectUri,state})→{authUrl}` · `handleCallback(...)→SocialAccount` · `publish({tenantId,accountId,content,mediaR2Keys?})→PublishResult` · `getStatus(...)` · `disconnect(...)`. `SocialPlatform = 'twitter'|'linkedin'|'facebook'|'instagram'`.

**Publish flow:** `POST /api/social/publish` (auth, Zod) → enqueues `SOCIAL_PUBLISH_QUEUE` → consumer checks per-account rate limit (`message.retry({delaySeconds})` if blocked) → `provider.publish` → record. Scheduled posts run `SocialScheduledPublishWorkflow`: validate-account → upload-media → publish → record-result.

**API routes:** `POST /api/social/connect` · `GET /api/social/callback/:platform` · `GET /api/social/accounts` · `DELETE /api/social/accounts/:accountId` · `POST /api/social/publish` · `GET /api/social/posts` · `DELETE /api/social/posts/:postId`.
**Env:** `SOCIAL_SIGNING_KEY` (HMAC for OAuth state) · `SOCIAL_DO_NAMESPACE` · `SOCIAL_R2_BUCKET` · `SOCIAL_{TWITTER,LINKEDIN}_CLIENT_ID`/`_SECRET`.
Providers (all Planned): TwitterProvider/`social_twitter`, LinkedInProvider/`social_linkedin`, FacebookProvider/`social_facebook`, InstagramProvider/`social_instagram`.

### Postiz as reference (study, never import)

> **AGPL-3.0 — strict isolation** (see global rule `agpl-isolation-via-http-boundary`). Postiz code MUST NEVER be imported into the main Worker or any shared package. HTTP API ONLY — no shared libraries, no shared types. Reading source to learn patterns is safe; copyleft triggers on INCLUSION of the code in the distributed work, not on reading.

Borrow patterns (not code): provider abstraction (`integration.manager.ts`), OAuth/PKCE state signing + token refresh, scheduling/calendar UX, media pre-upload + MIME/size validation, per-platform quirks, post-preview mockups, bulk scheduling. NOT to borrow: AGPL source, Prisma schema/migrations (native uses D1), NestJS structure (native uses Hono), `@gitroom/*` npm packages, Docker layers.

**Transition HTTP API** (main Worker → Postiz, `Authorization: Bearer {POSTIZ_API_KEY}`, no cookies): `POST /api/posts`, `GET /api/posts`, `DELETE /api/posts/:id`, `GET /api/integrations`.

**Per-provider migration.** Trigger: flag `social_{platform}` `stable` + `rollout_percent=100` + E2E green on prod + ≥1 week without P1. Steps: (1) `NATIVE_SOCIAL_{PLATFORM}_ENABLED=true`; (2) new OAuth → native; (3) export accounts; (4) re-authorize each (tokens cannot transfer); (5) export pending posts; (6) recreate in native queue; (7) remove Postiz routing for that platform; (8) all migrated → decommission container.

### Per-provider notes

- **Twitter/X** — OAuth 2.0 + PKCE; scopes `tweet.read tweet.write users.read offline.access`. Media: upload→`media_id`→attach. 300 tweets/15min per app. 280 chars (URLs = 23).
- **LinkedIn** — OAuth 2.0; scopes `r_liteprofile r_emailaddress w_member_social`. Image needs `registerUpload`. 3000 chars. 100 req/day per member.
- **Facebook** — Graph API; requires Page access token. Image `/{page-id}/photos`, text `/{page-id}/feed`. ~200 calls/hr.
- **Instagram** — needs FB Business + IG Professional linked. Two-step: create container → publish. JPEG/PNG/MP4. 2200-char captions.

## Chatwoot support service

Customer support at **support.projectsites.dev**, on **Fly.io** (needs multi-process supervision — Rails, Sidekiq, PostgreSQL, Redis — which a single-process CF Container can't provide).

**fly.toml:** app `projectsites-chatwoot`, `primary_region="iad"`, image `chatwoot/chatwoot:v3.12.0`, `internal_port=3000`, port 443 (`tls`,`http`), http_check `GET /auth/sign_in`. `[env]`: `RAILS_ENV=production`, `INSTALLATION_NAME="ProjectSites Support"`, `DEFAULT_LOCALE=en`, `FRONTEND_URL=https://support.projectsites.dev`, `FORCE_SSL=true`, `ENABLE_ACCOUNT_SIGNUP=false`.

**Data:** Postgres = a **new database in the existing shared Neon project** (per Neon Database Conservation): `CREATE DATABASE projectsites_chatwoot;`. Redis = dedicated **Upstash** DB: `REDIS_URL="rediss://default:<pwd>@<host>.upstash.io:6379"`.
**Fly secrets:** `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY_BASE`, `MAILER_SENDER_EMAIL`, `SMTP_ADDRESS`/`_USERNAME`/`_PASSWORD`.
**Worker secrets:** `CHATWOOT_API_KEY`, `CHATWOOT_API_URL` (`https://support.projectsites.dev`), `CHATWOOT_WEBHOOK_TOKEN`, `CHATWOOT_INBOX_ID`, `CHATWOOT_ACCOUNT_ID`.

**Worker integration** (`src/services/chatwoot.ts`): `createSupportConversation` searches/creates a contact (`/api/v1/accounts/{ACCOUNT_ID}/contacts/search?q={email}` then `/contacts`), then creates a conversation (`/conversations` with `inbox_id`, `contact_id`, `additional_attributes:{tenant_id,subject}`, `initial_message`). Auth `api_access_token: {CHATWOOT_API_KEY}`. Returns `null` on failure.
**Webhook** (`POST /webhooks/chatwoot`): verify `X-Chatwoot-Signature` == `CHATWOOT_WEBHOOK_TOKEN` (else 401). `conversation_status_changed`→`resolved` notifies tenant via psnotify; `message_created` agent reply → notify.
**Email routing:** `support@projectsites.dev` → Chatwoot email inbox (Settings → Inboxes → Email gives a `@chatwoot.io` forwarding address; Resend rule forwards to it). Alternative: IMAP polling.

## Postiz service (AGPL-isolation via HTTP boundary)

Runs as a **CF Container at social.projectsites.dev**, image `ghcr.io/gitroomhq/postiz-app:latest`, port 3000. wrangler `[[containers]] name="postiz"` + binding `durable_object_namespace POSTIZ_DO` class `PostizContainerDO`. Transition service — decommission when native social reaches beta.

**Container secrets:** `POSTIZ_DATABASE_URL` (Neon), `POSTIZ_REDIS_URL` (Upstash), `POSTIZ_JWT_SECRET`, `POSTIZ_BACKEND_INTERNAL_URL`, `POSTIZ_NEXT_PUBLIC_BACKEND_URL`.
**Main-Worker env (HTTP only):** `POSTIZ_URL` (`https://social.projectsites.dev`), `POSTIZ_API_KEY`, `POSTIZ_SECRET`.
**Integration** (`src/services/postiz.ts`, no Postiz types imported — all shapes locally defined): `createPost`/`listPosts`/`deletePost` via `${POSTIZ_URL}/api/posts` with `Authorization: Bearer {POSTIZ_API_KEY}`.

**Sunset plan:** (1) ship TwitterProvider → stop routing Twitter; (2) LinkedInProvider; (3) Facebook + Instagram; (4) migrate remaining scheduled posts (export → native queue); (5) flip `postiz_container` flag to `killswitch`; (6) decommission container (remove from `wrangler.toml`, delete container).
