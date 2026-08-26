# site_github

Per-site **GitHub OAuth backup** — the owner-tapped "Connect GitHub" flow that
mirrors a site's current build to a private GitHub repo via a snapshot-scoped
branch + Pull Request. No token paste, no repo name: the owner consents on
github.com, comes back to `/admin/github`, and the repo name auto-derives from
the site slug (`{slug}-projectsites-dev`). **Core, un-gated** routes (no feature
flag) — this is a route-organization module extracted from the `api.ts` monolith
(route-decomposition installment 11), not a dark-launched feature.

## Routes (`handlers.ts` → `siteGithub`, mounted at `app.route('/', siteGithub)`)

| Method | Path                                | Auth  |
| ------ | ----------------------------------- | ----- |
| GET    | `/api/sites/:id/github/status`      | orgId |
| GET    | `/api/sites/:id/github/connect`     | orgId |
| GET    | `/api/sites/:id/github/callback`    | orgId |
| POST   | `/api/sites/:id/github/backup`      | orgId |
| POST   | `/api/sites/:id/github/disconnect`  | orgId |

## Boundaries

- Extracted VERBATIM from `api.ts` — the handler bodies are byte-for-byte
  unchanged; only the route-registration receiver changed (`api.` →
  `siteGithub.`).
- The GitHub OAuth here is **site-scoped** (repo backup) — it does NOT touch the
  app auth middleware (magic-link / Better Auth / D1 sessions). The `state` row
  in `github_backup_states` is single-use and org-checked.
- Org-ownership is enforced via `requireOwnedSite` (404 never 403) so cross-org
  sites never leak. The `return_url` is clamped to a same-origin relative path
  (`safeRelativePath`) so the callback redirect can't be an open redirect.
- The customer's OAuth token is encrypted at rest (`encrypt` /
  `decryptOrPassthrough` from `services/ai_crypto`); legacy plaintext rows pass
  through and re-encrypt on the owner's next connect.
- The private helpers `loadAuthorizedSite`, `deriveRepoName`, `githubHeaders`,
  and `arrayBufferToBase64` moved alongside their only callers.
- Thrown `badRequest` / `unauthorized` / `notFound` are formatted by the
  app-level error handler.
