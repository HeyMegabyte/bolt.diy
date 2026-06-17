# site_semantic_search

Flag key: `site_semantic_search` | Stage: alpha | Owner: brian@megabyte.space

Semantic vector search over site content via Vectorize + BGE embeddings.

## Routes

- `POST /api/site-search/:siteId/query` — semantic search over site content
- `POST /api/site-search/:siteId/reindex` — replace all indexed chunks for a site

## Safe disabled behavior

All routes return 404. No vectors are indexed or deleted.
