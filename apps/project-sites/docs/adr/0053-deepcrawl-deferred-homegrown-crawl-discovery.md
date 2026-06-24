# 0053 — Homegrown crawl + discovery (Deepcrawl deferred)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§53 of the convergence include-list calls for Deepcrawl (managed crawl /
technical-SEO-audit SaaS). ProjectSites already owns Worker-native crawl +
discovery:

- **`services/import_crawler.ts`** — `crawlSiteForImport()` builds a typed
  `CrawlReport` / `InventoryUrl[]` for site-import (real browser UA + headers per
  `fetch-defaults`, robots/sitemap/Wayback inventory, `estimateRebuildMinutes`).
- **Image discovery** + **Cloudflare Browser Rendering** (the `browser-gateway`
  service, already `production` in the registry) cover JS-rendered crawl,
  screenshots, and content extraction at the edge.

Deepcrawl is a heavyweight managed crawler aimed at large-scale recurring
technical-SEO audits. Our crawl need is bounded and product-specific (crawl ONE
source site to import/rebuild it), already implemented Worker-native, and already
integrated into the site-generation pipeline.

## Decision

**Defer Deepcrawl.** Keep `import_crawler.ts` + image-discovery + CF Browser
Rendering as the crawl/discovery layer. Do NOT build a port now: like the Nango
case (ADR-0046), there is no single clean call-site contract to wrap — the crawler
is a domain-specific import function, not a generic "crawl provider" seam, and
Browser Rendering is already a registered CF-first service.

If recurring large-scale technical-SEO auditing becomes a product feature, add a
managed-Deepcrawl adapter behind a new `CrawlAuditProvider` port gated on
`DEEPCRAWL_API_KEY` at that time.

## Consequences

- **Positive:** zero new deps, CF-first (Browser Rendering is the edge crawl
  primitive), real-UA fetch crawl already battle-tested in the import pipeline.
  §53 is addressed with an honest "custom equivalent exists" rather than a
  duplicate or an unused vendor adapter.
- **Negative:** no managed recurring-SEO-audit dashboard. Accepted — not a current
  product need; our crawl is import-scoped, not audit-scoped.
- **Neutral:** registry entry `crawl-deepcrawl` records the deliberate deviation so
  the architecture-fitness scan doesn't flag §53 as missing.

## Alternatives considered

- **Build a `CrawlProvider` port over `import_crawler`** — rejected: it's a
  domain-specific import function, not a generic crawl seam; a port would be
  indirection with one caller.
- **Adopt managed Deepcrawl now** — deferred: heavyweight recurring-audit SaaS for
  a need we don't have; CF Browser Rendering + the import crawler already cover the
  edge-native crawl surface.
