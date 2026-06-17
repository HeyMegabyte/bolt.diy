# ai_gateway_guardrails

Flag key: `ai_gateway_guardrails` | Stage: alpha | Owner: brian@megabyte.space

Classifies text via Llama Guard 3-8B, blocking requests that score unsafe at or above 0.85.

## Routes

- `POST /api/guardrails/check` — classify text for safety (body: `{text, threshold?}`)

## Helper export

`guardText(env, text, threshold?)` — convenience inline guard for other modules.

## Safe disabled behavior

Route returns 404 when flag is off. `guardText()` can be called without the flag being on.

## Dependencies

- `AI` Workers AI binding
- Llama Guard model: `@cf/meta/llama-guard-3-8b`
