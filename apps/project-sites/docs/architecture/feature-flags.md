# Feature Flags — Architecture Reference

> **Rule source:** `~/.claude/plugins/heymegabyte-claude-skills/rules/feature-flags.md`  
> **Registry:** `src/modules/feature_flags/registry.ts`  
> **Resolver:** `src/modules/feature_flags/services.ts`  
> **Docs:** `src/modules/feature_flags/docs.ts`  
> **Scaffolder:** `scripts/gen-feature.mjs`

---

## Why feature flags

Every feature beyond a trivial one-file edit ships behind a flag.  
This means:

- **Reversible** — broken feature flips off in <60s via admin UI, no redeploy.
- **Gradual rollout** — 5% → 25% → 50% → 100% with observable error rates at each step.
- **Per-tenant QA** — pin a flag on for one org while everyone else stays dark.
- **Killswitch** — stage `killswitch` disables globally, instantly, for all users.
- **Audit trail** — every toggle logged to `feature_flag_audit` (SOC 2 ready).

---

## Two-layer control plane (UI architecture)

Feature flags surface on **two layers**, each its own route + audience:

### Layer 1 — System Administrator (`/admin/feature-flags`)
Platform-operations flags for the super-admin (`AdminFeatureFlagsComponent`):
- Lists every registry flag with status / scope / risk badges, owner, rollout, stage.
- **Progressive disclosure** (persisted in `localStorage`): **Simple** (cards + toggle +
  rollout + one-line "why") → **Advanced** (targeting / rollout slider / scheduling) →
  **Expert** (raw key, JSON payload editor — invalid-JSON / non-object / no-recognized-fields
  all bail with a `role=alert`; evaluation trace killswitch→global→rollout→result; per-flag
  audit-history timeline; blast-radius; admin payload editor).
- **Dangerous changes** (kill-switch-on, global-enable-from-off, ≥25-pt rollout jump per
  `classifyChange`) route through a confirm panel demanding a typed reason (≥4 chars → audit
  trail) + blast radius + rollback plan. **Emergency console** kills every non-stable,
  non-core flag in one reasoned sweep (`killAllNonStable` — never touches `stable`/`core_`).

### Layer 2 — Features (`/admin/site-features`)
Owner-facing, SITE/tenant-scoped features a site owner enables for THEIR hosted site
(e.g. Online Booking for megabyte.space) — `AdminSiteFeaturesComponent`:
- Plan-aware feature cards + one-line "why" + toggle + entitlement-locked states
  (upgrade / add-on — never a broken toggle) + preview mode + undo.
- Plan-gated via `entitlementFor({plan, requiredPlan, isAddon})` →
  `available | upgrade-required | addon-required`; the worker re-checks entitlement +
  tenant-isolates on `POST /api/site-features/:key`.

Shared logic: `sections/feature-flags/flag-logic.ts` (bucketing, rollout, evaluation trace,
`classifyChange`, `validateConstraints`, `entitlementFor`) — tested by `flag-logic.spec.ts`
(35) + component specs (feature-flags 30, site-features 11) + `admin-flag-control-plane.spec.ts`
E2E (27).

> **Not yet built (worker-backed, tracked):** quota controls, multi-user approval workflow,
> A/B experiments (only the `experimental` *stage* exists today), auto-rollback.

---

## D1 schema

Three tables added by `migrations/0500_feature_flags_and_services.sql`:

### `feature_flags`

Canonical admin-visible state. One row per flag key.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | PK |
| `key` | TEXT | Unique, snake_case ≤32 chars |
| `enabled` | INTEGER (0/1) | Global on/off |
| `rollout_percent` | INTEGER 0-100 | Gradual rollout gate |
| `stage` | TEXT | `experimental \| beta \| stable \| deprecated \| killswitch` |
| `description` | TEXT | Shown in admin UI |
| `owner_email` | TEXT | DRI contact |
| `created_at` | TEXT (ISO-8601) | |
| `updated_at` | TEXT (ISO-8601) | |

### `flag_overrides`

Per-scope overrides. Wins over the registry default.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | PK |
| `scope` | TEXT | `tenant \| org \| global` |
| `scope_id` | TEXT | site_id, org_id, or `*` |
| `flag_key` | TEXT | FK → `feature_flags.key` |
| `value_json` | TEXT | `{enabled, rollout_percent, stage}` partial |
| `expires_at` | TEXT | NULL = permanent |
| `deleted_at` | TEXT | Soft delete |

### `feature_flag_audit`

Append-only. Every admin toggle creates a row.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | PK |
| `flag_key` | TEXT | |
| `actor_email` | TEXT | Who made the change |
| `action` | TEXT | `toggle \| rollout \| promote \| killswitch` |
| `before_json` | TEXT | State before |
| `after_json` | TEXT | State after |
| `created_at` | TEXT | |

---

## Resolution order

`services.ts::resolveFlag()` evaluates highest-priority source first:

1. **Tenant override** — `scope=tenant, scope_id=<siteId>`
2. **Org override** — `scope=org, scope_id=<orgId>`
3. **Global override** — `scope=global, scope_id='*'`
4. **Registry default** — `src/modules/feature_flags/registry.ts`

KV cache (`CACHE_KV`) stores the resolved state under `flag:<key>:<siteId>:<orgId>` with a 60-second TTL. Admin mutations call `invalidateFlagCache()` to purge immediately.

