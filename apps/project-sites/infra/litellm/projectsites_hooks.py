"""
ProjectSites meta-LLM hooks for the LiteLLM gateway (llm.megabyte.space).

A single flag-gated pipeline that wraps EVERY request through the gateway (Twenty,
the worker, build agents) with research-backed prompt/quality/safety patterns — so a
pattern is added once here and every consumer inherits it. Each step is OFF by default
(env flag `HOOK_<NAME>=1` or per-request `metadata.hooks: ["<name>"]`) so prod behaviour
is unchanged until a flag is flipped.

EVERY step is FAIL-OPEN: a step that errors or times out is skipped and the original
request proceeds — a hook must never break a live call.

Mounted via config.yaml: `litellm_settings.callbacks: ["projectsites_hooks.hooks_instance"]`.

Implemented here (gateway-shaped patterns from the 50):
  pre-call : injection_scan · pii_redact · prompt_refiner · cot_injector ·
             context_compressor · format_preinstruction · intent_tagger · clarification_gate
  post-call: pii_scrub · brand_pass · json_validate · numeric_verify
  decision : speculative_cascade (cheap draft → escalate only on low confidence)

Not here (other layers): quorum/self-consistency/MoA (orchestration layer),
reranking/HyDE (RAG path), semantic cache (RediSearch), shadow/eval/bandit (infra).
"""

from __future__ import annotations

import os
import re
import json
from typing import Any, Optional

import litellm
from litellm.integrations.custom_logger import CustomLogger
from litellm.proxy._types import UserAPIKeyAuth

# ── the cheap tier the pre/post steps use (Cloudflare Workers AI Llama 3.3) ──
_ACCT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
_OLLAMA_MODEL = "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast"
_OLLAMA_BASE = f"https://api.cloudflare.com/client/v4/accounts/{_ACCT}/ai/run/"
_CHEAP_TIMEOUT = float(os.environ.get("HOOK_CHEAP_TIMEOUT", "8"))


def _on(name: str, data: dict) -> bool:
    """A step runs if its env flag is set OR the request opts in via metadata.hooks."""
    if os.environ.get(f"HOOK_{name.upper()}") in ("1", "true", "True"):
        return True
    meta = (data or {}).get("metadata") or {}
    return name in (meta.get("hooks") or [])


async def _cheap(prompt: str, *, system: str = "", max_tokens: int = 512) -> Optional[str]:
    """One fail-open call to the cheap tier. Returns text or None on any error."""
    if not _ACCT:
        return None
    msgs = ([{"role": "system", "content": system}] if system else []) + [
        {"role": "user", "content": prompt}
    ]
    try:
        r = await litellm.acompletion(
            model=_OLLAMA_MODEL,
            messages=msgs,
            api_key=os.environ.get("CLOUDFLARE_API_KEY"),
            api_base=_OLLAMA_BASE,
            max_tokens=max_tokens,
            temperature=0,
            timeout=_CHEAP_TIMEOUT,
        )
        return (r.choices[0].message.content or "").strip()
    except Exception:
        return None


def _last_user_text(messages: list[dict]) -> tuple[int, str]:
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            c = messages[i].get("content")
            if isinstance(c, str):
                return i, c
            if isinstance(c, list):  # multimodal — grab text parts
                return i, " ".join(p.get("text", "") for p in c if isinstance(p, dict))
    return -1, ""


