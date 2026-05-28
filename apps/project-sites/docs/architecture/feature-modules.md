# Feature Module Standard — projectsites.dev

> Phase 4 of the whole-app feature-module architecture.
> Cross-links: [[feature-flags]] · [[website-build-doctrine]] · [[brian-preferences]]

---

## What Is a Feature Module?

A feature module is a self-contained vertical slice of one shipped capability.
It owns its API routes, D1 schema, Angular component, Zod schemas, unit tests,
E2E spec, and feature-flag key — all in one place.

The goal is predictable co-location: when something breaks or needs a new
capability, a developer can find every affected file without grepping the whole
repo.

---

## When to Create a Feature Module

**Create one when ALL of:**
- The feature has ≥1 Hono route + ≥1 Angular component.
- The feature has its own D1 tables or KV namespace.
- The feature is gated by a feature flag.
- The feature will receive iterative work across multiple sessions.

**Do NOT create one when:**
- The change is a one-line bugfix or a shared utility.
- The feature has no D1 state (pure UI cosmetic).
- The feature folds into an existing module without adding new routes.

---

## Folder Shape (`libs/features/<slug>/`)

```
libs/features/<slug>/
├── MANIFEST.md          # One-page brief: what, why, flag key, owner, status
├── schema.sql           # D1 migration fragment (lifted from migrations/<NNNN>_*.sql)
├── types.ts             # Shared TypeScript types / Zod schemas (re-exported)
├── api/
│   └── <slug>.ts        # Hono sub-app (imported in src/index.ts via app.route)
├── service/
│   └── <slug>.service.ts # Business logic — D1 reads/writes, external calls
├── ui/
│   └── <slug>.component.ts # Angular standalone component
│   └── <slug>.component.html
│   └── <slug>.component.scss
├── tests/
│   └── <slug>.unit.test.ts   # Jest unit tests for api + service
│   └── <slug>.e2e.spec.ts    # Playwright E2E (happy-path + adversarial)
└── docs/
    └── README.md        # User-facing feature doc (changelog-ready)
```

**Key rules:**
- No file outside `libs/features/<slug>/` should import from it except `src/index.ts`
  (the Hono mount) and `frontend/src/app/app.routes.ts` (the Angular route).
- The Hono sub-app is the only export from `api/<slug>.ts`.
- The Angular component is lazy-loaded via `loadComponent` in the route table.
- `types.ts` may be imported by both sides (backend + frontend) — it must not
  import any Node/CF-only modules.

---

## Hono Pattern

```ts
// libs/features/voice/api/voice.ts
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/services/feature_flags.js';
import { voiceService } from '../service/voice.service.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

export const voiceApp = new Hono<{ Bindings: Env; Variables: Variables }>();

voiceApp.use('*', async (c, next) => {
  if (!await isFlagOn(c.env, 'voice_agent', c.get('userId'), c.get('anonId'))) {
    return c.json({ error: 'feature_not_enabled' }, 404); // 404 not 403 — don't leak existence
  }
  await next();
});

voiceApp.get('/api/voice/numbers', async (c) => {
  // ...
});
```

Mount in `src/index.ts`:
```ts
import { voiceApp } from '../libs/features/voice/api/voice.js';
app.route('/', voiceApp);
```

---

## Angular Pattern

```ts
// libs/features/voice/ui/voice.component.ts
import { Component, inject, signal } from '@angular/core';
import { useFeatureFlag } from '../../shared/feature-flag/use-feature-flag';

@Component({
  selector: 'app-voice',
  standalone: true,
  templateUrl: './voice.component.html',
})
export class VoiceComponent {
  private readonly flagOn = useFeatureFlag('voice_agent');

  // Guard in template: @if (flagOn()) { ... } @else { <app-flag-gate /> }
}
```

Route in `frontend/src/app/app.routes.ts`:
```ts
{
  path: 'admin/voice',
  canActivate: [authGuard],
  loadComponent: () =>
    import('../../../libs/features/voice/ui/voice.component')
      .then(m => m.VoiceComponent),
}
```

---

## React Small-Site Pattern (future projects)

For generated customer sites (Vite + React + Tailwind), the pattern is simpler
because there is no admin shell:

```
libs/features/<slug>/
├── MANIFEST.md
├── schema.sql
├── api/<slug>.ts     # Same Hono sub-app pattern
├── service/<slug>.service.ts
├── ui/<slug>.tsx     # React functional component
└── tests/<slug>.spec.ts  # Playwright spec
```

The component is imported in the generated site's `App.tsx` and guarded by the
feature-flag hook:

