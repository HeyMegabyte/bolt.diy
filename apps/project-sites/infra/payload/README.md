
## Schema migrations (REQUIRED — `push:true` is dev-only)

Payload's postgres `push:true` does NOT create the schema in production. Apply
migrations with `./migrate.sh` (runs the Payload CLI in a Node-22 container against
Neon — the local Mac's Node 26 breaks Payload's tsx loader). Run once for the initial
schema, and again after any collection change. The `users` etc. tables come from
`app/src/migrations/*`, NOT from a boot-time push. First admin: `/admin/create-first-user`.
