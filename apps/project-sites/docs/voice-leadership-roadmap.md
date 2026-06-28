# Voice + SMS — 50-Idea Leadership Roadmap (Twilio + LiveKit)

> Goal: make the per-site AI receptionist (LiveKit Cloud agent + Twilio Elastic SIP +
> per-site LiteLLM on CF Workers + Twenty CRM + live-site RAG) a second-to-none
> experience that stays a market leader 10+ years. Research-grounded 2026-06-28
> (5 parallel web sweeps: LiveKit platform · competitors · STT/TTS/LLM frontier ·
> telephony+compliance · voice UX/outcomes). Loop drives these, TDD-first, behind the
> `voice_receptionist` flag. Each idea: concrete + tied to our stack + a durability note.

## The thesis (from competitive white-space)

Every competitor (Vapi/Bland/Retell/Synthflow/PolyAI/Rosie) is a **standalone $29–99/mo
SaaS the SMB must wire to "their existing phone system."** Our unfair advantage is being a
**website feature**: the receptionist is born grounded in the same CMS content, hours,
services, FAQ, and booking the site already renders — zero drift, zero setup, bundled
pricing, native per-site multi-tenancy (no Synthflow $2K/mo white-label tax). We win on
**grounding + continuity + economics + edge latency**, not on having-a-voice-agent.

---

## A. Latency & audio quality (the commoditized floor — never lose it)

1. **Deepgram Flux STT (integrated EOT).** Already chosen — keep it. Flux's model-integrated end-of-turn cuts agent response 200–600ms vs STT+VAD and ~30% fewer false interruptions ($0.0065/min EN). This is the single biggest naturalness lever; never regress to Nova-3+VAD for the live path.
2. **`BVCTelephony()` Krisp noise cancellation, applied ONLY at the agent.** 8kHz-tuned background-voice-cancellation = +18% WER on noisy calls. Hard rule: apply in exactly one place (agent `RoomInputOptions`), never also on the SIP trunk/frontend, or it double-processes.
3. **Codec discipline: accept G.711 (PCMU) from Twilio, strip the rest in the SDP answer, resample to 16kHz internally.** Avoid G.729 (artifacts wreck ASR + synth voice). Add an explicit jitter buffer on the SIP leg (SIP has none, unlike WebRTC). Poor transcoding — not the LLM — is the usual latency culprit.
4. **Pre-synthesized + cached audio for greetings, confirmations, and fillers.** TTS-cache the opening line, "let me check that for you," and yes/no confirmations at agent startup. Latency-hiding fillers while a tool call runs turned 800→400ms and lifted call-completion 61%→89% in a documented case.
5. **Edge co-location as a P95 weapon.** Competitors centralize; our CF-edge + LiveKit Cloud regional placement should target P95 (not just median) — P95 >1.5s is where callers hang up and where all three leaders degrade under load. Instrument P95 per-region and pin the agent region to the trunk region.

## B. Turn-taking & conversation naturalness

6. **LiveKit MultilingualModel turn detector + `preemptiveGeneration`.** Already wired — keep `turnHandling.preemptiveGeneration.enabled` + `interruption.mode:'adaptive'`. Semantic EOU (135M transformer, 14 langs) + preemptive LLM start is the 2026 "turn-taking solved" baseline.
7. **Backchannel-vs-interrupt classifier.** "uh-huh / yeah / ok" must NOT yield the floor; a real interruption must. Energy VAD can't tell them apart — add a semantic intent gate so the agent keeps talking through backchannels. Biggest perceived-quality win after EOT.
8. **Per-vertical turn-taking presets.** Spelled numbers/addresses/$ amounts need longer endpointing than yes/no; therapy/narrative tolerates aggressive interjection, transactional doesn't. Ship `endpointing` + interjection-threshold presets keyed off the site's `business_type` (we already infer it).
9. **Graceful repair + ≤3-option spoken scripting.** "Sorry, let me try that again" on low ASR confidence; never read a 6-item menu — offer 2–3 options and let the caller barge-in early. Voice scripting ≠ chat scripting; bake this into the persona prompt template.
10. **Voicemail / answering-machine detection.** Detect machine pickup (for any outbound: reminders, callbacks) and branch to a leave-message path instead of talking to dead air. Standard for outbound; we'll need it the moment proactive outbound (idea 24/45) ships.

