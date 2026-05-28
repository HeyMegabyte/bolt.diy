# auth — Authentication (core surface)

Always-on authentication surface: magic-link email, Google OAuth, session management.

- **Flag key**: `__core__` (sentinel — always enabled, never killswitched)
- **Lifecycle**: `stable`
- **Owner**: brian@megabyte.space

## What it does
- Magic-link email sign-in via Resend/SendGrid with 15-minute HMAC tokens
- Google OAuth 2.0 PKCE flow with state stored in `oauth_states` D1 table
- Session creation + renewal with Bearer token in `sessions` table
- `/api/auth/me` returns current user context for the Angular admin

## Routes
- `POST /api/auth/magic-link` — request magic link
- `GET  /api/auth/magic-link/verify?token=` — click-verify + session mint
- `GET  /api/auth/google` — start Google OAuth
- `GET  /api/auth/google/callback` — exchange code → session
- `GET  /api/auth/me` — current user

## Source files
- `src/services/auth.ts` — magic-link token, Google OAuth, session helpers
- `src/routes/api.ts` — auth route handlers
- `src/middleware/auth.ts` — Bearer token → session middleware

## Tests
- `e2e/auth-and-signin.spec.ts` — golden-path signin flows
- `e2e/auth/auth-flows.spec.ts` — expanded auth coverage
- `e2e/_fortress/auth/` — adversarial attack surface

## Known drift
- No TTL cron cleaning up stale `oauth_states` rows
- Magic-link expiry redirects to generic 401 instead of `/signin?expired=1`
