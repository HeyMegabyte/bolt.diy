# Features Requiring Real-Browser Testing — Complete 500+ Inventory

Every feature requires an authenticated Playwright E2E spec that:
1. Signs in via `signInAsTestUser` (or real E2E_API_KEY when available)
2. Navigates to feature via UI clicks
3. Asserts content renders (not skeleton, not blank, no "not enabled")
4. Asserts zero console errors (excluding known third-party)
5. Exercises interactive elements (clicks, forms, toggles, dropdowns)
6. Runs axe-core at 6 breakpoints (375/390/768/1024/1280/1920)

Status legend: [ ] = untested · [x] = tested+GREEN · [~] = partially tested · [F] = broken/regression

---

## 1. Auth Surface (18 scenarios)

### Sign In
- [ ] `/signin` — email+password: fill form → submit → session → redirected to admin
- [ ] `/signin` — email+password: invalid credentials → error toast → stay on signin
- [ ] `/signin` — email+password: empty form → submit button disabled
- [ ] `/signin` — Google OAuth: click button → redirected to Google consent
- [ ] `/signin` — Google OAuth: callback error → friendly error on signin page
- [ ] `/signin` — GitHub OAuth: click button → redirected to GitHub consent
- [ ] `/signin` — GitHub OAuth: callback error → friendly error on signin page
- [ ] `/signin` — Magic link: enter email → API call → success toast → email sent
- [ ] `/signin` — Magic link: invalid email → validation error inline
- [ ] `/signin` — Magic link: click token link → session → redirected to admin
- [ ] `/signin` — Rate limit: rapid submissions → friendly rate-limit message
- [ ] `/signin` — `returnUrl` param: sign in → redirected to original target route

### Sign Up
- [ ] `/auth/sign-up` — name+email+password: submit → account created → signed in
- [ ] `/auth/sign-up` — Google/GitHub OAuth buttons redirect correctly
- [ ] `/auth/sign-up` — duplicate email → validation error

### Session Management
- [ ] `/auth/sessions` — list active sessions with device/browser info
- [ ] `/auth/sessions` — revoke session → session removed from list → other session invalidated
- [ ] Sign out → localStorage cleared → redirected to homepage

---

## 2. Admin Dashboard `/admin` (12 scenarios)

- [ ] Dashboard renders: Getting Started hub visible, no stuck skeleton
- [ ] Dashboard: all section cards render with correct labels + deep links
- [ ] Dashboard: clicking section card navigates to that section
- [ ] Site health widget: renders real metrics or calm "no sites yet" empty state
- [ ] Site health widget: with sites — shows counts (published/draft/error)
- [ ] Upgrade moments strip: shows for free plan, hides for pro plan
- [ ] Upgrade moments strip: dismiss → localStorage flag set → doesn't reappear
- [ ] Site selector dropdown: lists all user sites with names + status badges
- [ ] Site selector: switching sites updates admin context (breadcrumb, editor target)
- [ ] Dashboard: hard refresh → still renders (not blank, not redirect loop)
- [ ] Dashboard: browser back from section → returns to dashboard
- [ ] Dashboard: console.error count = 0 after full load

---

## 3. Admin Editor `/admin/editor` (10 scenarios)

- [ ] Editor: bolt.diy iframe loads and shows WebContainer boot screen
- [ ] Editor: WebContainer boots → file tree populated with project files
- [ ] Editor: PS_BOLT_READY → PS_APP_RUNNING protocol completes
- [ ] Editor: click a file in tree → file content loads in code editor
- [ ] Editor: modify file → save button enabled → save → POST succeeds
- [ ] Editor: preview tab shows live rendered output
- [ ] Editor: terminal tab shows WebContainer terminal
- [ ] Editor: switch site in selector → editor reloads with new site files
- [ ] Editor: iframe survives navigation to other admin sections and back
- [ ] Editor-native: flag-gated, shows "not enabled" when flag off, renders when on

---

## 4. Admin Snapshots `/admin/snapshots` (8 scenarios)

- [ ] Snapshots: list renders with columns (name, date, status)
- [ ] Snapshots: empty state when no snapshots exist ("Create your first snapshot")
- [ ] Snapshots: create snapshot → name input → submit → new row appears
- [ ] Snapshots: restore snapshot → confirm dialog → restore → success toast
- [ ] Snapshots: restore without confirmation → cancelled, no API call
- [ ] Snapshots: delete snapshot → confirm → row removed
- [ ] Snapshots: diff view → select two snapshots → diff renders
- [ ] Snapshots/diff: renders side-by-side comparison with highlighted changes

---

## 5. Admin Analytics `/admin/analytics` (12 scenarios)

- [ ] Analytics Overview: charts render (not blank canvas, not errors)
- [ ] Analytics Overview: date range picker → select range → charts update
- [ ] Analytics Live: real-time events stream in
- [ ] Analytics Live: pause/resume streaming toggle
- [ ] Analytics Social: platform breakdown charts render
- [ ] Analytics Social: best-time-to-post heatmap renders
- [ ] Analytics Social: best-posts table with engagement metrics
- [ ] Analytics: visitor funnel visualization renders
- [ ] Analytics: activation funnel with conversion rates per step
- [ ] Analytics: export CSV button → file downloads with data
- [ ] Analytics: switching between tabs preserves date range selection
- [ ] Analytics: no data state → calm "waiting for first events" message

---

## 6. Admin Forms `/admin/forms` (10 scenarios)

- [ ] Forms: form builder canvas renders
- [ ] Forms: drag field type onto canvas → field appears with config panel
- [ ] Forms: configure field (label, required, placeholder) → preview updates
- [ ] Forms: save form → POST succeeds → form listed
- [ ] Forms: Submissions tab → table renders with submitted data
- [ ] Forms: Submissions: empty state when no submissions
- [ ] Forms: Analytics tab → submission rate chart renders
- [ ] Forms: embed code generation → copy button → clipboard populated
- [ ] Forms: delete form → confirm → removed from list
- [ ] Forms: console.error count = 0 after all interactions

---

## 7. Admin Apps `/admin/apps` — Catalog + Deployment (85 apps × 4 = 340 scenarios)

### Catalog (20 scenarios)
- [ ] Apps Catalog: full grid renders with 85 app cards
- [ ] Apps Catalog: search by name → filtered results update live
- [ ] Apps Catalog: filter by category → only matching apps shown
- [ ] Apps Catalog: filter by "CF Container compatible" → incompatible hidden/marked
- [ ] Apps Catalog: click app card → navigates to detail page
- [ ] Apps Catalog: each card shows name, tagline, category badge, glyph
- [ ] Apps Catalog: scroll loads all entries (no virtual-scroll gaps)
- [ ] Apps Catalog: console.error count = 0
- [ ] Apps Instances: list renders deployed apps with status
- [ ] Apps Instances: empty state when no deployments ("Deploy your first app")
- [ ] Apps Instances: click instance → navigates to instance detail
- [ ] Apps Instances: instance detail shows logs, restart button, delete button
- [ ] Apps Instances: restart instance → confirm → status changes → success toast
- [ ] Apps Instances: delete instance → confirm → removed from list
- [ ] Apps Instances: instance logs stream in real time
- [ ] Apps Detail: renders app description, features list, required env vars
- [ ] Apps Detail: deploy button visible, opens deploy wizard
- [ ] Apps Detail: incompatible apps show "Not compatible with CF Containers" notice
- [ ] Apps Detail: env var form — add key/value pair → validation on required fields
- [ ] Apps Detail: env var form — auto-filled fields (secret, public_url) show placeholder

