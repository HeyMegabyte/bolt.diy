# cmdk_ai_actions

Resolves natural-language admin commands to structured action intents using Workers AI, powering the Cmd+K command palette.

## Flag

Key: `cmdk_ai_actions`
Default: disabled (`enabled=0, rollout=0, stage='experimental'`)

## API

| Method | Path | Auth |
|--------|------|------|
| POST | /api/cmdk/resolve | Bearer JWT (userId required) |

### Request

```json
{
  "query": "go to analytics",
  "context": {
    "route": "/admin/sites",
    "siteSlug": "my-site"
  }
}
```

### Response (200)

```json
{
  "ok": true,
  "data": {
    "action": "view_analytics",
    "target": "/admin/analytics",
    "label": "View Analytics",
    "confidence": 0.92
  }
}
```

### Supported action tokens

| Token | Meaning |
|-------|---------|
| `navigate` | Navigate to a specific route |
| `create_site` | Open the create-site flow |
| `open_settings` | Open admin settings |
| `search` | Trigger a search |
| `publish_site` | Publish the active site |
| `view_analytics` | Open analytics dashboard |
| `manage_domains` | Open domain management |
| `open_docs` | Open documentation |
| `unknown` | No confident match found |

### Error responses

| Status | code | Cause |
|--------|------|-------|
| 401 | UNAUTHORIZED | No authenticated user |
| 404 | NOT_FOUND | Flag is off |
| 422 | VALIDATION_ERROR | Bad request body |

## Required bindings

- `AI` — Workers AI binding (present when `[ai]` is declared in `wrangler.toml`)

## Model

`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

## Safe disabled behavior

When the flag is off, the endpoint returns 404. The command palette falls back to deterministic search.

## Frontend integration

Check `data.confidence` before acting. When `confidence < 0.5` or `action === 'unknown'`, fall back to showing the regular search results.

## Removal

Drop the `POST /api/cmdk/resolve` handler mount from `src/index.ts` and remove the `cmdk_ai_actions` row from `feature_flags`.
