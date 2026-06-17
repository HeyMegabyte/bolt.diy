# generative_ui_stream

Flag key: `generative_ui_stream` | Stage: alpha | Owner: brian@megabyte.space

Returns schema-bound UI descriptors from Workers AI LLM for dynamic copilot-driven UI composition.

## Routes

- `POST /api/copilot/ui` — generate UI descriptors from a natural language prompt

## Safe disabled behavior

Route returns 404 when flag is off. No persistent state.