### Per-App Deploy Tests — CF Container Compatible (priority apps × 3 each)
Each app below gets: (a) detail page renders, (b) deploy wizard validates env vars, (c) deploy flow starts

- [ ] Agent Platform — detail/deploy/env
- [ ] AI — detail/deploy/env
- [ ] AI Marketing — detail/deploy/env
- [ ] AI Ops — detail/deploy/env
- [ ] AI Search — detail/deploy/env
- [ ] Analytics — detail/deploy/env
- [ ] Anything LLM — detail/deploy/env
- [ ] Appsmith — detail/deploy/env
- [ ] Audiobookshelf — detail/deploy/env
- [ ] Backend — detail/deploy/env
- [ ] Bookstack — detail/deploy/env
- [ ] Cal — detail/deploy/env
- [ ] ChromaDB — detail/deploy/env
- [ ] Code Server — detail/deploy/env
- [ ] ComfyUI — detail/deploy/env
- [ ] Communication — detail/deploy/env
- [ ] Coqui TTS — detail/deploy/env
- [ ] Developer — detail/deploy/env
- [ ] Directus — detail/deploy/env
- [ ] Drone — detail/deploy/env
- [ ] Farfalle — detail/deploy/env
- [ ] Flowise — detail/deploy/env
- [ ] Focalboard — detail/deploy/env
- [ ] Fooocus — detail/deploy/env
- [ ] Forgejo — detail/deploy/env
- [ ] FreshRSS — detail/deploy/env
- [ ] Ghost — detail/deploy/env
- [ ] Gitea — detail/deploy/env
- [ ] Grafana — detail/deploy/env
- [ ] Healthchecks — detail/deploy/env
- [ ] Immich — detail/deploy/env
- [ ] InvokeAI — detail/deploy/env
- [ ] Jellyfin — detail/deploy/env
- [ ] Karakeep — detail/deploy/env
- [ ] Khoj — detail/deploy/env
- [ ] Knowledge — detail/deploy/env
- [ ] Langflow — detail/deploy/env
- [ ] Langfuse — detail/deploy/env
- [ ] LibreChat — detail/deploy/env
- [ ] Linkwarden — detail/deploy/env
- [ ] Listmonk — detail/deploy/env
- [ ] LiteLLM — detail/deploy/env
- [ ] Lobe Chat — detail/deploy/env
- [ ] Marketing — detail/deploy/env
- [ ] Matomo — detail/deploy/env
- [ ] Mattermost — detail/deploy/env
- [ ] Mautic — detail/deploy/env
- [ ] Media — detail/deploy/env
- [ ] Media AI — detail/deploy/env
- [ ] Memos — detail/deploy/env
- [ ] Miniflux — detail/deploy/env
- [ ] Monitoring — detail/deploy/env
- [ ] Morphic — detail/deploy/env
- [ ] Navidrome — detail/deploy/env
- [ ] NextChat — detail/deploy/env
- [ ] Nextcloud — detail/deploy/env
- [ ] NocoDB — detail/deploy/env
- [ ] Open WebUI — detail/deploy/env
- [ ] Outline — detail/deploy/env
- [ ] Perplexica — detail/deploy/env
- [ ] Phoenix — detail/deploy/env
- [ ] Plane — detail/deploy/env
- [ ] Plausible — detail/deploy/env
- [ ] Pocketbase — detail/deploy/env
- [ ] Postiz — detail/deploy/env
- [ ] Privacy — detail/deploy/env
- [ ] Productivity — detail/deploy/env
- [ ] Qdrant — detail/deploy/env
- [ ] RocketChat — detail/deploy/env
- [ ] SD WebUI — detail/deploy/env
- [ ] SearXNG — detail/deploy/env
- [ ] SillyTavern — detail/deploy/env
- [ ] Stirling PDF — detail/deploy/env
- [ ] Tabby — detail/deploy/env
- [ ] Umami — detail/deploy/env
- [ ] Uptime Kuma — detail/deploy/env
- [ ] Vaultwarden — detail/deploy/env
- [ ] Vector DB — detail/deploy/env
- [ ] Vikunja — detail/deploy/env
- [ ] Voice AI — detail/deploy/env
- [ ] Weaviate — detail/deploy/env
- [ ] Whishper — detail/deploy/env
- [ ] Whisper ASR — detail/deploy/env
- [ ] WikiJS — detail/deploy/env

### CF Container Compatibility Audit (per app)
- [ ] Each app audited: infra deps checked against CF Containers + Neon + Upstash
- [ ] Incompatible apps: marked in catalog with reason (e.g. "needs GPU", "needs persistent volume")
- [ ] Compatible apps: deploy wizard confirms CF Container path
- [ ] Apps with `volume` dep: verified if SQLite on DO covers it or marked incompatible

---

## 8. Admin Site Features `/admin/site-features` (8 scenarios)

- [ ] Site Features: toggle grid renders all site-scoped features
- [ ] Site Features: toggle on → optimistic update → API call → flag changed
- [ ] Site Features: toggle off → confirm dialog for destructive features
- [ ] Site Features: plan-gated features show upgrade prompt (not toggle)
- [ ] Site Features: search/filter by feature name
- [ ] Site Features: category tabs filter correctly
- [ ] Site Features: toggle during API error → reverts to previous state
- [ ] Site Features: console.error count = 0

---

## 9. Admin Social `/admin/social` (10 scenarios)

- [ ] Social: composer renders with text input + media attachment
- [ ] Social: platform selector shows 11 platforms with connect status
- [ ] Social: connect platform → OAuth flow opens → callback → connected badge
- [ ] Social: disconnected platform → "Connect to post" prompt
- [ ] Social: schedule picker → select date/time → schedule button enables
- [ ] Social: schedule post → API call → success toast → appears in queue
- [ ] Social: post queue shows scheduled posts with status badges
- [ ] Social: cancel scheduled post → confirm → removed from queue
- [ ] Social: Analytics tab → per-platform engagement metrics
- [ ] Social: Best Time to Post → heatmap + recommended slots

---

## 10. Admin Logs `/admin/logs` (10 scenarios)

- [ ] Logs: Audit Trail tab → table with timestamp, action, user columns
- [ ] Logs: Audit Trail → filter by action type → table updates
- [ ] Logs: Audit Trail → filter by date range → table updates
- [ ] Logs: Log Explorer tab → search input → query results render
- [ ] Logs: Log Explorer → advanced query syntax → results render
- [ ] Logs: Log Explorer → expand log entry → detail panel shows full JSON
- [ ] Logs: export → CSV downloads with filtered results
- [ ] Logs: empty state → "No logs match your filters"
- [ ] Logs: real-time tail → new logs appear without refresh
- [ ] Logs: console.error count = 0

