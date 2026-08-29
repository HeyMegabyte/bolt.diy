/**
 * functions/api/hello.ts — your first Function.
 *
 * FILE-BASED ROUTING (edit the path, get a URL — Cloudflare Pages style):
 *   functions/api/hello.ts        →  /api/hello
 *   functions/api/orders/[id].ts  →  /api/orders/:id     (ctx.params.id)
 *   functions/api/[[path]].ts     →  /api/*  (catch-all → ctx.params['*'])
 *   functions/api/index.ts        →  /api
 *
 * HANDLERS — export one per method, or a single `onRequest` for all methods:
 *   onRequestGet · onRequestPost · onRequestPut · onRequestPatch ·
 *   onRequestDelete · onRequestHead · onRequestOptions · onRequest
 *
 * Each handler receives ONE context object:
 *   ctx.request           – the incoming Request
 *   ctx.params            – { [name]: string } from [dynamic] path segments
 *   ctx.env               – your bindings (below)
 *   ctx.waitUntil(promise)– keep async work alive after you return the Response
 *
 * BINDINGS on ctx.env (ProjectSites injects these on Publish):
 *   env.AI                        – Workers AI. Debits your site's AI credits;
 *                                   calls fail clearly when the balance is empty.
 *   env.DATA.forms.list({limit})  – your form submissions (read-only, this site)
 *   env.DATA.site()               – your site config / brand / metadata (read-only)
 *   env.KV                        – a per-site KV namespace (scratch key/value)
 *   env.R2                        – a per-site R2 prefix (files/uploads, ~25 MB body cap)
 *   env.SECRETS.<KEY>             – your env vars (manage them in Admin → Env Vars;
 *                                   a site value overrides an org value on key clash)
 *
 * RULES:
 *   • Reserved paths you can't define: /api/contact-form/* and /api/_ps/*
 *     (ProjectSites owns those). Any other /api/* path is yours.
 *   • npm packages are allowed — add a functions/package.json; we install + bundle.
 *   • JS or TS. No build step to run yourself — Publish bundles functions/ for you.
 *   • Preview before you ship: hit /api/test-publish to run the CURRENT functions/
 *     without promoting them; a real Publish promotes them live.
 */

/** GET /api/hello?name=Ada → a friendly JSON greeting. */
export const onRequestGet = ({ request }: { request: Request }): Response => {
  const name = new URL(request.url).searchParams.get('name') ?? 'world';
  return Response.json({
    ok: true,
    message: `Hello, ${name}!`,
    from: 'functions/api/hello.ts',
  });
};

/**
 * POST /api/hello → echoes the JSON body you send.
 *
 * Turn this into an AI endpoint by using env.AI (uncomment + accept `ctx`):
 *   export const onRequestPost = async (ctx: { request: Request; env: any }) => {
 *     const { prompt } = await ctx.request.json();
 *     const ai = await ctx.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
 *       messages: [{ role: 'user', content: String(prompt ?? '') }],
 *     });
 *     return Response.json({ ok: true, ai });
 *   };
 */
export const onRequestPost = async ({ request }: { request: Request }): Promise<Response> => {
  const youSent = await request.json().catch(() => ({}));
  return Response.json({ ok: true, youSent });
};
