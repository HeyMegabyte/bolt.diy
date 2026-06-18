# Claude Code on DeepSeek (projectsites.dev provider doctrine)

DeepSeek is the **default volume model and default Claude Code backend** for this repo: cheap, high-concurrency, and Anthropic-API-compatible. **V4 Pro** drives primary code/agent work; **V4 Flash** drives subagents + classification + high-parallel cheap work. Premium tiers (Anthropic / OpenAI / Gemini / Grok) stay reserved for architecture, polished reasoning, grounding, and live-world checks — routed via the AI Router + LiteLLM gateway, not your local Claude Code shell.

## One-command setup (no secrets in git)

```sh
# 1. Put your key in your shell (or a secret manager) — never in the repo:
export DEEPSEEK_API_KEY=sk-...            # https://platform.deepseek.com/api_keys

# 2. Generate the sourceable env snippet:
bash apps/project-sites/scripts/setup-claude-deepseek.sh

# 3. Add the printed `source ...` line to ~/.zshrc or ~/.bashrc, open a new shell.

# 4. Prove it (no live call):
node apps/project-sites/scripts/verify-claude-deepseek.mjs
```

The setup script writes `~/.config/projectsites/claude-deepseek.env.sh` containing **only `$DEEPSEEK_API_KEY` references** — the secret is resolved from your environment at source-time and is never written to disk or committed. `verify-claude-deepseek.mjs` confirms the wiring and asserts no literal key leaked, emitting `verification-claude-deepseek.json` as evidence.

## What it exports

```sh
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY
export ANTHROPIC_API_KEY=$DEEPSEEK_API_KEY
export ANTHROPIC_MODEL=deepseek-v4-pro[1m]
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
```

Model aliases are configurable via `DEEPSEEK_PRO_MODEL` / `DEEPSEEK_FLASH_MODEL` before running setup.

## Switching back to Anthropic

```sh
unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL \
      ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL \
      ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_SUBAGENT_MODEL
```

Then restart Claude Code. (Or just comment out the `source` line and open a new shell.)

## Notes

- **Reliability**: DeepSeek is cheap + high-concurrency but not infinite — the worker-side AI Router still enforces concurrency caps, queueing, retries, backoff, and fallback to OpenAI/Anthropic. This doc only covers the *local Claude Code shell*; production provider calls route through the AI Router + LiteLLM gateway + CF AI Gateway.
- **The container build agent already uses DeepSeek** (`scripts/container-server.mjs` injects `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL` when `DEEPSEEK_API_KEY` is set and `BUILD_LLM_PROVIDER != anthropic`). This setup mirrors that for your local shell.
- **Never** paste `DEEPSEEK_API_KEY=sk-...` into `.env.example`, a committed file, or the generated snippet — the verify script fails the build if it finds one.