---

## 11. Admin Feature Flags `/admin/feature-flags` (12 scenarios)

- [ ] Feature Flags: requires sysAdmin — non-operator redirected to `/admin/site-features`
- [ ] Feature Flags: sysAdmin sees full flag list with toggle/rollout/stage
- [ ] Feature Flags: search by key → filtered results
- [ ] Feature Flags: stage filter pills (experimental/beta/stable/deprecated/killswitch)
- [ ] Feature Flags: toggle flag on → optimistic update → audit trail entry
- [ ] Feature Flags: toggle flag off → killswitch if dangerous → confirm dialog
- [ ] Feature Flags: rollout slider → change % → API call → percentage displayed
- [ ] Feature Flags: stage promotion → confirm → stage changes
- [ ] Feature Flags: progressive disclosure Simple/Advanced/Expert → toggle → view changes
- [ ] Feature Flags: dangerous change → confirm dialog with reason input
- [ ] Feature Flags: audit timeline shows recent flag changes
- [ ] Feature Flags: console.error count = 0

---

## 12. Admin Leads `/admin/leads` (6 scenarios)

- [ ] Leads: scan results table renders (sysAdmin only)
- [ ] Leads: scored leads → sort by score → order changes
- [ ] Leads: claim link generation → click → link copied
- [ ] Leads: filter by status (new/contacted/claimed/ignored)
- [ ] Leads: empty state when no scans run
- [ ] Leads: console.error count = 0

---

## 13. Admin System Services `/admin/system-services` (8 scenarios)

- [ ] System Services: registry table renders ALL 14 services
- [ ] System Services: each service shows REAL probed status (not static "planned")
- [ ] System Services: healthy service → green badge with latency
- [ ] System Services: unhealthy service → red badge with error detail
- [ ] System Services: deep-link in service name → opens service URL in new tab
- [ ] System Services: refresh button → re-probes all services
- [ ] System Services: service detail expansion → metadata + config + uptime
- [ ] System Services: console.error count = 0

---

## 14. Admin Docs `/admin/docs` (6 scenarios)

- [ ] Docs: OpenAPI explorer → endpoint list renders
- [ ] Docs: select endpoint → request/response schema visible
- [ ] Docs: Try-It UI → fill params → send → response renders
- [ ] Docs: auth token input → set token → authenticated request works
- [ ] Docs: schema browser → models listed with fields
- [ ] Docs: console.error count = 0

---

## 15. Admin Settings `/admin/settings` (25 scenarios)

### General Tab
- [ ] Settings: General → profile form (name, email) → edit → save → success toast
- [ ] Settings: General → theme toggle (dark/light/system) → app theme changes
- [ ] Settings: General → language dropdown → select → UI language changes
- [ ] Settings: General → save with empty name → validation error

### AI Chat Tab
- [ ] Settings: AI Chat → model selector dropdown → all models listed
- [ ] Settings: AI Chat → system prompt textarea → edit → save
- [ ] Settings: AI Chat → test message input → send → streaming response renders
- [ ] Settings: AI Chat → clear conversation → messages removed

### MCP Tab
- [ ] Settings: MCP → connections list renders with provider + status
- [ ] Settings: MCP → connect new provider → OAuth popup → callback → connected
- [ ] Settings: MCP → paste-key flow: shows paste form for providers without OAuth
- [ ] Settings: MCP → paste API key → save → connection created
- [ ] Settings: MCP → disconnect → confirm → connection removed
- [ ] Settings: MCP → Export .env button: generates valid .env with comments
- [ ] Settings: MCP → Export .env with no vars: shows example .env with commented defaults (NOT error)
- [ ] Settings: MCP → Import .env: file picker → parse → vars populated

### API Tokens Tab
- [ ] Settings: API Tokens → list renders with name, prefix, created date
- [ ] Settings: API Tokens → create new → name input → generate → token shown once
- [ ] Settings: API Tokens → copy token → clipboard populated → "copied" confirmation
- [ ] Settings: API Tokens → revoke token → confirm → removed from list
- [ ] Settings: API Tokens → token list empty state

### Team Tab
- [ ] Settings: Team → members list with roles + status
- [ ] Settings: Team → invite form: email + role → send → pending invite appears
- [ ] Settings: Team → cancel invite → confirm → removed
- [ ] Settings: Team → seat usage counter shows used/total

---

## 16. Admin Domains `/admin/domains` (8 scenarios)

- [ ] Domains: list renders with domain name, status, primary badge
- [ ] Domains: search domains → filtered results
- [ ] Domains: connect custom domain → enter domain → DNS instructions shown
- [ ] Domains: DNS verification → check status → verified/not-verified badge
- [ ] Domains: set primary → confirm → primary badge moves
- [ ] Domains: delete domain → confirm → removed
- [ ] Domains/stack: domain stack wizard renders with step-by-step guide
- [ ] Domains: empty state → "Connect your first domain"

---

## 17. Admin Billing `/admin/billing` (10 scenarios)

- [ ] Billing: current plan + status renders
- [ ] Billing: plan comparison table → feature checkmarks correct per plan
- [ ] Billing: upgrade button → Stripe checkout session → redirect to Stripe
- [ ] Billing: manage billing → Stripe portal link opens
- [ ] Billing: invoice history → table with date, amount, status, download link
- [ ] Billing: wallet balance renders
- [ ] Billing: wallet top-up → amount input → Stripe payment → balance updates
- [ ] Billing: cancel subscription → confirm → status changes to "canceling"
- [ ] Billing: reactivate subscription → confirm → status changes to "active"
- [ ] Billing: console.error count = 0

---

## 18. Admin User Settings `/admin/user` (6 scenarios)

- [ ] User: profile section: avatar, name, email rendered
- [ ] User: edit profile → save → success toast
- [ ] User: API keys section → list personal keys
- [ ] User: notification preferences → toggle email/push/in-app
- [ ] User: language preference → persists across sessions
- [ ] User: delete account → confirm with email input → account deleted

---

## 19. Admin Team `/admin/team` (6 scenarios)

- [ ] Team: members table with name, email, role, joined date
- [ ] Team: change role → dropdown → save → API call → role updated
- [ ] Team: remove member → confirm → removed from list
- [ ] Team: invite member → email + role → send → pending row appears
- [ ] Team: resend invite → click → success toast
- [ ] Team: empty state with invite prompt

---

## 20. Admin Auth Security `/admin/auth-security` (6 scenarios)

- [ ] Auth Security: sign-in metrics cards render (total, today, failures, avg latency)
- [ ] Auth Security: recent activity table with timestamp, email, IP, status
- [ ] Auth Security: anomaly detection → flagged entries highlighted
- [ ] Auth Security: filter by date range → metrics update
- [ ] Auth Security: export audit log → CSV downloads
- [ ] Auth Security: console.error count = 0

