# status_page_live

Public platform health feed and incident management for projectsites.dev.

## What it does

- Exposes `GET /api/status/feed` — a public endpoint returning the overall platform status and open incidents.
- Exposes `POST /api/status/incident` — an authenticated endpoint for creating new incidents.
- Derives overall status from open incidents: any `critical` incident drives `outage`, any `major` drives `degraded`, otherwise `operational`.

## Flag key

`status_page_live`

## Rollout defaults

- `enabled: 0`
- `rollout_percent: 0`
- `stage: experimental`

## Safe disabled behavior

When the flag is off both routes return 404. No incidents are created or served. The D1 table remains intact for when the flag is re-enabled.

## D1 migration

`migrations/0562_status_incidents.sql` — creates the `status_incidents` table.

## Routes

| Method | Path                 | Auth     |
|--------|----------------------|----------|
| GET    | /api/status/feed     | public   |
| POST   | /api/status/incident | required |

## Register in index.ts

```ts
import { statusPageLive } from '../libs/features/status_page_live/handlers.js';
app.route('/', statusPageLive);
```
