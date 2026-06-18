#!/usr/bin/env bash
# setup-claude-deepseek.sh — point Claude Code at DeepSeek (V4 Pro primary, V4 Flash
# subagents) via its Anthropic-compatible endpoint, per the projectsites.dev provider
# doctrine (DeepSeek = default volume + Claude Code backend).
#
# SAFETY: this writes a *sourceable env snippet* that references $DEEPSEEK_API_KEY from
# your shell at source-time. NO secret value is ever written to disk or git. Verify with
# scripts/verify-claude-deepseek.mjs.
set -euo pipefail

TARGET_DIR="${PROJECTSITES_CONFIG_DIR:-$HOME/.config/projectsites}"
SNIPPET="$TARGET_DIR/claude-deepseek.env.sh"
PRO_MODEL="${DEEPSEEK_PRO_MODEL:-deepseek-v4-pro[1m]}"
FLASH_MODEL="${DEEPSEEK_FLASH_MODEL:-deepseek-v4-flash}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$TARGET_DIR"

# Quoted heredoc → $DEEPSEEK_API_KEY stays literal (resolved when YOU source the file).
cat > "$SNIPPET" <<'SNIP'
# projectsites.dev — Claude Code → DeepSeek backend. Source this from your shell rc.
# Requires DEEPSEEK_API_KEY exported in your environment first (never stored in this file).
if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "claude-deepseek: DEEPSEEK_API_KEY is not set — export it (https://platform.deepseek.com/api_keys)" >&2
fi
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
export ANTHROPIC_API_KEY="$DEEPSEEK_API_KEY"
export ANTHROPIC_MODEL="__PRO__"
export ANTHROPIC_DEFAULT_OPUS_MODEL="__PRO__"
export ANTHROPIC_DEFAULT_SONNET_MODEL="__PRO__"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="__FLASH__"
export CLAUDE_CODE_SUBAGENT_MODEL="__FLASH__"
export CLAUDE_CODE_EFFORT_LEVEL="max"
SNIP

# Substitute the model aliases (kept out of the heredoc so they stay configurable).
sed -i.bak "s|__PRO__|${PRO_MODEL}|g; s|__FLASH__|${FLASH_MODEL}|g" "$SNIPPET"
rm -f "$SNIPPET.bak"

printf '✓ Wrote %s\n\n' "$SNIPPET"
printf 'Next:\n'
printf '  1. Export your key (in your rc or a secret manager, BEFORE the source line):\n'
printf '       export DEEPSEEK_API_KEY=sk-...\n'
printf '  2. Add to ~/.zshrc or ~/.bashrc:\n'
printf '       source %s\n' "$SNIPPET"
printf '  3. Open a new shell, then run Claude Code — it now talks to DeepSeek.\n'
printf '  4. Verify (no live call needed):\n'
printf '       node %s/verify-claude-deepseek.mjs\n\n' "$SCRIPT_DIR"
printf 'Switch BACK to Anthropic any time:\n'
printf '  unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL ANTHROPIC_DEFAULT_OPUS_MODEL \\\n'
printf '        ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL CLAUDE_CODE_SUBAGENT_MODEL\n'
