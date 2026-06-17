# ai_concierge_widget

Flag key: `ai_concierge_widget` | Stage: alpha | Owner: brian@megabyte.space

Per-site AI chat widget that grounds responses via RAG semantic search and Workers AI LLM.

## Routes

- `POST /api/concierge/:siteId/message` — send a visitor message, get a grounded AI reply
- `GET /api/concierge/:siteId/config` — fetch widget configuration for the site

## Safe disabled behavior

When flag is off, all routes return 404. No data is stored.

## Dependencies

- `site_semantic_search` (RAG index must be populated)
- Workers AI binding (`AI`)
- Vectorize binding (`RAG_INDEX`)
