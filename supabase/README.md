# supabase/ — REFERENCE ONLY (archival)

> **Not the production database.** projectsites.dev runs on **Cloudflare D1** (SQLite) —
> see `apps/project-sites/migrations/` for the live schema and `apps/project-sites/CLAUDE.md`
> § D1 Database for the system of record.

These Postgres migrations are kept only as a **reference schema** from an earlier design
era. They are NOT applied anywhere, NOT wired into any build, and NOT a fallback. Do not
assume Postgres/Supabase semantics from this folder — the running system is D1 + KV + R2
per `docs/architecture/cloudflare-first.md`.

If you need the authoritative schema, read the D1 migrations, not these files.
