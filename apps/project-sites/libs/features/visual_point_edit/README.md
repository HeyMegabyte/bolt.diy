# visual_point_edit

AI-powered in-place node patching for published sites.

## Flag key

`visual_point_edit` — default `enabled=0, rollout=0, stage='experimental'`

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/editor/point-edit` | Bearer required | Patch a DOM node via plain-language instruction |

### Request body

```json
{ "nodeId": "#hero-h1", "instruction": "Make the text uppercase", "siteId": "site-abc-001" }
```

### Response

```json
{ "ok": true, "patched": true, "node": "#hero-h1" }
```

## Safe disabled behavior

Route returns `404` when the flag is off. The feature's existence is never revealed.

## Removal

Delete `handlers.ts`, `service.ts`, `schemas.ts`, `feature.manifest.ts` and remove the
`app.route('/api/editor/point-edit', visualPointEdit)` mount in `src/index.ts`.