---

## Registry standard

`registry.ts` is the floor — every flag key the worker recognises. Adding a key here does **not** enable the feature; it just declares the key exists and provides the hard-coded default state.

Rules:
- Naming: `lowercase_snake_case`, ≤32 chars, no hyphens.
- Default: `enabled: false, rollout_percent: 0, stage: 'experimental'`.
- Sub-toggles: use `flag_overrides`, not new flag keys.
- Never remove an entry until the feature code is removed too.

---

## When to create a flag

Create a flag when **any** of these apply:

- Adding a new API endpoint.
- Adding a new UI route or section.
- Adding a background workflow.
- Changing billing behaviour.
- Any change that, if broken, could affect all tenants.

**Exempt** (no flag needed):

- One-line copy fixes.
- Dependency version bumps.
- Purely additive migrations with no runtime behaviour.
- Internal tooling scripts.

---

## Stages and promotion criteria

| Stage | Audience | Promotion criterion |
|-------|----------|---------------------|
| `experimental` | Devs + DRI org (via override) | Code complete + unit tests pass |
| `beta` | 5-25% rollout | 1 week at beta without P1 + axe-clean |
| `stable` | 100% | 2 weeks at beta + Lighthouse ≥95 |
| `deprecated` | 100% (with EOL banner) | Replacement shipped, sunset in 30d |
| `killswitch` | Nobody | P1 incident; resolution before un-killing |

Promotion is performed in the admin UI at `/admin/feature-flags` — never by editing `registry.ts` after the initial insertion.

---

## Runtime behaviour

### Server guard

```ts
import { isFlagOn } from '../modules/feature_flags/services.js';

app.get('/api/my-feature', async (c) => {
  const on = await isFlagOn(c.env, 'my_feature', {
    orgId: c.get('orgId'),
    siteId: c.get('siteId'),
  });
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  // ... feature logic
});
```

Use **404, never 403**. 403 leaks that the feature exists. 404 is silent.

### UI guard (Angular signal)

```ts
// Angular service
readonly myFeatureOn = toSignal(
  this.http.get<{ enabled: boolean }>('/api/feature-flags/my_feature').pipe(
    map(r => r.enabled),
    startWith(false),
  )
);
```

```html
@if (featureFlags.myFeatureOn()) {
  <app-my-feature />
}
```

---

## Per-environment overrides

Override resolution respects scope, not environment. To enable a flag only in staging:

1. Deploy staging worker with `FLAG_REGISTRY.my_feature.default_enabled = false`.
2. Add a global override in staging D1: `INSERT INTO flag_overrides (scope, scope_id, flag_key, value_json) VALUES ('global', '*', 'my_feature', '{"enabled":true,"rollout_percent":100}')`.
3. Production D1 has no override → production stays off.

Alternatively, use a per-org override for QA tenants that works across environments.

---

## Rollout recipe

```
Day 0:  experimental  rollout=0    (devs only via override)
Day 1:  beta          rollout=5    (watch error rate 1h)
Day 3:  beta          rollout=25   (watch 24h)
Day 7:  beta          rollout=50   (watch 48h)
Day 10: beta          rollout=100  (all users)
Day 17: stable        rollout=100  (2+ weeks clean)
Day 47: remove flag check from code (30+ days stable)
```

---

## Killswitch

In the admin UI: **Feature flags** → select flag → **Stage** → `killswitch`.

`resolveFlag()` checks for `stage === 'killswitch'` **before** any D1 query and returns `{ enabled: false }` immediately — no cache, no DB hit.

To un-killswitch: set stage back to `beta` or `stable` via admin UI; the KV cache will repopulate within 60s.

---

## Scaffolding a new feature

```bash
npm run gen:feature -- \
  --slug my-feature \
  --name "My Feature" \
  --description "Does amazing things that users will love and pay for." \
  [--owner you@example.com]
```

The scaffolder:
1. Validates slug (unique vs `libs/features/` and `FLAG_REGISTRY`).
2. Copies `tools/templates/feature-module/` → `libs/features/my-feature/`.
3. Substitutes `{{slug}}`, `{{Name}}`, `{{SLUG_UPPER}}`, `{{owner}}` in every file.
4. Appends the flag entry to `registry.ts` (above the closing `}`).
5. Appends a stub docs entry to `docs.ts`.
6. Prints a next-steps checklist.

**Idempotent:** re-running with the same slug exits 1 immediately.

---

## Quarterly cleanup

Every 90 days, scan `FLAG_REGISTRY` for flags at `stage='stable'` with `rollout_percent=100` for 30+ days:

1. Remove the `if (!on) return 404` guard from the handler.
2. Remove the `isFlagOn` call.
3. Remove the registry entry.
4. Remove the docs entry.
5. Archive the override rows (soft-delete, keep for audit trail).

Do **not** remove the feature — only remove the flag check. The feature ships permanently.

---

## See also

- `src/modules/feature_flags/registry.ts` — all flag definitions
- `src/modules/feature_flags/services.ts` — `isFlagOn`, `resolveFlag`, `invalidateFlagCache`
- `src/modules/feature_flags/docs.ts` — smoke tests and explanations per flag
- `tools/templates/feature-module/` — scaffolder template
- `scripts/gen-feature.mjs` — scaffolder CLI
- `migrations/0500_feature_flags_and_services.sql` — D1 schema