---

## 21. Admin Site Detail `/admin/sites/:id` (12 scenarios)

- [ ] Site Detail: Overview tab → name, status badge, URL, created date
- [ ] Site Detail: Logs tab → per-site logs with filters
- [ ] Site Detail: Snapshots tab → per-site snapshots list
- [ ] Site Detail: SQL tab → D1 query editor → type query → results render
- [ ] Site Detail: SQL tab → invalid query → error message with details
- [ ] Site Detail: Integrations tab → connected services list
- [ ] Site Detail: change site name → save → success toast → breadcrumb updates
- [ ] Site Detail: delete site → confirm with slug input → site deleted → redirect
- [ ] Site Detail: readiness badge → shows production-readiness score
- [ ] Site Detail: tab navigation preserves scroll position
- [ ] Site Detail: hard refresh → correct site data loads
- [ ] Site Detail: non-existent site ID → friendly 404 within admin

---

## 22. Admin Site Branches `/admin/sites/:id/branches` (6 scenarios)

- [ ] Branches: list renders with branch name, created date, status
- [ ] Branches: create branch → name input → submit → new row appears
- [ ] Branches: preview branch → opens live URL in new tab
- [ ] Branches: delete branch → confirm → removed
- [ ] Branches: empty state → "Create your first branch"
- [ ] Branches: console.error count = 0

---

## 23. Admin Site Copilot `/admin/sites/:id/copilot` (6 scenarios)

- [ ] Copilot: enable toggle → API call → enabled state
- [ ] Copilot: disable toggle → confirm → disabled state
- [ ] Copilot: session list renders when enabled
- [ ] Copilot: chat interface → send message → AI response streams in
- [ ] Copilot: chat history persists across tab switches
- [ ] Copilot: console.error count = 0

---

## 24. Admin Site DNA `/admin/sites/:id/dna` (4 scenarios)

- [ ] DNA: feedback section renders
- [ ] DNA: preferences form → save → success toast
- [ ] DNA: taste graph visualization renders
- [ ] DNA: console.error count = 0

---

## 25. Marketing Surface (15 scenarios)

- [ ] `/` Homepage: hero section renders with CTA button
- [ ] `/` Homepage: features section with icon cards
- [ ] `/` Homepage: trust strip with logos
- [ ] `/` Homepage: FAQ accordion → click question → answer expands
- [ ] `/` Homepage: footer with nav links + social icons
- [ ] `/pricing`: Monthly/Annual toggle → prices update
- [ ] `/pricing`: CTA buttons link to signup with plan param
- [ ] `/blog`: post list renders with title, excerpt, date, read-more
- [ ] `/blog/:slug`: post detail with title, body, related posts
- [ ] `/search`: business search → type query → results dropdown
- [ ] `/search`: pre-built site search → results grid
- [ ] `/integrations`: filterable integration cards
- [ ] `/developers`: MCP acquisition page with code examples
- [ ] Every marketing route: SEO metadata (title 50-60, meta 120-156, canonical, OG, JSON-LD)
- [ ] Every marketing route: console.error count = 0

---

## 26. API Surface (15 scenarios)

- [ ] `GET /api/health` → 200 with `{ status: "ok" }` + KV/R2/D1 latency
- [ ] `GET /api/health` → response includes security headers (HSTS, CSP, XFO)
- [ ] `GET /api/openapi.json` → valid OpenAPI 3.1 spec, all endpoints listed
- [ ] `GET /api/feature-flags` → 200 with 90 flag entries
- [ ] `GET /api/integrations/health` → all 14 services probed, status per service
- [ ] `GET /api/integrations/:name/health` → single service probe with latency
- [ ] `POST /api/auth/magic-link` → valid email → 200 → email sent
- [ ] `POST /api/auth/magic-link` → invalid email → 400 with validation error
- [ ] `POST /api/auth/magic-link` → rate limit → 429 with retry-after
- [ ] `GET /api/sites` → authenticated → 200 with site list
- [ ] `GET /api/sites` → unauthenticated → 302 to signin
- [ ] `POST /api/webhooks/stripe` → valid signature → 200
- [ ] `POST /api/webhooks/stripe` → invalid signature → 401
- [ ] All API errors → RFC7807 envelope with `code`, `message`, `request_id`
- [ ] API CORS: preflight OPTIONS → correct headers for allowed origins

---

## 27. Platform Services (8 scenarios)

- [ ] `https://mail.projectsites.dev` → Listmonk login page (200)
- [ ] `https://traces.projectsites.dev` → Langfuse UI (200)
- [ ] `https://cms.projectsites.dev` → Payload admin (200)
- [ ] `https://crm.projectsites.dev` → Twenty CRM (200)
- [ ] `https://api.projectsites.dev` → Unkey API (200)
- [ ] `https://events.projectsites.dev` → Inngest UI (200 — until Workflows migration)
- [ ] `https://editor.projectsites.dev` → bolt.diy editor (200)
- [ ] All platform services: CORS + security headers present

---

## 28. Cross-Cutting Concerns (20 scenarios)

- [ ] Cmd+K palette: opens on keyboard shortcut → search input focused
- [ ] Cmd+K palette: type query → results filter → Enter navigates
- [ ] Cmd+K palette: Escape closes → focus returns to previous element
- [ ] `?` shortcuts overlay: lists all keyboard shortcuts correctly
- [ ] `?` shortcuts overlay: clicking shortcut navigates
- [ ] Theme toggle: dark → light → system → persists across reload
- [ ] Theme toggle: all admin sections respect theme
- [ ] Mobile responsive: sidebar collapses to hamburger at < 768px
- [ ] Mobile responsive: all admin sections usable at 375px width
- [ ] Mobile responsive: no horizontal overflow on any page
- [ ] PWA: manifest.json served with correct icons
- [ ] PWA: service worker registers → offline.html served when offline
- [ ] PWA: installable (A2HS prompt criteria met)
- [ ] CSP: strict-dynamic + nonce on every page
- [ ] Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- [ ] Console errors: ZERO on every authenticated admin page
- [ ] Console errors: ZERO on every marketing page
- [ ] Axe-core: ZERO violations at 6 breakpoints on every admin page
- [ ] Axe-core: ZERO violations at 6 breakpoints on every marketing page
- [ ] No 404s for internal assets (JS chunks, CSS, fonts, icons) on any page

---

## 29. Full User Journeys — Multi-Step Flows (20 scenarios)

