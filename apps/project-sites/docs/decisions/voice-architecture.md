# Voice Receptionist — Architecture & Build Plan (ADR, 2026-06-27)

**Status:** accepted — build autonomously (Brian greenlit 2026-06-27: "make it work as fast as possible; Piper on Fly for call-gpt + Whisper, or override with a faster service").
**Owner:** projectsites.dev finishing loop (cron `1878e26d`).

## Decision

Build a per-site AI phone receptionist: a caller dials a site's number → an AI persona answers, converses in real time, and logs the call (recording + transcript) into the admin **Conversations** surface. Ship in two stages so a REAL call works fast, then optimize cost.

### V1 — fastest-to-working (ship first; all secrets already in get-secret)

```
Caller → Twilio number → Twilio <Connect><Stream> (Media Streams WS, μ-law 8k)
       → Fly.io app `voice` (Node call-gpt bridge, region iad)
          → Deepgram streaming STT  (DEEPGRAM_API_KEY ✅)
          → OpenAI gpt-4o-mini streaming brain, per-site persona (OPENAI_API_KEY ✅)
          → ElevenLabs Flash v2.5 TTS (ELEVENLABS_API_KEY ✅, ~75ms first-byte)
       → audio streamed back to Twilio → caller
       → on hangup: recording + transcript → D1 → /admin Conversations
```

This is exactly the proven `twilio-labs/call-gpt` topology (Deepgram + GPT + ElevenLabs over Twilio Media Streams) — lowest call latency AND fastest to a working call, which is why it's V1.

### V2 — cost-optimized self-hosted (Brian's stated preference; behind a flag, A/B latency)

Swap the managed STT/TTS for self-hosted inference **on the same Fly machine**:
- STT: **faster-whisper** (CTranslate2, `base.en`/`small.en`) — replaces Deepgram.
- TTS: **Piper** (`en_US-*-medium`) — replaces ElevenLabs.
- Brain unchanged (gpt-4o-mini; option to route via Workers AI Llama-3.3-70b-fp8-fast or DeepSeek for cost later).

Removes per-minute Deepgram/ElevenLabs cost. Promote V2 only if measured turn-latency stays ≤ V1 + ~200ms. Toggle via env on the Fly app: `STT_PROVIDER=deepgram|whisper`, `TTS_PROVIDER=elevenlabs|piper`.

## Why not Twilio ConversationRelay (managed all-in-one)
Considered — it's the lowest-infra path, but it locks STT/TTS/LLM into Twilio's stack and bills per-minute on all three, defeating Brian's self-host-for-cost intent. Self-hosted-capable bridge on Fly keeps the V2 cost lever. Note it as the fallback if Fly ops prove heavy.

## Secrets (all present in get-secret — voice is autonomously deployable)
- ✅ `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (Media Streams; mint an API key/secret if needed)
- ✅ `FLY_API_TOKEN` · ✅ `OPENAI_API_KEY` · ✅ `DEEPGRAM_API_KEY` · ✅ `ELEVENLABS_API_KEY` · ✅ `CLOUDFLARE_API_KEY` (Workers-AI brain fallback)
- **Only genuine Brian-touch:** a Twilio phone number must be assigned + pointed at the worker's `/api/voice/incoming` TwiML webhook. The loop can provision one via the Twilio API with the present SID/auth (~$1/mo — Brian's "make it work" authorizes the spend); it surfaces the number for confirmation.

## Build slices (loop drives, TDD-first, flag `voice_receptionist` dark default)
1. Worker: `POST /api/voice/incoming` returns `<Connect><Stream url="wss://voice.projectsites.dev/ws">` TwiML; per-site persona lookup by called number. Unit tests on the TwiML + persona resolution (pure).
2. Fly app `voice/` — `Dockerfile` (DockerSlim) + `fly.toml` (iad, scale-to-zero idle, concurrency autoscale) + Node WS bridge (Twilio MediaStream framing ↔ Deepgram ↔ GPT ↔ ElevenLabs). `fly secrets import` from get-secret.
3. Recording + transcript persistence → D1 → `/admin` Conversations surface.
4. Provision/point the Twilio number; live call test (dial → persona answers → transcript lands). This is the V0g prod-call gate.
5. V2: add faster-whisper + Piper containers/binaries on the Fly image behind `STT_PROVIDER`/`TTS_PROVIDER`; benchmark; promote if within latency budget.

## Latency targets (real-time conversation)
- First persona audio after caller stops speaking: ≤ 1.2s (V1 managed), ≤ 1.5s (V2 self-host).
- Barge-in: caller speech interrupts TTS playback (Twilio `clear` + stop generation).

## Cross-refs
`_LOOP_LEDGER.md` V0–V49 · `rules/payments-routing` (no payments here) · `docker-slim-all-containers` · `[[deepseek-provider-tiers]]` (brain cost tier) · `[[secret-provisioning-recipe]]`.