## C. Per-site grounding & the "one brain" moat (our core differentiator)

11. **Auto-synced site RAG — the receptionist reads the same content the site renders.** Index the live CMS (hours, services, pricing, FAQ, team, policies) into Vectorize on every publish; the agent retrieves mid-call with no pause. Thin knowledge base is the #1 cause of 30-day underperformance + wrongful lead disqualification across every competitor — and the thing none of them auto-sync.
12. **Zero-drift contract: publish → re-embed.** Wire the existing publish workflow to re-embed changed pages so the agent can never quote stale hours/prices. This "site is the source of truth" guarantee is impossible for standalone competitors and is our headline marketing claim.
13. **Per-site persona derived from brand, not hand-authored.** Generate the receptionist persona/voice from `_brand.json` (tone, name, values) at provision time so every site sounds on-brand on day zero with no config. Pairs with Piper voice selection per brand.
14. **Caller-recognition on call-start (pre-greeting CRM lookup).** HTTP-lookup the caller's number/email in Twenty CRM before the greeting; ~40% of B2B calls match an existing record — greet returning callers by name and adapt instead of cold-starting. Sub-second, runs during ring.
15. **Per-caller memory across calls.** Persist caller preferences/intent/last-topic in D1 keyed by phone hash; "calling back about the kitchen remodel quote?" Memory is a durable personalization moat that compounds — competitors store nothing per-caller by default.

## D. Actions & outcomes (book, qualify, capture — what SMBs pay for)

16. **Book during the call, not "we'll get back to you."** Function-call the site's calendar (Cal.com/Calendly/Twenty) to offer real slots and confirm live. Booking-in-call vs deferred is a large, documented conversion lift; it's the #1 outcome an SMB judges us on.
17. **4–6 question lead-qualify → real-time score → route.** Qualify, score, then book / nurture / end-clean in one call. POST the structured score + answers to Twenty CRM. ~$0.40/AI call vs $7–12 human.
18. **Urgency-aware routing (not a single action).** 51.5% of calls carry urgency language. Emergency → live warm transfer; "need a quote today" → text booking link mid-call; "call before 5" → scheduled callback. Classify urgency and branch.
19. **Warm transfer with full context (never cold) on 3 triggers.** Explicit human ask, frustration for 3 consecutive turns, or high-value/regulated category → SIP REFER attended transfer that briefs the human with the live summary. 73.8% of AI calls still hand off — make the handoff excellent.
20. **Structured post-call fan-out.** Every call ends → Twenty CRM record/update + calendar invite + Slack/email notify + (already shipped) transcript→Conversations + `voice_call_completed` PostHog event. The agent's value is the artifact it leaves, not the chat.

## E. Omnichannel continuity (one external brain, many channels)