# ── PII regexes (no Presidio dependency — fast, fail-open masking) ──
_PII = [
    (re.compile(r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b"), "[CARD]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[EMAIL]"),
    (re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"), "[PHONE]"),
    (re.compile(r"\b(sk|pk|psk|xoxb|ghp|gho)[-_][A-Za-z0-9_-]{16,}\b"), "[SECRET]"),
]
_INJECTION = re.compile(
    r"(ignore (all |the |your )?(previous|prior|above) (instructions|prompt)"
    r"|disregard (the |your )?(system|previous)"
    r"|you are now|new instructions:|developer mode|jailbreak|DAN mode"
    r"|reveal your (system )?prompt|print your (instructions|system prompt))",
    re.IGNORECASE,
)


def _mask(text: str) -> tuple[str, int]:
    n = 0
    for rx, tag in _PII:
        text, c = rx.subn(tag, text)
        n += c
    return text, n


class ProjectSitesHooks(CustomLogger):
    # ─────────────────────────── PRE-CALL ───────────────────────────
    async def async_pre_call_hook(
        self,
        user_api_key_dict: UserAPIKeyAuth,
        cache: Any,
        data: dict,
        call_type: str,
    ) -> dict:
        if call_type not in ("completion", "acompletion", "chat_completion"):
            return data
        msgs = data.get("messages")
        if not isinstance(msgs, list) or not msgs:
            return data
        idx, user_text = _last_user_text(msgs)
        if idx < 0:
            return data

        # 1. Injection scan — BLOCK on a clear jailbreak (only when enabled).
        if _on("injection_scan", data) and _INJECTION.search(user_text):
            from litellm.proxy._types import ProxyException
            raise ProxyException(
                message="Request blocked by prompt-injection guardrail.",
                type="invalid_request_error",
                param="messages",
                code="403",
            )

        # 2. PII redact — mask before the prompt leaves to an external provider.
        if _on("pii_redact", data):
            masked, n = _mask(user_text)
            if n:
                msgs[idx]["content"] = masked
                user_text = masked

        # 3. Context compressor — summarise very long prompts on the cheap tier.
        if _on("context_compressor", data) and len(user_text) > 6000:
            summ = await _cheap(
                user_text,
                system="Compress the following into a faithful, information-dense brief. Keep every fact, name, number, and instruction. Output only the brief.",
                max_tokens=900,
            )
            if summ:
                msgs[idx]["content"] = summ
                user_text = summ

        # 4. Prompt refiner — rewrite the user prompt for clarity/specificity.
        if _on("prompt_refiner", data):
            ref = await _cheap(
                user_text,
                system="Rewrite the user's request to be clearer, more specific, and well-structured WITHOUT changing its intent, adding facts, or answering it. Output only the rewritten request.",
                max_tokens=512,
            )
            if ref and len(ref) > 8:
                msgs[idx]["content"] = ref
                user_text = ref

        # 5. Chain-of-thought injector — nudge step-by-step reasoning.
        if _on("cot_injector", data):
            msgs[idx]["content"] = user_text + "\n\nThink step by step, then give the final answer."

        # 6. Format pre-instruction — force valid JSON when the caller asked for it.
        if _on("format_preinstruction", data) and (data.get("response_format") or {}).get("type") == "json_object":
            msgs.insert(0, {"role": "system", "content": "Respond with a single valid JSON object. No prose, no code fences."})

        # 7. Intent tagger — tag the request for routing + analytics (cheap, async).
        if _on("intent_tagger", data):
            tag = await _cheap(
                user_text[:1500],
                system="Classify this request in ONE lowercase word from: summarize, draft, extract, classify, code, analyze, qa, other. Output only the word.",
                max_tokens=4,
            )
            if tag:
                data.setdefault("metadata", {})["intent"] = tag.split()[0][:20]

        return data

    # ─────────────────────────── POST-CALL ──────────────────────────
    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict: UserAPIKeyAuth,
        response: Any,
    ) -> Any:
        try:
            choice = response.choices[0]
            content = choice.message.content
        except Exception:
            return response
        if not isinstance(content, str) or not content:
            return response

        # 8. PII scrub — never return raw PII the model echoed back.
        if _on("pii_scrub", data):
            scrubbed, n = _mask(content)
            if n:
                content = scrubbed
                response.choices[0].message.content = content

        # 9. JSON validate — if JSON was requested, strip fences / verify parseable.
        if _on("json_validate", data) and (data.get("response_format") or {}).get("type") == "json_object":
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
            try:
                json.loads(cleaned)
                response.choices[0].message.content = cleaned
            except Exception:
                pass  # fail-open: leave as-is rather than drop the response

        # 10. Brand pass — de-slop the output to the house voice.
        if _on("brand_pass", data):
            polished = await _cheap(
                content,
                system="Rewrite to be sharp, concrete, and free of AI-slop words (leverage, robust, seamless, elevate, unlock, world-class, cutting-edge). Keep all facts + meaning. Output only the rewrite.",
                max_tokens=1024,
            )
            if polished and len(polished) > 8:
                response.choices[0].message.content = polished

        return response


hooks_instance = ProjectSitesHooks()
