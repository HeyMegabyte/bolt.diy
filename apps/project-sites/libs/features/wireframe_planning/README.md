# wireframe_planning

Feature module that generates and stores a structured wireframe plan (ordered section list) for a site before AI site generation runs.

## Feature flag

**Key:** `wireframe_planning`
**Default:** `enabled=0, rollout_percent=0, stage=experimental`

All routes return `404` when the flag is off. Never `403` — do not leak feature existence.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/wireframe/plan` | Required | Create a wireframe plan for a site |
| `GET` | `/api/wireframe/:siteId` | Required | Fetch the latest wireframe plan for a site |

### POST /api/wireframe/plan

**Request body:**
```json
{ "siteId": "site_abc123", "prompt": "A modern plumbing company site" }
```

- `siteId` — required, non-empty string
- `prompt` — required, minimum 10 characters

**Response (201):**
```json
{
  "ok": true,
  "plan": {
    "id": "uuid",
    "siteId": "site_abc123",
    "prompt": "A modern plumbing company site",
    "sections": ["Hero", "About", "Services", "Contact"],
    "createdAt": "2026-06-17T00:00:00.000Z"
  }
}
```

### GET /api/wireframe/:siteId

Returns the most-recent plan for the site, or `{ ok: true, plan: null }` when none exists.

## D1 table

`wireframe_plans` — see `migrations/0560_wireframe_plans.sql`.

## Safe disabled behavior

When the flag is off:
- Both routes return `404 Not Found`
- The generation pipeline falls back to prompt-only layout (no wireframe consumed)
- No data is read or written

## Tests

Unit tests: `__tests__/wireframe_planning.test.ts`
E2E tests: `e2e/wireframe_planning/wireframe_planning.spec.ts` (pending)