21. **One state store, not LLM-context.** Voice / SMS / email / web-chat are *views into one D1+Vectorize state*, never per-channel memory. Failure mode to design out: SMS follow-up forgetting the call, outbound not knowing the user already texted-confirmed.
22. **Call → SMS handoff mid-conversation.** "I just texted you the booking link / address / quote" — fire an A2P 10DLC SMS during the call with the exact artifact. Closes the "93% never call back after voicemail" gap with an immediate written touch.
23. **SMS receptionist sharing the voice brain.** The existing SMS path (`voice_orchestrator`) uses the SAME per-site LiteLLM + RAG + CRM tools as voice, so a caller who texts gets continuity with their call. (Rec #38 in the prior queue — the additive `callExternalLLM` baseUrl/apiKey override; do carefully.)
24. **Proactive outbound, same brain.** Appointment reminders, review requests, missed-call text-back within 90 seconds (speed-to-lead). After-hours: 34.8% of missed callers express buying intent — auto-text them back instantly. Gate behind TCPA consent (idea 33).
25. **Web-chat ↔ voice continuity.** A visitor who chatted on the site then calls is recognized and continued. Ties the site's chat widget to the same caller-memory store — a continuity story no standalone phone product can tell.

## F. Caller trust & telephony excellence

26. **STIR/SHAKEN A-level attestation + Twilio Voice Integrity registration.** Register every provisioned number (Business Profile + EIN) so calls aren't spam-labeled. For no-EIN sites, fall back to Free Caller Registry. A spam-flagged outbound call is a dead feature.
27. **Branded Calling (RCD/BCID) — business name + logo + call reason on the callee's screen.** CTIA Branded Calling ID signs name/logo/reason into the PASSporT at A-attestation. The FCC Ninth FNPRM (adopted Oct 28 2025) is folding verified identity into attestation — adopt early; this becomes table-stakes and we want it shipped first.
28. **Spam-label monitoring + remediation loop.** Continuously check number reputation across T-Mobile/Verizon/AT&T analytics; auto-remediate flagged numbers. Surface "call reputation: healthy" in the admin so the SMB trusts the channel.
29. **Failover trunks + call-quality SLO.** Secondary SIP trunk + health-checked failover; monitor MOS/jitter/packet-loss per call and alert. A receptionist that's down during the dinner rush is worse than no receptionist.
30. **Elastic SIP over TwiML (locked).** Stay on Elastic SIP Trunking — it supports SIP REFER (warm transfer) + outbound, which TwiML Programmable Voice does not. This is why we picked it; document it so no one "simplifies" back to TwiML.

## G. Compliance-as-a-feature (this is the 10-year durability bet)

31. **Graceful AI disclosure, first-exposure, every call.** "Hi, I'm [Name], [Business]'s AI assistant" in the opening line (already in the agent's first reply). FCC ruling FCC-24-17 puts conversational AI under TCPA; CA BOT Act (SB 1001) + EU AI Act Art. 50 (eff Aug 2 2026) mandate disclosure. Make it warm, not robotic — 90% can't tell it's AI, so disclosure is the trust play.
32. **Per-call compliance artifact (immutable).** Persist per call: timestamp, parties, agent identity, the opening-disclosure transcript line, full transcript, consent citation, and any revocation event. This is the audit record EU AI Act + TCPA defense require — and a feature no SMB-grade competitor ships. Store in D1, surfaced in admin.
33. **TCPA consent ledger for any outbound voice/SMS.** No proactive call/text without recorded prior express (written, for marketing) consent — $500–$1,500/msg exposure. Build a consent table keyed to the contact + source + timestamp; gate outbound on it. One-to-one consent rule compliant.
34. **A2P 10DLC done right (carriers block 100% unregistered since Feb 1 2025).** Auto-register brand + campaign via The Campaign Registry per site; keep AI SMS on registered templates (carriers AI-match live messages to samples); enforce STOP/HELP instantly + quiet hours 8a–9p local + SHAFT content ban.
35. **Jurisdiction-aware policy engine.** A small config layer that flips disclosure wording, quiet hours (TX 9a–9p), consent strictness, and EU-vs-US transparency by the callee's region. Future-proofs against the active regulatory churn (FCC NPRM pending, CA SB 243 private right of action eff Jan 1 2026, EU guidelines May 2026) — change config, not code.

## H. Observability, evals & self-improvement

36. **LiveKit native evals in CI (pytest/Vitest + LLM judges).** Every persona change runs a scripted call suite with LLM-judge scoring before deploy. Turns "did we break the receptionist?" from a live-call gamble into a gate.
37. **`lk perf agent-load-test` before every go-live.** Load-test rooms/agent under concurrency to catch the P95 degradation that kills competitors under load. Wire into the release checklist.
38. **Agent Observability: synced audio + transcript + traces (TTFT, TTS-TTFB, EOU latency).** Turn on LiveKit Cloud Agent Observability (Py SDK v1.3+) so every call's latency breakdown is inspectable. You can't lead on latency you can't see.
39. **Self-improving eval loop (Cekura-style red-team in CI/CD).** Per-call accuracy + missed-intent scoring feeds a regression set; failed real calls become eval cases. The receptionist measurably improves week-over-week (vendors report 80–85% wk1 → 90–95% wk4) — automate that curve instead of hoping for it.
40. **Outcome analytics SMBs actually read.** Not "90% resolution" vanity (73.8% still transfer — resolution ≠ containment). Surface: booking rate, after-hours revenue captured, missed-call→two-way-conversation %, speed-to-text-back, $ recovered. LLM sentiment (context/sarcasm), not keyword. 95% of calls reviewable vs 3% manual.

## I. Economics & the multi-tenant moat

41. **Cascaded pipeline as the default (Deepgram + LiteLLM + Piper/Cartesia) — ~$0.03/min.** Keep cascaded, not speech-to-speech: it wins on tool-calling reliability, telephony robustness, transcript/compliance, debuggability, and vendor flexibility (5+ STT, 7+ TTS). S2S is 250–350ms but weaker tool-use + 2-vendor lock-in.
42. **Hybrid escalation: S2S for hard reasoning turns only.** Route simple turns through cascaded; escalate to GPT-Realtime-2 (GPT-5-class mid-turn reasoning) only for genuinely hard intake/troubleshooting turns where it earns its ~$0.06/min. Best-of-both, cost-controlled.
43. **Piper self-host TTS = structural cost + sovereignty edge.** MIT VITS/ONNX on CPU/edge → near-zero marginal TTS cost + data sovereignty, while competitors pay $30–150/1M chars (and BYOK doubles their real cost). This is how we bundle the receptionist into the site price instead of charging $99/mo.
44. **Per-site virtual LiteLLM keys + budgets.** Each site gets its own LiteLLM virtual key with a spend cap, so one runaway site can't blow the platform bill and per-site cost is attributable. (Blocked-on-Brian: LiteLLM proxy + `LITELLM_BASE_URL`/`_API_KEY` on the worker.)
45. **Native white-label multi-tenancy — free, because it's our architecture.** Per-site tenancy, custom-domain calls, and brandable personas are the platform, not a $2,000/mo Synthflow add-on. Lean into "every site you build gets a leading AI receptionist included."

## J. AI-native frontier bets (lead in 2030, not just 2026)

46. **Continuous control loop (Perceive→Reason→Act→Observe→Adapt), not per-turn.** Model the agent as a planning loop so it can take delayed/proactive actions (90-sec speed-to-lead, scheduled callbacks, multi-step follow-through) — the architecture that separates "autonomous agent" from "voicebot."
47. **Native MCP tools in the agent (`MCPToolset`).** Let the receptionist call the site's own MCP servers (booking, inventory, CRM, payments) as first-class tools — composable, per-site, and future-proof as MCP becomes the agent-tool standard. We already run an MCP OAuth layer; wire it into the agent.
48. **Vision/video receptionist for video-capable surfaces.** LiveKit supports live video in (Gemini Live native, 1fps sampling) — a future "show me the damage / read me the model number" video intake for home-services/insurance verticals. Cascaded stays the voice default; vision is an opt-in surface.
49. **Optional branded avatar (AvatarSession).** For web-embedded "call us" widgets, an opt-in synced talking avatar (Tavus/Simli/Anam) for premium brands. Strictly secondary to voice; gated per site.
50. **Outcome-aligned billing borrowed from Sierra, at SMB scale.** Long-term, offer pay-per-resolution / pay-per-booking pricing (escalations free) on top of the bundled tier — the model Sierra ($15.8B) proved enterprises love, that no SMB receptionist offers. Aligns our incentive with the SMB's revenue and is the hardest pricing moat to copy.

---

## Sequencing (loop priority)

- **Now (additive, low-risk):** 11/12 (publish→RAG re-embed), 14 (caller-recognition lookup), 20 (post-call fan-out — partly shipped), 31/32 (disclosure + compliance artifact), 38 (observability on).
- **Next (needs a tool/integration):** 16 (in-call booking), 17 (qualify+score), 19 (warm transfer), 22/24 (call→SMS, missed-call text-back), 36/39 (evals in CI).
- **Brian-gated:** 26/27 (STIR/SHAKEN + Branded Calling registration), 33/34 (consent ledger + 10DLC), 44 (LiteLLM virtual keys), 30 (trunk wiring), live `lk agent deploy`.
- **Frontier (when a vertical demands it):** 42 (hybrid S2S), 46 (control loop), 47 (MCP tools), 48/49 (vision/avatar), 50 (outcome billing).

Durability principle: B/C/E/G/I are the moat (grounding, continuity, compliance, economics) — A/F are table-stakes we must never lose. Re-run the 5-frontier sweep every ~2 quarters; the model/price/latency facts in A & I age fastest.
