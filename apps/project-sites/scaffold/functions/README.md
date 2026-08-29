# Functions — code endpoints for your site

Drop a file in `functions/` and get a live API on your own domain. No dashboard,
no separate deploy — every **Publish** bundles this folder and ships it.

```
functions/
  api/
    hello.ts        →  GET/POST  https://<your-site>/api/hello
    orders/[id].ts  →  /api/orders/:id      (ctx.params.id)
    [[path]].ts     →  /api/*   catch-all    (ctx.params['*'])
  package.json      →  optional — declare npm deps; we install + bundle them
```

## Write a handler

Export one function per HTTP method (or a single `onRequest` for all):

```ts
export const onRequestGet = ({ request, params, env }) =>
  Response.json({ hello: params.id ?? 'world' });
```

`onRequestGet` · `onRequestPost` · `onRequestPut` · `onRequestPatch` ·
`onRequestDelete` · `onRequestHead` · `onRequestOptions` · `onRequest` (any method).

Every handler gets one context object:

| field | what it is |
|---|---|
| `ctx.request` | the incoming `Request` |
| `ctx.params` | `{ name: string }` from `[dynamic]` path segments (`[[catch-all]]` → `ctx.params['*']`) |
| `ctx.env` | your bindings (below) |
| `ctx.waitUntil(p)` | keep async work alive after you return the `Response` |

## Bindings (`ctx.env`)

| binding | what you get |
|---|---|
| `env.AI` | Workers AI — `env.AI.run(model, opts)`. **Debits your site's AI credits**; fails clearly when empty. |
| `env.DATA.forms.list({ limit })` | your form submissions — **read-only**, this site only |
| `env.DATA.site()` | your site config / brand / metadata — read-only |
| `env.KV` | a per-site KV namespace (scratch key/value storage) |
| `env.R2` | a per-site R2 prefix (files / uploads, ~25 MB request body cap) |
| `env.SECRETS.<KEY>` | your env vars — manage them in **Admin → Env Vars** (a site value overrides an org value) |

## Rules

- **Reserved paths** you can't define: `/api/contact-form/*` and `/api/_ps/*`
  (the platform owns those). A file on a reserved path is a **publish error** —
  rename it. Every other `/api/*` path is yours.
- **npm allowed** — add a `functions/package.json`; we `npm install` + bundle it
  into one Worker. Watch the bundle size.
- **JS or TS.** No build step to run — Publish does it.
- **Preview** the current `functions/` without shipping at **`/api/test-publish`**;
  a real **Publish** promotes them live. Endpoints **version with the site** —
  restoring a snapshot restores its functions too.

## Try `hello.ts`

After you publish:

```bash
curl https://<your-site>/api/hello?name=Ada
# { "ok": true, "message": "Hello, Ada!", "from": "functions/api/hello.ts" }

curl -X POST https://<your-site>/api/hello -d '{"a":1}' -H 'content-type: application/json'
# { "ok": true, "youSent": { "a": 1 } }
```
