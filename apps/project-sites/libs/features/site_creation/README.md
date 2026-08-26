# site_creation

The **AI-assisted site-creation cluster** — the routes the create wizard leans on to
turn a business selection into a live site. `create-from-search` mints the site row
(auto-slugged) and starts the generation workflow; `improve-prompt`/`generate-prompt`
shape the build prompt via Workers AI; `categorize` classifies the business (driving
template/vertical selection). **Core, un-gated** routes (no feature flag) — a
route-organization module extracted VERBATIM from the `search.ts` monolith
(route-decomposition installment 27).

## Routes (`handlers.ts` → `siteCreation`, mounted at `app.route('/', siteCreation)`)

| Method | Path                            | Auth |
| ------ | ------------------------------- | ---- |
| POST   | `/api/sites/create-from-search` | org  |
| POST   | `/api/sites/improve-prompt`     | org  |
| POST   | `/api/sites/generate-prompt`    | org  |
| POST   | `/api/ai/categorize`            | org  |

## Boundaries

- All four are org-scoped (`c.get('orgId')` + explicit `401`). Uses search.ts's own
  scaffolding — inline auth + no `onError` (throws bubble to the app-level handler),
  NOT `ai_admin_kit`.
- **MUST mount before `search` + `api`** (mirrors `src/index.ts`): the `/api/sites/*`
  paths would otherwise be shadowed by api's `/api/sites/:id` param route.
- The exclusive `generateSmartSlug` (AI slug from a business name) and
  `ensureUniqueSlug` (R2-`_manifest.json` uniqueness check, appends `-N` on collision)
  helpers moved here.
- **Known duplication (left as-is):** `src/routes/api.ts` has its own same-named
  `ensureUniqueSlug` — a separate R2-manifest checker. Two implementations of the same
  concept; consolidating them into one owner is a future increment, not folded here to
  keep this extraction behavior-neutral.