- [ ] Journey: Homepage → Search business → Select → Sign up → Create site → See progress → Visit live site
- [ ] Journey: Sign in → Dashboard → Editor → Modify file → Save → Preview → Publish
- [ ] Journey: Sign in → Domains → Connect domain → Verify DNS → Set primary → Visit custom domain
- [ ] Journey: Sign in → Billing → Upgrade plan → Stripe checkout → Confirm → New features unlocked
- [ ] Journey: Sign in → Snapshots → Create snapshot → Edit site → Restore snapshot → Verify reverted
- [ ] Journey: Sign in → Analytics → Set date range → Export CSV → Verify data
- [ ] Journey: Sign in → Forms → Create form → Embed on site → Submit form → Check submissions
- [ ] Journey: Sign in → Social → Connect platform → Compose post → Schedule → Verify in queue
- [ ] Journey: Sign in → Apps → Browse catalog → Select app → Configure env vars → Deploy → Wait → Instance live → Visit URL
- [ ] Journey: Sign in → Apps → Deploy → Instance logs → Restart → Verify restart → Delete → Verify gone
- [ ] Journey: Sign in → Feature Flags → Toggle flag off → Verify feature hidden → Toggle on → Verify feature shown
- [ ] Journey: Sign in → Settings → MCP → Connect provider → Export .env → Disconnect → Verify removed
- [ ] Journey: Sign in → Team → Invite member → Accept invite (new session) → Member appears → Change role → Remove member
- [ ] Journey: Sign in → API Tokens → Create token → Copy → Use in API call → Revoke → API call fails
- [ ] Journey: Sign in → Site Detail → Branches → Create branch → Preview → Delete branch
- [ ] Journey: Session expires → 401 on action → Redirected to signin → Sign in → Return to original action
- [ ] Journey: Network goes offline → offline banner appears → action queued → back online → retried
- [ ] Journey: Browser back/forward through 5 admin sections → each renders correctly
- [ ] Journey: Open 3 admin tabs simultaneously → each functions independently
- [ ] Journey: Hard refresh on every admin route → each loads correctly without redirect loop

---

## 30. Feature Flag Impact Matrix (15 scenarios)

- [ ] Toggle `core_auth` killswitch → signin returns 404 → toggle back → signin works
- [ ] Toggle `core_billing` off → billing routes return 404 → billing nav hidden
- [ ] Toggle `log_explorer` on → Log Explorer tab visible → toggle off → tab hidden
- [ ] Toggle `better_auth` on → Better Auth routes active → toggle off → legacy auth only
- [ ] Toggle `native_editor` on → Editor-native route accessible → toggle off → 404
- [ ] Toggle `domain_stack_wizard` on → Domain stack tab visible → toggle off → hidden
- [ ] Toggle `email_deliverability_wizard` on → wizard visible → toggle off → hidden
- [ ] Toggle `multimodal_copilot` on → copilot accepts images → toggle off → text-only
- [ ] Toggle `outbound_webhooks` on → webhook CRUD visible → toggle off → hidden
- [ ] Toggle `section_marketplace` on → marketplace section visible → toggle off → hidden
- [ ] Toggle `site_dna_taste_graph` on → DNA graph renders → toggle off → hidden
- [ ] Flag rollout 50% → random user assignment works (seeded hash)
- [ ] Flag override: per-user pin → override takes precedence over rollout
- [ ] Flag audit trail: every mutation logged with before/after + actor
- [ ] Flag promotion: experimental → beta → stable → each stage verified

---

## 31. Error State Testing (15 scenarios)

- [ ] D1 down → admin pages show degradation notice, not white screen
- [ ] KV down → feature flag resolution falls back to defaults (safe)
- [ ] R2 down → static assets fail gracefully with retry UI
- [ ] API 401 → auto-redirect to signin with returnUrl
- [ ] API 403 → friendly "you don't have access" with role info
- [ ] API 404 → friendly not-found with "did you mean" suggestion
- [ ] API 500 → error boundary catches, shows recovery UI
- [ ] API timeout → retry button appears → click retry → succeeds
- [ ] Rate limit: 429 response → "too many requests" with countdown
- [ ] Form validation: required fields empty → inline errors, submit disabled
- [ ] Form validation: invalid email format → inline error with example
- [ ] Form validation: password too short → inline error with requirements
- [ ] File upload: too large → error toast with max size
- [ ] File upload: wrong type → error toast with allowed types
- [ ] WebSocket disconnect → auto-reconnect with backoff → status indicator

---

## 32. Edge Cases & Stress (12 scenarios)

- [ ] Rapid navigation: click 10 nav links in 3 seconds → no crashes, correct final route
- [ ] Concurrent site switching: switch site during API call → previous call cancelled
- [ ] Double-click protection: submit button → spinner → second click ignored
- [ ] Very long site name: truncated with ellipsis in nav, full in tooltip
- [ ] Zero-width characters in form input → stripped or rejected
- [ ] XSS attempt in form fields → sanitized, never executed
- [ ] SQL injection in search → parameterized, never executed
- [ ] Emoji in text inputs → stored and displayed correctly
- [ ] Right-to-left text (Arabic/Hebrew) → layout doesn't break
- [ ] Browser zoom 200% → all content still accessible, no overlap
- [ ] `prefers-reduced-motion: reduce` → animations disabled
- [ ] `prefers-color-scheme: dark/light` → theme matches OS preference

---

## 33. Skeleton & Loading States (8 scenarios)

- [ ] Section skeleton: appears during lazy chunk load, disappears on activation
- [ ] Section skeleton: auto-hides after 10s timeout if component never activates
- [ ] Section skeleton: does NOT reappear when switching between already-loaded sections
- [ ] Section skeleton: shows during cold (first) visit, not warm revisit (SWR cache)
- [ ] Data table loading: skeleton rows shown while data fetches
- [ ] Chart loading: skeleton placeholder while chart library loads
- [ ] Form loading: submit button shows spinner during API call
- [ ] App deploy loading: progress bar with status text during deployment

---

## 34. Visual Inspection Checklist (every admin section, every breakpoint)

For EACH of the 56 admin section components, verify at 6 breakpoints:

- [ ] Layout: no overlapping elements, no cut-off text, no horizontal scroll
- [ ] Typography: readable font sizes, proper line heights, no orphaned words
- [ ] Colors: brand tokens used (--ps-bg, --ps-ink, --ps-accent), WCAG AA contrast
- [ ] Spacing: consistent padding/margins, no cramped or wasted space
- [ ] Interactive: hover states visible, focus rings present, click targets ≥ 24px
- [ ] Images: no broken images, proper alt text, lazy-loaded below fold
- [ ] Empty states: calm, helpful, with action prompt (not just "No data")
- [ ] Error states: recovery UI visible, correlation ID shown
- [ ] Loading states: skeleton or spinner, never blank white
- [ ] Dark theme: all elements visible, no white-flash on load

---

## Progress Summary

