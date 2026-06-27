# syntax=docker/dockerfile:1
# =============================================================================
# projectsites-voice — multi-stage build, non-root runtime.
# Bundles Piper (binary + one voice model) so the TTS leg is a LOCAL spawn,
# transcoded to μ-law 8kHz via ffmpeg. No per-utterance network hop.
# =============================================================================

# --- deps stage: install production node_modules only ---
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# --- piper stage: download the Piper binary + one voice model ---
FROM node:22-slim AS piper
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_VOICE=en_US-amy-medium
WORKDIR /build
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
# Piper release binary (linux x86_64) → /app/piper/piper
RUN mkdir -p /app/piper /app/voices \
  && curl -fsSL -o piper.tar.gz \
    "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
  && tar -xzf piper.tar.gz -C /app \
  && rm piper.tar.gz \
  && test -x /app/piper/piper
# Voice model + its config from huggingface rhasspy/piper-voices.
RUN curl -fsSL -o "/app/voices/${PIPER_VOICE}.onnx" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/${PIPER_VOICE}.onnx?download=true" \
  && curl -fsSL -o "/app/voices/${PIPER_VOICE}.onnx.json" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/${PIPER_VOICE}.onnx.json?download=true" \
  && test -s "/app/voices/${PIPER_VOICE}.onnx"

# --- runtime stage: minimal, non-root ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# ffmpeg for the PCM → μ-law 8kHz transcode (clean apt lists in the same layer).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Copy node app + the bundled Piper binary + voice model.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=piper /app/piper ./piper
COPY --from=piper /app/voices ./voices
COPY package.json ./
COPY server.js ./

# Run as the built-in unprivileged `node` user.
USER node

EXPOSE 8080
CMD ["node", "server.js"]
