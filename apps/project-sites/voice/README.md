# projectsites-voice

A Node WebSocket bridge between **Twilio Media Streams** and a **STT → LLM → TTS**
voice pipeline. A caller dials a site's number, Twilio `<Connect><Stream>`s the
μ-law 8kHz audio here, and an AI persona answers in real time with sub-second turn
latency.

TTS runs **locally on the Fly machine** (Piper, bundled into the image) — no
per-utterance vendor hop, no per-char fee. The provider is env-switchable.

- **STT** — Deepgram **Flux** (`flux-general-en`, conversational STT with integrated end-of-turn; default) → faster-whisper (V2 stub)
- **LLM** — OpenAI `gpt-4o-mini` streaming, per-site persona system prompt
- **TTS** — **Piper** (bundled, local child process; default) → OpenAI `/v1/audio/speech` fallback
- **Turn-taking** — driven by Flux `TurnInfo` events, NOT fixed-silence endpointing. `EndOfTurn` commits a turn → LLM → TTS; `Update`/`StartOfTurn` drive barge-in
- **EagerEndOfTurn** (opt-in via `EAGER_EOT=1`) — start the LLM+TTS speculatively on the eager signal; `TurnResumed` aborts the in-flight response; `EndOfTurn` commits it
- **Barge-in** — caller speech kills the in-flight Piper+ffmpeg render, aborts the LLM stream, and `clear`s Twilio's buffer

### Flux STT (Deepgram v2 streaming)

Raw WebSocket to `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000&eot_threshold=0.7` (Flux **requires** the `/v2/listen` endpoint; `/v1` does not work), `Authorization: Token $DEEPGRAM_API_KEY`. Every message is `{ type: "TurnInfo", event, transcript, ... }`; we switch on `event` ∈ `StartOfTurn` / `Update` / `EagerEndOfTurn` / `TurnResumed` / `EndOfTurn`. `eot_threshold` (and `eager_eot_threshold` when `EAGER_EOT=1`) are connect-time query params and are also mid-stream tunable via the Configure control message. Docs: [Flux quickstart](https://developers.deepgram.com/docs/flux/quickstart) · [agent](https://developers.deepgram.com/docs/flux/agent) · [eager EOT](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot).

### TTS audio flow (Piper)

For each LLM sentence: `piper --model $PIPER_MODEL --output_raw` is spawned, the text
written to its stdin. Piper emits raw **s16le PCM mono @22050**, piped through
`ffmpeg -f s16le -ar 22050 -ac 1 -i pipe:0 -ar 8000 -ac 1 -f mulaw pipe:1` to produce
**μ-law 8000**, chunked into **160-byte (20ms)** frames, base64-encoded, and streamed
to Twilio as `{event:'media', streamSid, media:{payload}}` frames as they arrive.

Architecture: [`../docs/decisions/voice-architecture.md`](../docs/decisions/voice-architecture.md).

## How it fits

Twilio number → Worker `/api/voice/incoming` returns
`<Connect><Stream url="wss://voice.projectsites.dev/ws">` with `<Parameter>`s for
`siteId` + `persona` → this Fly app bridges audio both directions.

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `8080` | WebSocket listen port |
| `STT_PROVIDER` | no | `deepgram` | `deepgram` (Flux) \| `whisper` (V2 stub) |
| `STT_MODEL` | no | `flux-general-en` | Deepgram Flux model (v2 streaming) |
| `EOT_THRESHOLD` | no | `0.7` | Flux confidence (0.5–0.9) to fire `EndOfTurn` |
| `EAGER_EOT` | no | `` (off) | `1` enables the speculative `EagerEndOfTurn` path |
| `EAGER_EOT_THRESHOLD` | no | `0.3` | Flux confidence (0.3–0.9) to fire `EagerEndOfTurn` (only sent when `EAGER_EOT=1`) |
| `TTS_PROVIDER` | no | `piper` | `piper` (local, bundled) \| `openai` (fallback) |
| `LLM_MODEL` | no | `gpt-4o-mini` | OpenAI chat model |
| `DEEPGRAM_API_KEY` | yes (deepgram) | — | Deepgram Flux streaming STT |
| `OPENAI_API_KEY` | yes | — | gpt-4o-mini brain (+ `openai` TTS fallback) |
| `PIPER_BIN` | no | `/app/piper/piper` | Path to the bundled Piper binary (no key) |
| `PIPER_MODEL` | no | `/app/voices/en_US-amy-medium.onnx` | Bundled Piper voice model |
| `OPENAI_TTS_MODEL` | no | `gpt-4o-mini-tts` | OpenAI TTS model (only when `TTS_PROVIDER=openai`) |
| `OPENAI_TTS_VOICE` | no | `alloy` | OpenAI TTS voice (only when `TTS_PROVIDER=openai`) |

## Deploy

Import secrets from `get-secret`, then deploy:

```bash
# One-time: import the live secrets into the Fly app.
# Piper needs NO secret (binary + voice model are bundled into the image).
printf '%s\n' \
  "DEEPGRAM_API_KEY=$(get-secret DEEPGRAM_API_KEY)" \
  "OPENAI_API_KEY=$(get-secret OPENAI_API_KEY)" \
  | fly secrets import --app projectsites-voice

# Deploy
fly deploy --app projectsites-voice
```

The app scales to zero when idle (`min_machines_running = 0`) and auto-starts on the
first inbound WS connection. Concurrency caps at 25 hard / 20 soft connections.

## Provider switches

TTS already runs self-hosted (Piper). The remaining cost lever is STT:

```bash
# Fall back to hosted OpenAI TTS if Piper is unavailable on the machine:
fly secrets set TTS_PROVIDER=openai --app projectsites-voice

# Enable the speculative EagerEndOfTurn path (lower perceived latency, more aborts):
fly secrets set EAGER_EOT=1 --app projectsites-voice

# (Future) drop per-minute Deepgram cost by self-hosting STT:
fly secrets set STT_PROVIDER=whisper --app projectsites-voice
```

The `whisper` STT branch is stubbed in `server.js` (`TODO(V2)`): buffer μ-law frames
per utterance, detect end-of-speech via VAD, decode μ-law→PCM16, transcribe locally
with `faster-whisper` (CTranslate2, `base.en`/`small.en`). Promote only if measured
turn latency stays within ~200ms of Deepgram Nova-3.
