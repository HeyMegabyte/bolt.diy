> **STATUS 2026-07-31 (post-live-run):** the 9 evidence specs were executed against prod — **33/55 tests failed** (every file has failures; stale-era specs that never previously ran). ALL 8 promotions ON HOLD; registry stage edits reverted. Unblock = modernize each spec (Pass-14 queue), wire into testMatch individually when green, then apply that flag's beta bump.

# Flag Promotions — 2026-07-31

Stage is CODE-persisted in `src/modules/feature_flags/registry.ts` (`FlagDefinition.stage`;
`resolveFlag` falls back to it — the D1 override stage is an optional shadow with zero seeds).
Registry census at authoring time (origin/main `e7a56c30`): **90 keys — 71 experimental, 19 stable, 0 beta**.

This pass promotes the ONLY 8 experimental flags whose `FLAG_DOCS.e2e_tests` name real,
on-disk Playwright specs (9 spec files, all verified present). **Stage field only** — every
flag stays dark (`default_enabled: false`, `default_rollout_percent: 0`); `beta` here marks
"e2e-verified, ready for admin-dialed rollout via /admin/feature-flags", not an enablement.
The 9 specs are appended to `playwright.prod.config.ts` testMatch (subdir-anchored) so the
evidence RUNS in the prod suite from now on.

> Gate for the main thread: RUN the 9 specs live before merging. Any spec that fails →
> prune its testMatch entry AND revert that flag's stage hunk (each hunk is independent).

## Promotions (experimental → beta)

| flag_key | stage now | proposed | evidence specs | risk note |
|---|---|---|---|---|
| `site_analytics` | experimental | beta | `e2e/admin/analytics.spec.ts` | Read-only, site-scoped aggregates; off → route 404s. No write path, no cross-tenant risk. |
| `pwa_manifest_full` | experimental | beta | `e2e/pwa.spec.ts` | Static manifest enrichment (screenshots/shortcuts/share_target); off → base manifest serves. Zero data risk. |
| `site_mcp_server` | experimental | beta | `e2e/site-mcp/site-mcp.spec.ts` | Per-site MCP surface is read-only over published content; off → 404. Watch: agent-traffic volume once dialed up. |
| `pseo_matrix_v2` | experimental | beta | `e2e/pseo/pseo-matrix.spec.ts` | Build-time page-set generation (cap 200/axis); off → v1 path. Risk is content volume, not correctness. |
| `unified_inbox` | experimental | beta | `e2e/_fortress/unified_inbox/happy-path.spec.ts` + `e2e/_fortress/unified_inbox/adversarial.spec.ts` | Only flag with an adversarial fortress pair. Touches PII (visitor messages) — keep rollout ≤25% until SLA + assignment paths soak. |
| `email_deliverability_wizard` | experimental | beta | `e2e/admin/deliverability.spec.ts` | Read-only DNS-over-HTTPS checks, persists nothing; off → 404. Lowest-risk promotion in the set. |
| `outbound_webhooks` | experimental | beta | `e2e/webhook/webhooks.spec.ts` | Egress to customer endpoints (HMAC-signed, AES-GCM secrets at rest). SSRF-adjacent surface — https-only endpoint validation must hold at rollout. |
| `site_video_gen` | experimental | beta | `e2e/media-video-studio.spec.ts` | Veo cost per build is the real risk, not correctness. Dial rollout with a per-org budget cap in view. |

## Holds — 63 experimental flags without `FLAG_DOCS.e2e_tests`

71 experimental − 8 promoted = **63 hold at experimental**. Promotion path for every one of
them: add a real spec, wire it into `FLAG_DOCS.e2e_tests`, anchor it in
`playwright.prod.config.ts`, run it green, THEN flip stage. Grouped by module family:

| family | count | keys |
|---|---|---|
| Money, growth + monetization | 11 | payments_rail, storefront_ecommerce, native_booking_engine, credit_wallet_rollover, referral_loop, upgrade_moments, ai_payment_command, email_marketing, lead_scanner, site_doctor, preview_share_card |
| AI + build pipeline | 10 | ai_auto_router, editor_vision_qa, prompt_studio, ai_gateway_guardrails, ai_concierge_widget, generative_ui_stream, page_audio_summary, model_registry, onboarding_copilot, wireframe_planning |
| Editor + site tooling | 9 | visual_point_edit, url_clone_seed, cmdk_ai_actions, cmd_k_actions, site_clone, site_comparison, batch_operations, figma_import, token_burn_meter |
| Platform + integrations | 8 | platform_mcp, mcp_oauth_provider, cms_content, deploy_buttons, dittofeed_integration, better_auth, collab_editing, observability_gateway |
| Analytics + visitor events | 7 | analytics_rollup_read, visitor_events_core, nl_analytics, analytics_annotations, site_health_sparklines, usage_gauges, edge_personalization |
| Admin cockpit UX | 7 | site_tags, system_status, activity_feed, mru_cards, notification_badge, site_thumbnail_grid, onboarding_progress |
| Trust, compliance + ops | 6 | turnstile_build_gate, abuse_takedown, visitor_dsar, audit_trail_export, prod_readiness_score, status_page_live |
| SEO + search | 5 | search_engine_submit, gbp_assist, aeo_pass, site_semantic_search, vectorize_search |

Note: `observability_gateway` + `collab_editing` now HAVE `e2e_tests` (inverse-drift fix
below) but hold at experimental this pass — their specs were already running in prod before
this pass, so their promotion rides the next cycle with soak evidence rather than a
same-pass flip.

## Inverse-drift fixes (specs ran in prod, FLAG_DOCS said nothing)

Both specs have been in `playwright.prod.config.ts` testMatch (bare entries, lines 17-18)
while their FLAG_DOCS entries lacked `e2e_tests` — the exact mirror image of the 8
promoted flags (docs pointed at specs that never ran). Fixed in `docs.ts`:

1. `observability_gateway` → `e2e_tests: ['e2e/observability_gateway.spec.ts']` (file exists, 2.4K, 2026-06-19)
2. `collab_editing` → `e2e_tests: ['e2e/collab.spec.ts']` (file exists, 2.4K, 2026-06-24)

Caveat the predecessor missed: the FLAG_DOCS key is **`collab_editing`**, not `collab` —
the spec basename (`collab.spec.ts`) does not equal the flag key. Grep by key, not basename.

## Promotion runbook (per `rules/feature-flags.md`)

- **experimental → beta** — code complete + unit tests pass + ≥1 real Playwright spec in
  `FLAG_DOCS.e2e_tests` that RUNS in the prod suite and is green. (This pass.) Stage flip is
  code-persisted in `registry.ts`; rollout stays 0 until the admin dials it.
- **beta rollout** — doctrine target is `enabled=1, rollout=5-25%`, dialed from
  `/admin/feature-flags` (never a code edit). These 8 ship stage=beta but still dark —
  the admin flip is the go-live, keeping the killswitch-free path a UI action.
- **beta → stable** — 1 week at beta without a P1 + axe-clean on the flag's surfaces +
  Lighthouse ≥95, then 2 weeks soak at beta before `stable, 100%`.
- **stable cleanup** — at `stable, 100%` for 30+ days, remove the flag check (not the
  feature) in the quarterly sweep.
- **killswitch** — any P1: set `stage='killswitch'` via admin; instant disable, no redeploy.
- **Zod caveat before enabling** (CLAUDE.md gotcha #10): any promoted flag whose handlers
  live in `src/routes/features.ts` still carries `as`-cast bodies — add the colocated Zod
  schema + unit test for that endpoint BEFORE its first non-zero rollout.

## Files changed this pass

- `src/modules/feature_flags/registry.ts` — 8 independent stage hunks (`experimental` →
  `beta`, one `// beta 2026-07-31: e2e verified — <spec>` comment each; enabled/rollout untouched)
- `src/modules/feature_flags/docs.ts` — `e2e_tests` added to `observability_gateway` + `collab_editing`
- `playwright.prod.config.ts` — 9 anchored testMatch entries (one commented block)
- `docs/flag-promotions-2026-07-31.md` — this file
