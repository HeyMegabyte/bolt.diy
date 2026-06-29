# Plane S3 Shim — r2s3.projectsites.dev

S3 **POST-Object compatibility shim** for Plane's media on Cloudflare R2.

## Why it exists
Plane uploads avatars/attachments with an S3 **presigned POST** (browser → bucket-root POST).
**Cloudflare R2 does NOT implement S3 `PostObject`** → 501, so Plane uploads break on R2 (see
memory `plane-r2-no-post-object`). This Worker is Plane's `AWS_S3_ENDPOINT_URL` and presents a
minimal S3 facade over the `plane-media` **R2 binding**, implementing the full surface Plane uses:
POST Object (the bit R2 lacks) + GET/HEAD/PUT/DELETE/CopyObject/batch-delete. Keeps R2 (CF-first);
no second storage vendor.

## Security
- **POST Object**: validates the browser's S3 POST-policy signature (`hex(HMAC(sigKey, base64policy))`).
- **PUT/DELETE/Copy/batch-delete**: validates the SigV4 `Authorization` header (canonical request).
- Both re-derive the signature with `R2_SECRET_ACCESS_KEY` (= the plane-media secret Plane signs with).
- **GET/HEAD**: capability-by-key (unguessable UUID keys; matches presigned-GET shareability).
- Crypto verified offline against boto3 + botocore (POST policy + SigV4 header both match exactly),
  and end-to-end with real creds: upload→204, GET→200, tampered-sig→403.

## Deploy
Plain Worker (R2 binding, **no container → no Docker**). `apps/project-sites/infra/plane-s3/`.
Push to the dir → `.github/workflows/plane-s3-deploy.yaml` runs `wrangler deploy` + sets
`R2_SECRET_ACCESS_KEY` (from GitHub secret `PLANE_R2_SECRET_ACCESS_KEY`) + verifies the preflight.
Route `r2s3.projectsites.dev/*` (beats the main worker wildcard); WAF skip added for the host.

## Wiring
- Plane (`infra/plane/worker.ts`) sets `AWS_S3_ENDPOINT_URL = https://r2s3.projectsites.dev`.
- R2 CORS on `plane-media` allows the pm origins (also needed); the shim returns CORS headers too.

## Notes
- Path-style addressing only (`/plane-media/<key>`) — what boto uses for custom endpoints.
- `formData()` buffers the POST body in memory (fine for avatars/typical attachments); very large
  uploads would need a streaming-multipart rework.
