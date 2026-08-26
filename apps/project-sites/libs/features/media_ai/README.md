# media_ai

The **AI media pipeline** for the site-build flow: discover images + videos for a
generated site, AI-edit an image, and proxy external image URLs so the frontend can
render them without CORS/mixed-content failures. **Core, un-gated** routes (no
feature flag) — a route-organization module extracted VERBATIM from the `search.ts`
monolith (route-decomposition installment 26).

## Routes (`handlers.ts` → `mediaAi`, mounted at `app.route('/', mediaAi)`)

| Method | Path                      | Auth          |
| ------ | ------------------------- | ------------- |
| GET    | `/api/image-proxy`        | public        |
| POST   | `/api/ai/discover-images` | build/authed  |
| POST   | `/api/ai/discover-videos` | build/authed  |
| POST   | `/api/ai/edit-image`      | build/authed  |

## Boundaries

- `image-proxy` is an **SSRF-guarded** external-image proxy: `isProxyableImageUrl`
  allows `http|https` to a PUBLIC host only — blocking localhost/`.local`,
  private/reserved IPv4, the cloud-metadata endpoint (169.254.169.254), IPv6
  loopback/link-local/ULA, and IPv4-mapped IPv6. It permits `http` (legacy/cloned
  image sources are often plain http). The SSRF contract is unit-tested against the
  exported `isProxyableImageUrl` (see `src/__tests__/search_routes.test.ts`).
- `discover-images` returns URLs wrapped through `${DOMAINS.SITES_BASE}/api/image-proxy`
  so the proxy is the single fetch path for external/cloned media — which is why the
  proxy and the discovery routes live in the **same module** and share the
  `isProxyableImageUrl` guard.
- The exclusive `isProxyableImageUrl` guard, the `ImageQualityResult` /
  `DiscoveredImage` interfaces, and the `scrapePageImages` helper (all used only by
  these four routes) moved here; `gatewayFetch` (the AI-gateway fetch wrapper) and
  `DOMAINS` are re-imported. No `onError` — the routes return explicit JSON, matching
  the app-level error handling exactly as before the extraction.
