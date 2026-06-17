# prompt_studio

Flag key: `prompt_studio` | Stage: alpha | Owner: brian@megabyte.space

Admin interface for browsing, versioning, and A/B testing prompt templates in the registry.

## Routes

- `GET /api/prompt-studio/templates` — list all registered prompt templates
- `POST /api/prompt-studio/:key/variant` — update A/B variant weights for a prompt
- `POST /api/prompt-studio/:key/rollback` — roll back a prompt to its previous version

## Safe disabled behavior

All routes return 404 when flag is off.
