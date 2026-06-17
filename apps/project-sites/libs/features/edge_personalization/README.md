# edge_personalization

Flag key: `edge_personalization` | Stage: alpha | Owner: brian@megabyte.space

Rules-based visitor variant selection using geo, device, referrer, time, and return-visitor signals. No PII stored.

## Routes

- `POST /api/personalize/:siteId/variants` — upsert variant rules for a site
- `GET /api/personalize/:siteId/resolve?geo=US&device=mobile&hour=14&isReturn=false` — resolve which variant to show

## D1 Table

`site_personalization_variants` (created in migration 0550).

## Safe disabled behavior

All routes return 404.
