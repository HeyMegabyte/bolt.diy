# admin-detail — Admin Site Detail (core surface)

Split-view site detail panel: build status, logs, hostnames, billing, bolt editor.

- **Flag key**: `__core__` (sentinel — always enabled)
- **Lifecycle**: `beta`
- **Owner**: brian@megabyte.space

## Tests
- `e2e/admin-and-billing.spec.ts`
- `e2e/admin-modals.spec.ts`
- `e2e/_fortress/admin-detail/` — adversarial attack surface
