# url_clone_seed

Seeds a new site draft by extracting content from a source URL via Cloudflare Browser Rendering.

## Flag

Key: `url_clone_seed`
Default: disabled (`enabled=0, rollout=0, stage='experimental'`)

## API

| Method | Path | Auth |
|--------|------|------|
| POST | /api/clone/seed | Bearer JWT (userId required) |

### Request

```json
{
  "url": "https://example.com",
  "siteId": "site-abc-123"
}
```

### Response (200)

```json
{
  "ok": true,
  "data": {
    "title": "Example Domain",
    "description": "This domain is for use in illustrative examples.",
    "textLength": 1234,
    "extractedAt": "2026-06-17T00:00:00.000Z"
  }
}
```

### Error responses

| Status | code | Cause |
|--------|------|-------|
| 401 | UNAUTHORIZED | No authenticated user |
| 404 | NOT_FOUND | Flag is off |
| 422 | VALIDATION_ERROR | Bad request body |
| 502 | EXTRACTION_FAILED | Browser Rendering API failed or timed out |

## Required secrets

- `CF_ACCOUNT_ID` — Cloudflare account ID for the Browser Rendering API
- `CF_API_TOKEN` — CF API token with `Browser Rendering: Read` permission

## Safe disabled behavior

When the flag is off, the endpoint returns 404. No content is exposed.

## Removal

Drop the `POST /api/clone/seed` handler mount from `src/index.ts` and remove the `url_clone_seed` row from `feature_flags`.
