# Voice Receptionist — Architecture & Build Plan (ADR, 2026-06-27)

**Status:** ⚠️ SUPERSEDED for the transport/runtime by the **Amendment (2026-06-27 — LiveKit)** block directly below. The persona/STT/LLM/TTS *choices* (Deepgram Flux, gpt-4o-mini, Piper) carry forward; the Twilio-MediaStreams-→-Fly-bridge transport is replaced by LiveKit Cloud (SIP + agent hosting). Read the amendment first (incl. the runtime pivot to LiveKit Cloud agent hosting); the original plan below is retained for history.
**Owner:** projectsites.dev finishing loop (cron `1878e26d`).

---

## Amendment (2026-06-27, later) — LiveKit Cloud + LiveKit Cloud agent hosting

> **⚙️ Runtime pivot (2026-06-27, same day):** the original amendment chose a **CF Workers Container** for the agent. LiveKit's docs confirm an agent is *"an agent server process that registers with the LiveKit server and waits for dispatch requests"* — a **persistent, always-registered** process. CF Workers Containers **hibernate when idle** and are request-driven (the opposite); at call time LiveKit dispatches the instant the room is created, so a hibernated container = no registered worker = no agent answers. Wake-on-call only works with extra orchestration + multi-second caller hold + a dispatch race. **Brian (AskUserQuestion 2026-06-27) chose LiveKit Cloud agent hosting** (`lk agent create` → runs OUR Dockerfile, always-on, autoscaled, co-located with the media servers). Everything else is unchanged — Twilio→SIP→LiveKit, Deepgram Flux + gpt-4o-mini + **Piper bundled in the Dockerfile**, the live `/webhooks/livekit` receiver, conversations wiring. The CF-container feasibility risk + slice-0 spike below are **VOID** (pivoted, not validated). Fly remains off the table.

**Decision (Brian, 2026-06-27):** replace the previous hand-rolled Twilio Media Streams bridge on Fly with **LiveKit Agents**. That demo-grade bridge's naive turn-taking / barge-in / reconnection / μ-law glue is exactly what a production receptionist must get right, and LiveKit gives it out of the box (silero VAD + multilingual turn detection + interruption + noise cancellation), with a first-class Deepgram `flux-general` plugin — the STT this ADR already chose. LiveKit is Apache-2.0, so this is MORE self-host-aligned, not less.

### New topology
```
Caller → Twilio number → Twilio Elastic SIP Trunk → LiveKit Cloud SIP ingress → room
       → LiveKit Agent (Node @livekit/agents) on LIVEKIT CLOUD AGENT HOSTING (runs our Dockerfile; NOT Fly, NOT CF Container)
          → Deepgram flux-general STT  (LiveKit inference plugin; DEEPGRAM_API_KEY)
          → gpt-4o-mini streaming brain, per-site persona  (OPENAI_API_KEY)
          → Piper TTS — CUSTOM @livekit/agents TTS plugin, Piper binary + ONNX voice
            BUNDLED into the container image (local spawn, no per-utterance network hop)
       → on room end: LiveKit egress recording + agent transcript
          → POST /webhooks/livekit (signed, verified via WebhookReceiver) → D1 → /admin Conversations
```

### Chosen options (Brian, AskUserQuestion 2026-06-27)
- **LiveKit hosting:** LiveKit **Cloud** (project `p_5i7qjsfbhz7`, `wss://projectsites-dev-1ydfdbtm.livekit.cloud`, SIP `sip:5i7qjsfbhz7.sip.livekit.cloud`). Creds in `get-secret`: `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_SIP_URI` / `LIVEKIT_PROJECT_ID`.
- **Agent runtime:** ~~CF Workers Container~~ → **LiveKit Cloud agent hosting** (pivot above). `lk agent create` generates `Dockerfile` + `livekit.toml`; LiveKit Cloud runs our image always-on + autoscaled. Agent project lives at `infra/voice-agent/`. NOT Fly, NOT CF Container.
- **Agent SDK:** **Node / TypeScript** (`@livekit/agents` + `agent-starter-node`), keeps the one-language stack.
- **TTS:** **Piper custom plugin now** (self-hosted, free, bundled in the image); hosted TTS only as a `TTS_PROVIDER` fallback.
- **Availability:** **Wake-on-incoming-call** — container hibernates when idle; the inbound LiveKit SIP/room webhook wakes it, it registers + accepts dispatch. Accept the cold-start (several seconds) on the first call after idle. (Trade vs always-warm cost; revisit if ring-latency hurts.)
- **Concurrency:** start small (1-3 concurrent), LiveKit Cloud free tier; scale via `max_instances` + tier later (two-way door).
- **Old Twilio-Media-Streams Fly app:** **tear down** — Fly leaves the voice path entirely; the `voice/` Fly bridge + `projectsites-voice` app are decommissioned.

### ✅ Feasibility risk — RESOLVED by the runtime pivot
The CF-Container hibernation/registration mismatch (below) is moot: the agent now runs on **LiveKit Cloud agent hosting** (always-on, co-located), so there is no hibernation race and no UDP/TURN concern from a CF container. Slice 0 (CF-container spike) is **dropped**.

~~Running a LiveKit agent inside a CF Workers Container is non-standard: the agent holds a persistent worker-registration WS + WebRTC media; CF Containers hibernate; wake-on-call must re-register before dispatch; UDP may be restricted (TURN-over-TCP/443 fallback). Spike dropped — pivoted to LiveKit Cloud hosting.~~

### Webhook
- LiveKit webhook URL (register in LiveKit Cloud project settings): **`https://projectsites.dev/webhooks/livekit`** — lifecycle/egress events only (NOT call audio). Verify the `Authorization` JWT with `WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)`; idempotent on `event.id`; `room_finished`/egress-ended → persist recording (R2) + transcript → D1 Conversations.

### Build slices (this arc, TDD-first, flag `voice_receptionist` dark)
0. ~~CF-Container spike~~ — **DROPPED** (pivoted to LiveKit Cloud agent hosting).
1. ✅ **`/webhooks/livekit` receiver** — signed (HS256 verify + body-sha256), Zod-validated, idempotent on `event.id`, dark-by-default; `webhook_events` CHECK widened (migration `0579`). **SHIPPED + prod-verified** (`6578310a`, `168e9559`).
2. **LiveKit Cloud agent** — `infra/voice-agent/` (Node `@livekit/agents` + `livekit.toml` + Dockerfile bundling Piper + ONNX voice + the **Piper custom TTS plugin**); Deepgram flux + gpt-4o-mini; per-site persona by dialed number. First-light may use a hosted TTS, then swap Piper. Deploy via `lk agent create`/`deploy`.
3. **Twilio Elastic SIP Trunk → LiveKit SIP inbound trunk + dispatch rule** (API-configured with the stored creds; keep the existing Twilio number).
4. **Recording (LiveKit egress → R2) + transcript → D1 → /admin Conversations.**
5. **Tear down** `voice/` Fly bridge + `projectsites-voice` Fly app; drop the Twilio `<Connect><Stream>` TwiML path.
6. **Live call test** (V0g): dial the number → persona answers → transcript lands.

---

## Decision

Per-site AI phone receptionist: caller dials a site's number → an AI persona answers, converses in real time, and the call (recording + transcript) lands in the admin **Conversations** surface. ONE stack (no V1/V2 split), with env-switchable fallbacks.

```
Caller → Twilio number → Twilio <Connect><Stream> (Media Streams WS, μ-law 8k)
       → Fly.io app `projectsites-voice` (Node Media-Streams bridge, region iad)
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