```tsx
// ui/voice.tsx
import { useFeatureFlag } from '@/lib/use-feature-flag';
export function VoiceWidget() {
  const enabled = useFeatureFlag('voice_agent');
  if (!enabled) return null;
  return <div>...</div>;
}
```

---

## Feature Flag Integration

Every module must register its flag. See [[feature-flags]] for the full mandate.

1. Add a row to the active feature-flag migration (`migrations/0500_feature_flags_and_services.sql`
   or a new `migrations/<NNNN>_<slug>_flag.sql`):
   ```sql
   INSERT OR IGNORE INTO feature_flags (id, key, enabled, rollout_percent, stage, description)
   VALUES (lower(hex(randomblob(16))), '<slug>_feature', 0, 0, 'experimental', 'Short description');
   ```
2. Server guard: `isFlagOn(env, '<slug>_feature', userId, anonId)` at the top of the Hono
   sub-app. Return 404 when off.
3. UI gate: `@if (flagOn())` in the Angular template, or `if (!enabled) return null` in React.
4. Register in `/admin/feature-flags` automatically — the UI reads from `GET /api/feature-flags`
   which returns every row in the table.

---

## Existing Modules (Pre-Modularisation Reference)

The following features are already implemented but not yet extracted into `libs/features/`:

| Slug | Hono file(s) | Angular component | Flag key | Priority to extract |
|---|---|---|---|---|
| `voice` | `routes/voice.ts`, `routes/voice_webhooks.ts` | `sections/voice.component.ts` | `voice_agent` | High — complex, many files |
| `inbox` | `routes/inbox.ts` | `sections/inbox.component.ts` | `unified_inbox` | High — fortress specs exist |
| `swarm` | `routes/swarm.ts` | `sections/swarm.component.ts` | `multi_agent_swarm` | High |
| `copilot` | `routes/copilot.ts` | `sections/site-copilot.component.ts` | `multimodal_copilot` | High — no fortress specs |
| `social` | `routes/social.ts`, `routes/social_oauth.ts`, `routes/pulse_analytics.ts` | `sections/social.component.ts` | — | Medium |
| `media` | `routes/media.ts`, `routes/assets.ts` | `sections/media.component.ts` | — | Medium — 14 TDD-RED specs |
| `apps` | `routes/apps.ts` | `sections/apps*.component.ts` | — | Medium |
| `site_dna` | `routes/site_dna.ts` | — (no UI yet) | `site_dna` | High — missing UI |
| `content_freshness` | `routes/content.ts` | `sections/content-freshness.component.ts` | `content_freshness` | Low |
| `pseo` | `routes/pseo.ts` | `sections/pseo.component.ts` | `pseo_matrix` | Low |
| `branches` | `routes/site_branches.ts` | `sections/site-branches.component.ts` | — | Low |
| `marketplace` | `routes/section_marketplace.ts` | `sections/marketplace.component.ts` | `section_marketplace` | Medium |
| `experiments` | `routes/experiments.ts` | — | none (always-on risk) | Medium |
| `domain_stack` | `routes/domain_stack.ts` | `sections/domain-stack.component.ts` | `domain_stack_wizard` | Low |
| `logs` | `routes/logs.ts` | `sections/logs-explorer.component.ts` | `log_explorer` | Low |
| `public_api` | `routes/public_api.ts` | `sections/api-tokens.component.ts` | `public_api_v1` | Low |

---

## Nx Workspace Integration (Phase 4 target)

When the repo migrates to Nx, feature modules become Nx libraries:

```bash
npx nx g @nx/angular:library voice \
  --directory=libs/features/voice \
  --standalone \
  --routing \
  --tags=feature,flagged
```

The `feature` tag enforces that no other `feature:*` lib imports it directly
(enforced by `dependency-cruiser` rules). Only `apps/project-sites/src/index.ts`
and `apps/project-sites/frontend/src/app/app.routes.ts` may import feature libs.

---

## Anti-Patterns

- **Do not** import one feature module from another. Shared logic goes in
  `libs/core/` (db helpers, auth, flag evaluation) or `packages/shared/` (Zod schemas).
- **Do not** add feature routes directly to `src/index.ts` body. Use `app.route('/', featureApp)`.
- **Do not** put Angular components in `frontend/src/app/pages/admin/sections/` for new features.
  Existing ones stay there until extracted; new ones go into `libs/features/<slug>/ui/`.
- **Do not** ship a feature permanently-on at launch. Every non-trivial feature needs a flag row
  at `enabled=0, rollout=0, stage='experimental'` per [[feature-flags]].
