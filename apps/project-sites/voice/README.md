# projectsites-voice

A Node WebSocket bridge between **Twilio Media Streams** and a **STT → LLM → TTS**
voice pipeline — the proven [`twilio-labs/call-gpt`](https://github.com/twilio-labs/call-gpt)
topology. A caller dials a site's number, Twilio `<Connect><Stream>`s the μ-law 8kHz
audio here, and an AI persona answers in real time with sub-second turn latency.

It is provider-configurable so the same code runs the fast managed V1 stack and the
cost-optimized self-hosted V2 stack.

- **STT** — Deepgram streaming (default) → faster-whisper (V2)
- **LLM** — OpenAI `gpt-4o-mini` streaming, per-site persona system prompt
- **TTS** — ElevenLabs Flash v2.5 streaming, μ-law 8kHz (default) → Piper (V2)
- **Barge-in** — caller speech interrupts playback (`clear` + abort the in-flight turn)

Architecture: [`../docs/decisions/voice-architecture.md`](../docs/decisions/voice-architecture.md).

## How it fits

Twilio number → Worker `/api/voice/incoming` returns
`<Connect><Stream url="wss://voice.projectsites.dev/ws">` with `<Parameter>`s for
`siteId` + `persona` → this Fly app bridges audio both directions.

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `8080` | WebSocket listen port |
| `STT_PROVIDER` | no | `deepgram` | `deepgram` \| `whisper` (V2 stub) |
| `TTS_PROVIDER` | no | `elevenlabs` | `elevenlabs` \| `piper` (V2 stub) |
| `LLM_MODEL` | no | `gpt-4o-mini` | OpenAI chat model |
| `DEEPGRAM_API_KEY` | yes (deepgram) | — | Deepgram streaming STT |
| `OPENAI_API_KEY` | yes | — | gpt-4o-mini brain |
| `ELEVENLABS_API_KEY` | yes (elevenlabs) | — | ElevenLabs Flash v2.5 TTS |
| `ELEVENLABS_VOICE_ID` | no | Rachel | ElevenLabs voice |

## Deploy

Import secrets from `get-secret`, then deploy:

```bash
# One-time: import the live secrets into the Fly app
printf '%s\n' \
  "DEEPGRAM_API_KEY=$(get-secret DEEPGRAM_API_KEY)" \
  "OPENAI_API_KEY=$(get-secret OPENAI_API_KEY)" \
  "ELEVENLABS_API_KEY=$(get-secret ELEVENLABS_API_KEY)" \
  "ELEVENLABS_VOICE_ID=$(get-secret ELEVENLABS_VOICE_ID)" \
  | fly secrets import --app projectsites-voice

# Deploy
fly deploy --app projectsites-voice
```

The app scales to zero when idle (`min_machines_running = 0`) and auto-starts on the
first inbound WS connection. Concurrency caps at 25 hard / 20 soft connections.

## V2 — self-hosted swap (cost-optimized)

Per the ADR, V2 removes per-minute Deepgram + ElevenLabs cost by running inference on
the same Fly machine. Flip the providers via env (no code change to the bridge):

```bash
fly secrets set STT_PROVIDER=whisper TTS_PROVIDER=piper --app projectsites-voice
```

Then implement the two stubbed branches in `server.js`:

- **STT** — `faster-whisper` (CTranslate2, `base.en`/`small.en`): buffer μ-law frames
  per utterance, detect end-of-speech via VAD, decode μ-law→PCM16, transcribe locally.
- **TTS** — `Piper` (`en_US-*-medium`): synthesize, resample to 8kHz μ-law, base64-frame
  back to Twilio exactly like the ElevenLabs path.

Promote V2 only if measured turn latency stays within ~200ms of V1.
