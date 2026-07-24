# ProjectSites voice receptionist — LiveKit Cloud agent image.
# LiveKit Cloud agent hosting builds + runs THIS Dockerfile (always-on, autoscaled).
# Runs the @livekit/agents worker via tsx (no separate TS build step).
FROM node:22-slim

WORKDIR /app

# ── Piper TTS (slice-2 swap) ───────────────────────────────────────────────
# First-light uses OpenAI TTS (our key). To switch to free self-hosted Piper, add
# the custom TTS plugin in src/ and uncomment the binary + voice-model bundling:
#   RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
#       && rm -rf /var/lib/apt/lists/*
#   ARG PIPER_VER=2023.11.14-2
#   RUN curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_linux_x86_64.tar.gz" \
#       | tar -xz -C /opt && \
#       curl -fsSL -o /opt/piper/en_US-amy-medium.onnx <voice-url> && \
#       curl -fsSL -o /opt/piper/en_US-amy-medium.onnx.json <voice-json-url>
#   ENV PIPER_BIN=/opt/piper/piper PIPER_VOICE=/opt/piper/en_US-amy-medium.onnx

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

# Silero VAD weights are fetched at build so the agent cold-starts fast.
RUN node --import tsx src/agent.ts download-files || true

# LiveKit Cloud invokes the worker in "start" mode.
CMD ["node", "--import", "tsx", "src/agent.ts", "start"]