| Category | Total | Tested | Remaining |
|----------|-------|--------|-----------|
| Auth Surface | 18 | 0 | 18 |
| Dashboard | 12 | 0 | 12 |
| Editor | 10 | 0 | 10 |
| Snapshots | 8 | 0 | 8 |
| Analytics | 12 | 0 | 12 |
| Forms | 10 | 0 | 10 |
| Apps (catalog + per-app) | 340 | 0 | 340 |
| Site Features | 8 | 0 | 8 |
| Social | 10 | 0 | 10 |
| Logs | 10 | 0 | 10 |
| Feature Flags | 12 | 0 | 12 |
| Leads | 6 | 0 | 6 |
| System Services | 8 | 0 | 8 |
| Docs | 6 | 0 | 6 |
| Settings | 25 | 0 | 25 |
| Domains | 8 | 0 | 8 |
| Billing | 10 | 0 | 10 |
| User Settings | 6 | 0 | 6 |
| Team | 6 | 0 | 6 |
| Auth Security | 6 | 0 | 6 |
| Site Detail | 12 | 0 | 12 |
| Site Branches | 6 | 0 | 6 |
| Site Copilot | 6 | 0 | 6 |
| Site DNA | 4 | 0 | 4 |
| Marketing | 15 | 0 | 15 |
| API Surface | 15 | 0 | 15 |
| Platform Services | 8 | 0 | 8 |
| Cross-Cutting | 20 | 0 | 20 |
| Full User Journeys | 20 | 0 | 20 |
| Feature Flag Matrix | 15 | 0 | 15 |
| Error States | 15 | 0 | 15 |
| Edge Cases | 12 | 0 | 12 |
| Skeleton & Loading | 8 | 0 | 8 |
| Visual Inspection | 10×56=560 | 0 | 560 |
| Interactive Element Audit | 245 | 0 | 245 |
| **TOTAL** | **~1,659** | **0** | **~1,659** |

---

## 35. Interactive Element Audit — Every Filter, Checkbox, Search, Dropdown (245 scenarios)

### Dashboard
- [ ] Dashboard: site-selector dropdown opens on click, lists all sites, closes on selection
- [ ] Dashboard: site-selector keyboard nav: Arrow down → Enter selects
- [ ] Dashboard: upgrade-strip dismiss button (×) sets localStorage flag, strip hidden on reload
- [ ] Dashboard: every section card clickable → navigates to correct route

### Editor
- [ ] Editor: file-tree search input filters files as you type
- [ ] Editor: file-tree arrow keys navigate, Enter opens file
- [ ] Editor: code editor Tab key inserts spaces (not navigates away)
- [ ] Editor: save button disabled when no changes, enabled after edit
- [ ] Editor: save keyboard shortcut (Cmd+S) triggers save
- [ ] Editor: preview-device dropdown: Desktop/Tablet/Mobile changes viewport

### Snapshots
- [ ] Snapshots: search-by-name input filters table rows in real time
- [ ] Snapshots: date-range picker filters snapshots correctly
- [ ] Snapshots: status filter dropdown (All/Published/Draft/Error) works
- [ ] Snapshots: sort-by column header click toggles asc/desc
- [ ] Snapshots: restore confirm-dialog Cancel button → no action
- [ ] Snapshots: restore confirm-dialog Confirm button → restore proceeds

### Analytics
- [ ] Analytics: date-range preset buttons (7d/30d/90d/custom) switch range
- [ ] Analytics: custom-date picker → calendar popover → select dates → apply
- [ ] Analytics: metric-card hover shows tooltip with explanation
- [ ] Analytics: chart legend click toggles dataset visibility
- [ ] Analytics: chart hover shows data point value tooltip
- [ ] Analytics: tab switcher (Overview/Live/Social) preserves date range
- [ ] Analytics: export dropdown → CSV → file downloads
- [ ] Analytics: export dropdown → PNG → image downloads

### Forms
- [ ] Forms: field-type dropdown lists all field types (text/email/number/select/etc.)
- [ ] Forms: drag field from palette → canvas → drop at position
- [ ] Forms: click field on canvas → config panel opens with properties
- [ ] Forms: required-field checkbox toggles → preview shows asterisk
- [ ] Forms: placeholder-text input → preview updates in real time
- [ ] Forms: delete-field button → confirm → field removed from canvas
- [ ] Forms: form-name input → save → title updated
- [ ] Forms: submissions-table column sort: click header → asc/desc
- [ ] Forms: submissions filter: status dropdown (All/Read/Unread/Spam)
- [ ] Forms: submissions search: type email → matching rows shown

### Apps Catalog
- [ ] Apps: search-by-name input → filters cards as you type (debounced)
- [ ] Apps: category dropdown filter → only matching apps shown
- [ ] Apps: compatibility toggle "CF Container only" → filters incompatible
- [ ] Apps: sort dropdown (Name/Category/Cost) → reorders cards
- [ ] Apps: app-card hover → elevation + border highlight
- [ ] Apps: app-card click → navigates to detail page
- [ ] Apps: pagination: "Load more" button appends next page
- [ ] Apps: detail: back button returns to catalog with filters preserved

### Apps Deploy Wizard
- [ ] Apps deploy: env-var key input validates format (alphanumeric + underscore)
- [ ] Apps deploy: env-var value input → eye toggle shows/hides secret
- [ ] Apps deploy: add-env-var button → new row appears
- [ ] Apps deploy: delete-env-var button → row removed
- [ ] Apps deploy: required env vars marked with red asterisk
- [ ] Apps deploy: auto-filled env vars show placeholder + lock icon
- [ ] Apps deploy: instance-name input validated on blur
- [ ] Apps deploy: deploy button disabled until required fields filled
- [ ] Apps deploy: deploy button shows spinner during deployment
- [ ] Apps deploy: cancel button during deploy → confirm → deploy aborted

### Apps Instances
- [ ] Apps instances: search-by-name input filters instance list
- [ ] Apps instances: status filter (All/Running/Stopped/Error) works
- [ ] Apps instances: restart button → confirm dialog → restart initiated
- [ ] Apps instances: stop button → confirm dialog → instance stopped
- [ ] Apps instances: delete button → confirm with name input → deleted
- [ ] Apps instances: logs tab → auto-scroll toggle on/off
- [ ] Apps instances: logs tab → search-by-keyword filters log lines
- [ ] Apps instances: logs tab → severity filter (All/Info/Warn/Error)
- [ ] Apps instances: logs tab → download-logs button → file downloads

### Site Features
- [ ] Site Features: search-by-name input filters feature toggles
- [ ] Site Features: category filter tabs (All/AI/SEO/Social/Security)
- [ ] Site Features: toggle switch click → optimistic update → API call
- [ ] Site Features: toggle switch keyboard: Space toggles, Enter opens detail
- [ ] Site Features: plan-gated feature → upgrade badge instead of toggle
- [ ] Site Features: feature detail expansion → description + risk notes visible

### Social
- [ ] Social: platform-selector multi-select checkboxes → toggle platforms
- [ ] Social: composer text input expands as content grows
- [ ] Social: character-counter updates in real time
- [ ] Social: media-attach button → file picker → preview thumbnail appears
- [ ] Social: remove-media button (×) → thumbnail removed
- [ ] Social: schedule date-picker → calendar popover → select date/time
- [ ] Social: schedule time-dropdown (15-min increments) → select time
- [ ] Social: schedule timezone dropdown → select → displayed time adjusts
- [ ] Social: post-queue filter: All/Scheduled/Published/Failed tabs
- [ ] Social: post-queue search: type content → matching posts shown

