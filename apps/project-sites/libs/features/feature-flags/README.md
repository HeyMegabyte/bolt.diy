# feature-flags — Feature Flags Admin (core surface)

Admin UI for toggling flags, setting rollout %, promoting stages, and managing overrides.

- **Flag key**: `__core__` (sentinel — always enabled)
- **Lifecycle**: `stable`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/features/all-endpoints.spec.ts`
- `e2e/_fortress/feature-flags/` — adversarial attack surface
