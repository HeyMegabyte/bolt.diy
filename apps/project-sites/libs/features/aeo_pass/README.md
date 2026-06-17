# AEO Pass

Answer Engine Optimization audit module. Scores a published site for AI search
readiness and surfaces actionable issues so owners can improve their ranking in
ChatGPT, Perplexity, and Google AI Overviews.

## Feature flag

Key: `aeo_pass`
Default: `enabled=0, rollout_percent=0, stage='experimental'`

Toggle from `/admin/feature-flags`. Flag-off routes return 404.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/aeo/audit/:siteId` | Required | Run a new AEO audit |
| GET | `/api/aeo/:siteId` | Required | Fetch the latest audit |

## D1 table

`aeo_audits` — see `migrations/0561_aeo_audits.sql`

## v1 stub

Score is hardcoded at **72** and issues are the three canonical AEO gaps:

- Missing FAQ schema
- No quotable answer blocks
- Insufficient structured data

A real crawl-based scorer replaces the stub when the feature graduates to beta.

## Safe disabled behavior

When the flag is off, both endpoints return `404`. No site data is affected.

## Removal

1. `git rm -r libs/features/aeo_pass/`
2. Remove the `app.route('/', aeoPass)` mount from `src/index.ts`
3. Drop the D1 table via a new migration
