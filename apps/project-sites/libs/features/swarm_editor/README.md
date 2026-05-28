# swarm_editor

Wave 2C feature #5 — Multi-Agent Swarm Editor. Seven specialist Claude Code
subagents co-edit a customer site simultaneously via non-overlapping file-glob
partitions, pushing live progress to the admin via SSE.

## What it does

- **7 specialists**: visual / copy / seo / a11y / motion / media / qa.
- Each agent owns a set of file globs so edits never conflict.
- A merge-conflict detector fires if a path appears in two partitions.
- Admin board at `/admin/swarm/:siteId` — 7-column live progress grid.
- `?mode=progressive` on the stream reuses the SSE channel for Wave 2C #6
  (Live Component-Stream Preview).

## Where surfaces live

| Surface | Path |
|---------|------|
| Worker routes | `src/routes/swarm.ts` |
| IDE sandbox service | `src/services/ide_sandbox.ts` |
| Admin component | `frontend/src/app/pages/admin/sections/swarm.component.ts` |
| Progressive preview | `frontend/src/app/pages/admin/sections/progressive-preview.component.ts` |
| Angular lazy route | `frontend/src/app/app.routes.ts` — `/admin/swarm/:siteId` |

## Flag key

`swarm_editor` — default off. Companion flags: `live_stream_preview` (#6).

## Tests

| Suite | Count | Files |
|-------|-------|-------|
| E2E happy-path | 7 tests | `e2e/swarm/swarm.spec.ts` |
| E2E fortress happy | 6 tests | `e2e/_fortress/swarm-editor/happy-path.spec.ts` |
| E2E fortress adversarial | 7 tests | `e2e/_fortress/swarm-editor/adversarial.spec.ts` |
| Unit | **0** | DRIFT — `src/__tests__/swarm.test.ts` missing |

## Drift notes

- **No unit tests** — needs `src/__tests__/swarm.test.ts` covering the
  conflict-detector logic and SSE message format.
- `swarm_runs` table has no formal migration file; schema is bootstrapped
  inline on first run. A dedicated `0xxx_swarm_runs.sql` migration is needed.

## How to enable for testing

```bash
# Override for one org
curl -X POST https://projectsites.dev/api/super-admin/feature-flags/swarm_editor/override \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"org_id":"<your_org>","enabled":1}'
```

## Removal

See `removalNotes` in `feature.manifest.ts`.
