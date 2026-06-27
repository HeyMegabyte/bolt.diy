"""
ProjectSites arbitration layer for the LiteLLM gateway (llm.megabyte.space).

Registers two first-class models, orchestrated INSIDE the CF container, with every
cheap leg (draft / confidence-check / judge / vote) running on CLOUDFLARE WORKERS AI
(the `ollama` tier — free, edge) so most traffic resolves on Cloudflare and only
genuinely-hard prompts escalate to premium:

  ps-arbiter/cascade  — Speculative Cascade (#15): draft on Workers AI → a Workers-AI
      confidence check → return the ~free draft when confident, else escalate to DeepSeek
      (or Opus when metadata.stakes == "high"). Big premium-spend cut.
  ps-arbiter/quorum   — Quorum Arbitration (#11): fan out to opus+gpt+deepseek in parallel,
      a Workers-AI judge picks the best answer. For metadata.stakes == "high".

EVERY path is FAIL-OPEN: any orchestration error falls back to a single DeepSeek call,
so these models never hard-fail a request.

Registered via `litellm.custom_provider_map`; this module is imported by
projectsites_hooks.py so the proxy loads it. Config exposes `cascade` + `quorum`.
"""

from __future__ import annotations

import os
import asyncio
from typing import Any, Optional

import litellm
from litellm import CustomLLM

_ACCT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
_OLLAMA = "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast"
_OLLAMA_BASE = f"https://api.cloudflare.com/client/v4/accounts/{_ACCT}/ai/run/"
_CF_KEY = os.environ.get("CLOUDFLARE_API_KEY")

# Underlying tiers (full provider strings + their key env names).
_TIERS = {
    "opus": ("anthropic/claude-opus-4-8", "ANTHROPIC_API_KEY", None),
    "gpt": ("openai/gpt-5", "OPENAI_API_KEY", None),
    "deepseek": ("deepseek/deepseek-chat", "DEEPSEEK_API_KEY", None),
    "ollama": (_OLLAMA, "CLOUDFLARE_API_KEY", _OLLAMA_BASE),
}


async def _call(tier: str, messages: list, **kw) -> litellm.ModelResponse:
    model, key_env, base = _TIERS[tier]
    params: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "api_key": os.environ.get(key_env),
        "temperature": kw.get("temperature", 0.2),
        "max_tokens": kw.get("max_tokens", 1024),
        "timeout": kw.get("timeout", 60),
    }
    if base:
        params["api_base"] = base
    return await litellm.acompletion(**params)


def _text(resp: litellm.ModelResponse) -> str:
    try:
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        return ""


async def _cf_judge(prompt: str, *, max_tokens: int = 8) -> str:
    """One Workers-AI (CF-native) call used for confidence / voting. Empty on error."""
    if not _ACCT:
        return ""
    try:
        r = await litellm.acompletion(
            model=_OLLAMA, messages=[{"role": "user", "content": prompt}],
            api_key=_CF_KEY, api_base=_OLLAMA_BASE, temperature=0,
            max_tokens=max_tokens, timeout=10,
        )
        return _text(r)
    except Exception:
        return ""


def _stakes_high(kwargs: dict) -> bool:
    meta = (kwargs.get("litellm_params") or {}).get("metadata") or kwargs.get("metadata") or {}
    return str(meta.get("stakes", "")).lower() == "high"


class ProjectSitesArbiter(CustomLLM):
    async def acompletion(self, *args, **kwargs) -> litellm.ModelResponse:  # type: ignore[override]
        model = kwargs.get("model") or (args[0] if args else "cascade")
        messages = kwargs.get("messages") or (args[1] if len(args) > 1 else [])
        which = str(model).split("/")[-1]
        try:
            if which == "quorum":
                return await self._quorum(messages, kwargs)
            return await self._cascade(messages, kwargs)
        except Exception:
            # FAIL-OPEN — never hard-fail; fall back to one DeepSeek call.
            return await _call("deepseek", messages)

    # Speculative cascade — draft cheap on Workers AI, escalate only if low-confidence.
    async def _cascade(self, messages: list, kwargs: dict) -> litellm.ModelResponse:
        if not _ACCT:
            return await _call("deepseek", messages)
        draft = await _call("ollama", messages, max_tokens=kwargs.get("max_tokens", 1024))
        question = ""
        for m in reversed(messages):
            if m.get("role") == "user" and isinstance(m.get("content"), str):
                question = m["content"]
                break
        verdict = await _cf_judge(
            "You are a strict grader. Reply with ONLY 'YES' if the ANSWER fully, correctly, "
            "and confidently addresses the QUESTION; otherwise reply ONLY 'NO'.\n"
            f"QUESTION: {question[:2000]}\nANSWER: {_text(draft)[:2000]}"
        )
        if verdict.upper().startswith("YES"):
            return draft  # resolved on Cloudflare, ~free
        # escalate: Opus for high-stakes, else DeepSeek (mid).
        return await _call("opus" if _stakes_high(kwargs) else "deepseek", messages,
                           max_tokens=kwargs.get("max_tokens", 1024))

    # Quorum — fan out to 3 models, a Workers-AI judge picks the best.
    async def _quorum(self, messages: list, kwargs: dict) -> litellm.ModelResponse:
        tiers = ["opus", "gpt", "deepseek"]
        results = await asyncio.gather(*[_call(t, messages) for t in tiers], return_exceptions=True)
        cands = [(t, r) for t, r in zip(tiers, results) if not isinstance(r, Exception) and _text(r)]
        if not cands:
            return await _call("deepseek", messages)
        if len(cands) == 1:
            return cands[0][1]
        question = ""
        for m in reversed(messages):
            if m.get("role") == "user" and isinstance(m.get("content"), str):
                question = m["content"]
                break
        listing = "\n\n".join(f"[{i+1}]\n{_text(r)[:1500]}" for i, (_, r) in enumerate(cands))
        pick = await _cf_judge(
            "Pick the single BEST answer to the QUESTION. Reply with ONLY the number.\n"
            f"QUESTION: {question[:1500]}\n\n{listing}", max_tokens=4,
        )
        idx = 0
        for ch in pick:
            if ch.isdigit():
                idx = min(int(ch) - 1, len(cands) - 1)
                break
        return cands[max(idx, 0)][1]


# Registered via config.yaml `litellm_settings.custom_provider_map` (LiteLLM imports this
# at the right time — before model_list validation, unlike a callbacks-time import).
arbiter_instance = ProjectSitesArbiter()