### Logs
- [ ] Logs: Audit Trail search-by-action input filters rows
- [ ] Logs: Audit Trail date-range picker narrows results
- [ ] Logs: Audit Trail user-dropdown filters by user
- [ ] Logs: Audit Trail severity filter (All/Info/Warn/Error)
- [ ] Logs: Log Explorer query input → submit → results render
- [ ] Logs: Log Explorer syntax-highlight toggle on/off
- [ ] Logs: Log Explorer time-range picker (Last 1h/6h/24h/7d/Custom)
- [ ] Logs: log-row click → detail panel expands with full JSON
- [ ] Logs: detail-panel copy-JSON button → clipboard populated
- [ ] Logs: detail-panel close button (×) → panel collapses

### Feature Flags
- [ ] Feature Flags: search-by-key input filters flag list in real time
- [ ] Feature Flags: stage filter pills — clicking toggles active/inactive
- [ ] Feature Flags: multiple stage pills can be active simultaneously
- [ ] Feature Flags: toggle switch click → optimistic update
- [ ] Feature Flags: rollout slider drag → percentage updates
- [ ] Feature Flags: rollout input: type number → validated 0-100
- [ ] Feature Flags: stage-promote dropdown → select stage → confirm
- [ ] Feature Flags: Simple/Advanced/Expert radio buttons → view changes
- [ ] Feature Flags: dangerous-change confirm: reason textarea required
- [ ] Feature Flags: dangerous-change confirm: Cancel button → no mutation
- [ ] Feature Flags: dangerous-change confirm: Confirm button → mutation proceeds
- [ ] Feature Flags: audit-timeline row click → expands change detail

### Leads
- [ ] Leads: search-by-name input filters lead table
- [ ] Leads: score-range slider filters by score
- [ ] Leads: status filter dropdown (All/New/Contacted/Claimed/Ignored)
- [ ] Leads: sort-by column header click → asc/desc
- [ ] Leads: claim-link button → toast "Link copied"
- [ ] Leads: export-CSV button → file downloads with filtered results

### System Services
- [ ] System Services: search-by-name input filters service list
- [ ] System Services: status filter (All/Healthy/Degraded/Down)
- [ ] System Services: service-row click → detail panel expands
- [ ] System Services: detail-panel close button (×) → panel collapses
- [ ] System Services: refresh-all button → all probes re-run
- [ ] System Services: refresh-single button per row → single probe re-runs
- [ ] System Services: sort-by column (Name/Status/Latency/Uptime)

### Docs
- [ ] Docs: endpoint-search input filters endpoint list
- [ ] Docs: method filter (GET/POST/PUT/PATCH/DELETE) toggles
- [ ] Docs: tag filter dropdown → select tag → filtered endpoints
- [ ] Docs: endpoint click → request/response panels expand
- [ ] Docs: Try-It param inputs: fill → type validation on blur
- [ ] Docs: Try-It send button → request fires → response renders
- [ ] Docs: response syntax-highlight toggle

### Settings — General
- [ ] Settings General: name input validated on blur (min 1 char)
- [ ] Settings General: email input validated (email format)
- [ ] Settings General: theme radio buttons (Dark/Light/System) → theme changes
- [ ] Settings General: language dropdown → select → UI language updates
- [ ] Settings General: save button disabled when no changes
- [ ] Settings General: save button enabled after edit → click → success toast
- [ ] Settings General: reset button → confirms → reverts to saved values

### Settings — AI Chat
- [ ] Settings AI Chat: model-selector dropdown → lists all tiered models
- [ ] Settings AI Chat: system-prompt textarea → edit → save button enables
- [ ] Settings AI Chat: temperature slider drag → value updates
- [ ] Settings AI Chat: max-tokens input → validated positive integer
- [ ] Settings AI Chat: test-chat input → type message → Enter sends
- [ ] Settings AI Chat: test-chat streaming response renders token by token
- [ ] Settings AI Chat: clear-chat button → messages removed

### Settings — MCP
- [ ] Settings MCP: provider-search input filters connection list
- [ ] Settings MCP: connect button → OAuth popup or paste-key form
- [ ] Settings MCP: paste-key textarea → type key → save button enables
- [ ] Settings MCP: paste-key cancel → form closes, no connection created
- [ ] Settings MCP: disconnect button → confirm dialog → connection removed
- [ ] Settings MCP: Export .env button → file downloads with valid format
- [ ] Settings MCP: Export .env — empty state → example .env with comments
- [ ] Settings MCP: Import .env button → file picker → vars parsed + populated

### Settings — API Tokens
- [ ] Settings API Tokens: create-token button → name input + generate
- [ ] Settings API Tokens: token-name input validated (min 3 chars)
- [ ] Settings API Tokens: generated token shown once with copy button
- [ ] Settings API Tokens: copy-token button → clipboard populated → "copied"
- [ ] Settings API Tokens: token-list search filters by name
- [ ] Settings API Tokens: revoke button → confirm → token removed
- [ ] Settings API Tokens: no-tokens empty state → "Create your first token"

### Settings — Team
- [ ] Settings Team: member-search input filters member list
- [ ] Settings Team: invite-email input validated (email format)
- [ ] Settings Team: invite-role dropdown (Admin/Member/Viewer) → select
- [ ] Settings Team: send-invite button → disabled until email valid
- [ ] Settings Team: cancel-invite button per row → confirm → removed
- [ ] Settings Team: change-role dropdown per member → select → saved
- [ ] Settings Team: remove-member button → confirm → member removed
- [ ] Settings Team: seat-usage counter updates after add/remove

### Domains
- [ ] Domains: search-by-domain input filters domain list
- [ ] Domains: status filter (All/Active/Pending/Error) tabs
- [ ] Domains: connect-domain input → validated domain format on blur
- [ ] Domains: connect button disabled until valid domain entered
- [ ] Domains: set-primary button → confirm → primary badge moves
- [ ] Domains: delete-domain button → confirm → removed
- [ ] Domains: DNS-record copy button per record type → clipboard populated
- [ ] Domains: verify-DNS button → status refreshes

### Billing
- [ ] Billing: plan selector (Monthly/Annual) toggle → prices update
- [ ] Billing: plan-card hover → elevation + border highlight
- [ ] Billing: upgrade button per plan → Stripe checkout redirect
- [ ] Billing: current-plan badge visible on active plan
- [ ] Billing: invoice-row click → expands invoice detail
- [ ] Billing: invoice-download button → PDF downloads
- [ ] Billing: wallet-top-up amount input → validated positive number
- [ ] Billing: wallet-top-up preset buttons ($10/$25/$50/$100) → fill amount
- [ ] Billing: cancel-subscription button → confirm → status changes
- [ ] Billing: reactivate-subscription button → confirm → status changes

### Site Detail
- [ ] Site Detail: tab switcher (Overview/Logs/Snapshots/SQL/Integrations) works
- [ ] Site Detail: site-name inline edit → click → input → save → updated
- [ ] Site Detail: status-badge dropdown → change status → confirm
- [ ] Site Detail: delete-site button → confirm with slug input → deleted
- [ ] Site Detail: SQL editor → type query → Ctrl+Enter executes
- [ ] Site Detail: SQL results table → column sort by clicking header
- [ ] Site Detail: SQL results export-CSV button → file downloads
- [ ] Site Detail: integrations toggle per service → connect/disconnect

