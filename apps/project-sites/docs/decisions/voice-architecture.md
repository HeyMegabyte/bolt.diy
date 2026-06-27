# Voice Receptionist — Architecture & Build Plan (ADR, 2026-06-27)

**Status:** accepted — build autonomously (Brian 2026-06-27: "make it work as fast as possible"; STT = **Deepgram Nova-3 or better**, TTS = **Piper**).
**Owner:** projectsites.dev finishing loop (cron `1878e26d`).

## Decision

Per-site AI phone receptionist: caller dials a site's number → an AI persona answers, converses in real time, and the call (recording + transcript) lands in the admin **Conversations** surface. ONE stack (no V1/V2 split), with env-switchable fallbacks.

```
Caller → Twilio number → Twilio <Connect><Stream> (Media Streams WS, μ-law 8k)
       → Fly.io app `projectsites-voice` (Node call-gpt bridge, region iad)
          → Deepgram FLUX streaming STT + integrated end-of-turn (model 'flux-general-en';
            no separate VAD/endpointing → 200-600ms faster; Nova-3 fallback) (DEEPGRAM_API_KEY ✅)
          → OpenAI gpt-4o-mini streaming brain, per-site persona (OPENAI_API_KEY ✅)
          → Piper TTS, bundled ON the Fly machine (rhasspy/piper ONNX voice)
            → Piper raw PCM (22050) → resample → μ-law 8000 → base64 → Twilio frames
       → audio streamed back to Twilio → caller
       → on hangup: recording + transcript → D1 → /admin Conversations
```

### Provider matrix (env-switchable on the Fly app)
- **STT** — `STT_PROVIDER=deepgram` (default, **Flux** `flux-general-en` — conversational STT with model-integrated end-of-turn detection; ~200-600ms faster than Nova-3+VAD, EOT <300ms). The bridge drives off Flux's `EndOfTurn` event (not fixed-silence endpointing). **`EAGER_EOT=1`** opts into EagerEndOfTurn speculative-LLM (start on `EagerEndOfTurn`, cancel on `TurnResumed`, finalize on `EndOfTurn`) for another ~100-200ms at +50-70% LLM calls — default OFF. Fallbacks: `STT_MODEL=nova-3` (model swap) or `STT_PROVIDER=whisper` (self-host cost lever).
- **TTS** — `TTS_PROVIDER=piper` (default, self-hosted on the Fly machine — MIT, free, low-latency, no per-char vendor fee). Fallback `openai` (hosted OpenAI TTS) when Piper is unavailable. **ElevenLabs is REMOVED** (paid/proprietary — Brian directive 2026-06-27, per `package-preference-registry`).
- **Brain** — gpt-4o-mini (streaming). Option to route via Workers AI Llama-3.3-70b-fp8-fast or DeepSeek for cost (`[[deepseek-provider-tiers]]`).

### Piper deployment
Bundled INTO the Fly voice image (binary + one `en_US-*-medium.onnx` voice) so the TTS leg is a LOCAL spawn — no network hop per utterance = lowest real-time latency (honors Brian's "Piper on the fly.io machine"). A separate shared `tts.projectsites.dev` CF Workers Container (per `package-preference-registry`) serves NON-realtime TTS (podcast-per-page, page-audio) — out of scope for this call path.

## Why not Twilio ConversationRelay / ElevenLabs
ConversationRelay locks STT/TTS/LLM into Twilio's per-minute stack — defeats the self-host-for-cost intent. ElevenLabs is paid/proprietary (removed per directive). Deepgram Nova-3 (managed, best accuracy) + Piper (self-host, free) is the cost/quality sweet spot.

## Secrets (all present in get-secret — voice is autonomously deployable)
- ✅ `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` · ✅ `FLY_API_TOKEN` · ✅ `OPENAI_API_KEY` · ✅ `DEEPGRAM_API_KEY` · ✅ `CLOUDFLARE_API_KEY` (Workers-AI brain/STT fallback)
- Piper needs NO secret (bundled binary + model). `ELEVENLABS_API_KEY` no longer used.
- **Only Brian-touch:** confirm the auto-provisioned Twilio number pointed at the worker's `/api/voice/incoming` TwiML webhook (~$1/mo — "make it work" authorizes; loop provisions via Twilio API).

## Build slices (loop drives, TDD-first, flag `voice_receptionist` dark default)
1. Worker: `POST /api/voice/incoming` → `<Connect><Stream url="wss://…/ws">` TwiML; per-site persona by called number. (Pure core `src/services/voice_twiml.ts` DONE, 15 tests.)
2. Fly app `voice/` — Node WS bridge (Twilio MediaStream ↔ Deepgram Nova-3 ↔ gpt-4o-mini ↔ **Piper local**); `Dockerfile` bundles Piper + a voice model + a PCM→μ-law8k resampler (ffmpeg or `sox`/in-process). `fly secrets import` from get-secret.
3. Recording + transcript → D1 → `/admin` Conversations.
4. Provision/point the Twilio number; live call test (dial → persona answers → transcript lands). (V0g gate.)
5. Optional cost lever: `STT_PROVIDER=whisper` self-host to drop Deepgram per-minute; benchmark vs Nova-3, promote only if latency holds.

## Latency targets
- First persona audio after caller stops: ≤ 1.2s. Barge-in: caller speech interrupts TTS (Twilio `clear` + abort generation).

## Cross-refs
`_LOOP_LEDGER.md` V0–V49 · `package-preference-registry` (Piper TTS / Deepgram STT) · `docker-slim-all-containers` · `[[deepseek-provider-tiers]]` · `[[secret-provisioning-recipe]]`.
