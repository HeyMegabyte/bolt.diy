# container_proxy

Callback endpoints the **build container** hits over the public worker URL when
outbound handlers aren't available: upload a file to R2, run a parameterized D1
query, and fetch the container build-server bootstrap script. **Machine-to-machine
+ core, un-gated** (no feature flag) — a route-organization module extracted
VERBATIM from the `search.ts` monolith (route-decomposition installment 22).

## Routes (`handlers.ts` → `containerProxy`, mounted at `app.route('/', containerProxy)`)

| Method | Path                     | Auth             |
| ------ | ------------------------ | ---------------- |
| PUT    | `/api/container-upload/*`| container-secret |
| POST   | `/api/container-query`   | container-secret |
| GET    | `/api/container-script`  | public           |

## Boundaries

- `upload` + `query` are authenticated by a **shared secret**
  (`x-container-secret` === first 16 chars of `ANTHROPIC_API_KEY`) via the
  `containerAuthorized` guard — NOT an org session. The guard's `!!expected`
  check is a deliberate **auth-bypass fix** (a header-less request with an unset
  `ANTHROPIC_API_KEY` must not compare `undefined === undefined`); preserved
  byte-for-byte, do not weaken it.
- `upload` rejects path traversal (`key.includes('..')`); `query` runs only a
  caller-supplied parameterized statement (the container is trusted via the
  secret). `script` is a public R2 read of the build-server bootstrap.
- The exclusive `timingSafeEqual` dependency (from `@project-sites/shared`) moved
  here with `containerAuthorized` and left `search.ts`. No `schemas.ts`, no
  `onError` (routes return explicit JSON; throws bubble to the app handler),
  matching the original.
