# Listmonk appearance — projectsites.dev brand theme

Gorgeous dark cyan/purple brand theme injected into Listmonk via the settings API
(`PUT /api/settings` → `appearance.public.custom_css/js` + `appearance.admin.custom_css`).

**These settings live in the Listmonk Neon DB, not in env/config** — so they're saved
here for reproducibility. If the DB is ever re-seeded, re-apply via the API.

- `public.css` / `public.js` — subscriber-facing pages (subscription form, archive,
  unsubscribe, preferences). Aurora-orb background, glassmorphic card, Sora/Space Grotesk
  fonts, cyan-glow inputs, cyan→purple gradient buttons. Verified live + screenshot-QA'd.
- Admin UI CSS (dark cyan/black brand over Buefy/Bulma) is stored in
  `appearance.admin.custom_css` in the DB (applies on /admin login, behind CF Access).

Brand tokens: bg `#060610`, ink `#f4f4ff`, accent cyan `#00e5ff`, accent purple `#7c3aed`.
