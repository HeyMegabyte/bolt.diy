# figma_import

Import design tokens and component metadata from a Figma file into a generated site.

## Flag key

`figma_import` — default `enabled=0, rollout=0, stage='experimental'`

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/figma/import` | Bearer required | Import tokens + components from a Figma file |

### Request body

```json
{ "token": "figd_abcdefghij...", "fileKey": "XyZ1234AbCdEfGh" }
```

- `token` — Figma personal-access token (min 10 chars); read scope required
- `fileKey` — Figma file key from the file URL (min 3 chars)

### Response

```json
{ "ok": true, "tokens": { "--color-primary": "#00E5FF" }, "components": ["Button", "Card"] }
```

## Safe disabled behavior

Route returns `404` when the flag is off. The feature existence is never revealed.

## Removal

Delete `handlers.ts`, `service.ts`, `schemas.ts`, `feature.manifest.ts` and remove the
`app.route('/api/figma/import', figmaImport)` mount in `src/index.ts`.
