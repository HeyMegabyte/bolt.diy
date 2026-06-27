# projectsites-voice-agent

AI phone receptionist for ProjectSites — a Node [`@livekit/agents`](https://docs.livekit.io/agents) worker deployed to **LiveKit Cloud agent hosting**. See the decision record: [`docs/decisions/voice-architecture.md`](../../docs/decisions/voice-architecture.md) (LiveKit amendment + runtime pivot).

## Pipeline

| Stage | Choice | Notes |
|---|---|---|
| Transport | Twilio number → Twilio Elastic SIP trunk → LiveKit Cloud SIP → room | agent joins as a participant |
| STT | Deepgram **Flux** (`STTv2`, `flux-general-en`) | model-integrated end-of-turn; our `DEEPGRAM_API_KEY` |
| LLM | OpenAI `gpt-4o-mini` (streaming) | our `OPENAI_API_KEY`, per-site persona |
| TTS | OpenAI `gpt-4o-mini-tts` (**first-light**) → **Piper** | swap to bundled Piper custom plugin (free, self-hosted) |
| Turn-taking | silero VAD + LiveKit multilingual turn detection + barge-in | built-in |

Uses our own vendor keys (not LiveKit inference billing) for cost control.

## Local dev

```bash
npm install
cp .env.example .env   # fill from get-secret
npm run typecheck
npm run dev            # connects to LiveKit Cloud, registers, waits for dispatch
```

## Deploy (LiveKit Cloud agent hosting)

```bash
# one-time: install the LiveKit CLI + authenticate the project
brew install livekit-cli            # or: curl -sSL https://get.livekit.io/cli | bash
lk cloud auth                        # browser auth, or set LIVEKIT_API_KEY/SECRET/URL

# first deploy generates/uses livekit.toml + Dockerfile, uploads secrets, builds the image
lk agent create        # first time only (writes the agent id back into livekit.toml)
lk agent deploy        # subsequent deploys

# set the agent's runtime secrets in LiveKit Cloud (or via the dashboard):
#   LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET DEEPGRAM_API_KEY OPENAI_API_KEY
```

## Wire the phone path (slice 3)

1. Twilio: create an **Elastic SIP Trunk**, origination URI → `sip:5i7qjsfbhz7.sip.livekit.cloud`; point the receptionist number at the trunk.
2. LiveKit: create an **inbound SIP trunk** + a **dispatch rule** that dispatches `agentName = projectsites-receptionist` for inbound SIP calls (`AgentDispatchService` / `lk sip` ). Per-site routing keys off the dialed DID.

## Next (TODO)

- **Piper TTS plugin** — implement `src/piper-tts.ts` (spawn Piper, stream PCM → frames), bundle the binary + an `en_US-*-medium.onnx` voice in the Dockerfile (uncomment the block), set `tts` to it.
- **Per-site persona** — `resolvePersona()` currently returns a default; look the dialed DID up against the platform (number → site → persona).
- **Recording + transcript** — LiveKit egress → R2; transcript → D1 `conversations` via the live `/webhooks/livekit` receiver (`room_finished` / egress-ended).
