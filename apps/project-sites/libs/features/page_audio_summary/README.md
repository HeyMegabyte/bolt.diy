# page_audio_summary

Flag key: `page_audio_summary` | Stage: alpha | Owner: brian@megabyte.space

Generates per-route TTS audio summaries stored in R2 for visitor playback.

## Routes

- `POST /api/audio-summary/:siteId` — generate audio for a route (body: `{route, text, voice?}`)
- `GET /api/audio-summary/:siteId?route=/path` — fetch audio URL for a route

## Safe disabled behavior

All routes return 404. No audio is generated or stored.

## Dependencies

- `SITES_BUCKET` R2 binding
- `AI` binding (optional — falls back to empty placeholder)
