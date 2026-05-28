# content_freshness

Daily AI-powered content freshness loop: scans every published site section for
staleness (last-edited >90 days), runs a Workers AI Llama rewrite, and posts the
draft to the Task Inbox for owner approval before publishing.

## What it does

1. **Cron trigger** — fires daily at 06:00 UTC via Wrangler `[triggers] crons`.
2. **`scheduledContentFreshness(env)`** — iterates over all `published` sites,
   scores each section by last-edit date + CWV data, selects candidates.
3. **Rewrite** — calls Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
   with a brand-aware system prompt to refresh the section copy.
4. **Draft** — posts an approval task to `task_inbox` (`taskKind: 'content_freshness_review'`).
5. **Admin approval UI** — `/admin/sites/:id/freshness` shows pending drafts;
   owner can approve (publish) or reject.

## Where surfaces live

| Surface | Path |
|---------|------|
| Admin routes | `src/routes/content.ts` — `GET /freshness`, `POST /freshness/{approve,reject}/:draftId` |
| Core service | `src/services/content_freshness.ts` |
| Workflow class | `src/workflows/content-freshness-workflow.ts` — `ContentFreshnessWorkflow` |
| Cron handler | `src/index.ts` ~line 1007 (`scheduled` handler at `06:00`) |
| Workflow export | `src/index.ts` line 97 |
| Admin UI (DRIFT) | Not yet — needs `frontend/…/admin/sections/content-freshness.component.ts` |

## Flag key

`content_freshness` — `cornerstone_autorefresh` is the related GEO-category flag
for monthly cornerstone page refresh; `content_freshness` is the daily section loop.

## Tests

| Suite | Count | Files |
|-------|-------|-------|
| E2E | 7 tests | `e2e/content/content-freshness.spec.ts` |
| Unit | **0** | DRIFT — `src/__tests__/content_freshness.test.ts` missing |

## Drift notes

- **No unit tests** — `src/__tests__/content_freshness.test.ts` is missing.
  Needs tests for `scanStaleSections`, `rewriteSection`, and `createRewriteDraft`.
- Draft state uses `task_inbox` table (no dedicated schema). A dedicated
  `content_freshness_drafts` table would allow better querying + soft-delete.
- No Angular admin component yet — `/admin/sites/:id/freshness` returns 404 on the SPA.

## Wrangler bindings required

```toml
[[workflows]]
name = "CONTENT_FRESHNESS_WORKFLOW"
binding = "CONTENT_FRESHNESS_WORKFLOW"
class_name = "ContentFreshnessWorkflow"

[triggers]
crons = ["0 6 * * *"]
```

## Removal

See `removalNotes` in `feature.manifest.ts`.