### Site Branches
- [ ] Branches: create-branch name input → validated on blur
- [ ] Branches: create button disabled until name valid
- [ ] Branches: preview button → opens branch URL in new tab
- [ ] Branches: delete button → confirm → branch removed

### Site Copilot
- [ ] Copilot: enable toggle → switch → API call → status updates
- [ ] Copilot: chat input → type message → Enter sends
- [ ] Copilot: chat message bubbles render with user/AI labels
- [ ] Copilot: code-block in response → syntax highlighted + copy button
- [ ] Copilot: session-list click → switches active session

### Site DNA
- [ ] DNA: preference toggles → click → saved optimistically
- [ ] DNA: feedback textarea → type → submit button enables
- [ ] DNA: taste-graph node hover → tooltip with explanation

### Cross-Cutting Interactive Elements
- [ ] Cmd+K: input focused on open, Escape closes, arrow keys navigate results
- [ ] Cmd+K: type partial match → fuzzy-filters results, Enter navigates
- [ ] Global: toast close button (×) dismisses toast
- [ ] Global: toast action button ("Retry"/"Undo") → triggers action
- [ ] Global: notification-bell click → popover opens with notification list
- [ ] Global: notification-bell badge count matches unread count
- [ ] Global: notification-item click → marks read + navigates
- [ ] Global: sidebar nav link hover → tooltip with section name
- [ ] Global: sidebar collapse toggle → sidebar width changes
- [ ] Global: sidebar nav: keyboard Tab through links, Enter activates
- [ ] Global: breadcrumb click → navigates to that level
- [ ] Global: mobile hamburger menu → click → sidebar overlay opens
- [ ] Global: mobile overlay backdrop click → sidebar closes
- [ ] Global: theme toggle in header → cycles dark/light/system
- [ ] Global: drag-drop zone → file dragged over → drop-zone highlight

---

## 35. Micro-Interaction Additions (Pass-2 full-repo scan, 2026-07-30)

Interactive micro-features found in component code but previously missing from this inventory.

### Site Detail (additions)
- [ ] Site Detail: tab switch preserves in-tab state (no loss on return)
- [ ] Site Detail: SQL console query results paginate
- [ ] Site Detail: log stream WS disconnect → reconnect with backoff, no stale-data illusion
- [ ] Site Detail: snapshot rollback → confirmation dialog before destructive action
- [ ] Site Detail: integrations disconnect flow → confirm → row updates

### Media Library (additions)
- [ ] Media: upload progress bar advances during upload
- [ ] Media: image preview on hover
- [ ] Media: bulk delete → modal confirm → rows removed
- [ ] Media: filter by kind/source narrows grid
- [ ] Media: failed upload → retry affordance works (Uppy retry)

### Settings (additions)
- [ ] Settings: MCP credential paste-key fallback form renders when OAuth unconfigured
- [ ] Settings: per-field validation messages inline
- [ ] Settings: save → inline success confirmation
- [ ] Settings: active tab persists across reload
- [ ] Settings: secure copy-to-clipboard shows feedback

### Forms (additions)
- [ ] Forms: submissions auto-poll pauses when tab hidden, resumes on focus
- [ ] Forms: AI prompt improvement modal opens + returns suggestion
- [ ] Forms: MCP pill toggle flips per-provider on/off state
- [ ] Forms: submission detail modal renders AI log tree

### Analytics (additions)
- [ ] Analytics: live-stream pause/resume toggle
- [ ] Analytics: date-range persists across tab switches
- [ ] Analytics: funnel step drill-down opens detail
- [ ] Analytics: export-to-CSV → success toast

### Domains (additions)
- [ ] Domains: availability check debounces (no request per keystroke)
- [ ] Domains: stack wizard progress saves + resumes after navigation away
- [ ] Domains: DNS record copy-to-clipboard
- [ ] Domains: SSL renewal countdown badge renders

### Feature Flags (additions)
- [ ] Flags: stage-promotion → confirmation before apply
- [ ] Flags: rollout slider accepts precise 0-100 input
- [ ] Flags: killswitch red-zone UX distinct from normal disable
- [ ] Flags: override scope picker (user/role/email) selects + applies
- [ ] Flags: audit log entry expands to full context

### API Tokens (additions)
- [ ] Tokens: one-time reveal modal shows token exactly once
- [ ] Tokens: copy-to-clipboard with expiry note
- [ ] Tokens: revocation → confirmation → row updates
- [ ] Tokens: revealed token auto-hides after ~30s

## 36. Zero-Spec Sections (Pass-2 scan — no spec file exists at all)

- [ ] System Services (`/admin/system-services`) — registry renders, REAL probed status, deep-links (wave-2 spec in flight)
- [ ] Site Branches (`/admin/sites/:id/branches`) — stub component; needs real UI + spec
- [ ] Site MCP Server (`/admin/sites/:id/mcp`) — stub component; needs real UI + spec
- [ ] Site Copilot (`/admin/sites/:id/copilot`) — toggle + intent distribution chart (flag-gated)
- [ ] Site DNA (`/admin/sites/:id/dna`) — taste-graph render + preference toggles
- [ ] Swarm (`/admin/swarm`) — board auto-save + conflict resolution
- [ ] Super Admin (`/admin/super-admin`) — sysAdmin-gated views
- [ ] Accept Invite (`/admin/accept-invite`) — full onboarding acceptance flow
- [ ] Wait (`/admin/wait`) — build progress real-time updates

## 37. Backend High-Risk Endpoints Without E2E (Pass-2 scan)

Request-level specs (Playwright `request` fixture) where no UI reaches them; journey specs where UI exists.

- [ ] `POST /api/ai-actions/payment-command` (+ refund, status, methods, customers) — dry-run→confirm→charge safety gates
- [ ] `POST /api/billing/checkout` + `POST /api/billing/embedded-checkout` — session created, no duplicate charge
- [ ] `POST /api/auth/magic-link` + `GET /api/auth/magic-link/verify` — token single-use + expiry
- [ ] `POST /api/sites/:id/publish-bolt` — publish path integrity
- [ ] `GET /api/sites/:id/export` — ZIP completeness (code_export flag)
- [ ] `POST /webhooks/stripe` — signature verify + idempotent replay
- [ ] `POST /api/sites/:id/reset` — rebuild without data loss
- [ ] `DELETE /api/sites/:id` — cleanup completeness (R2/D1/KV)
- [ ] `POST /api/mcp/:provider/callback` — state/PKCE verification
- [ ] `GET /api/auth/me` + logout — session lifecycle
- [ ] Zero-coverage route families: mcp-site · collab · browser-service · jobs · voice webhooks · livekit-webhooks · integrations/health · seo-autopilot · email-deliverability · ses webhooks · ai-endpoints-public · domain-stack · review-links · site-dna · pseo-matrix-v2 · storefront · wallet · experiments · templates · agentic-commerce · concierge · podcast-studio
