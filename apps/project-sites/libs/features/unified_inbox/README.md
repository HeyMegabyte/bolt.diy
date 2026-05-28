# unified_inbox

Big-bets feature #24 — Unified Visitor Inbox. All inbound visitor contact
channels (forms, live chat, voice, email, SMS) are resolved to a single
visitor identity and surfaced in a 3-pane admin UI.

## What it does

- **Cross-channel identity resolution** — `visitor_identities` table matches
  by email, phone, visitor_id, or anon_id across channels.
- **Conversations + messages** — append-only `messages` table; each
  conversation has `assignee_user_id`, `status`, `sla_deadline`.
- **Channel-native replies** — `POST .../reply` dispatches via the original
  channel (form email via Resend, SMS via Twilio, chat via SSE).
- **AI drafts** — `POST .../draft-with-ai` uses Workers AI Llama to suggest
  a reply based on conversation context.
- **3-pane admin** — `/admin/inbox`: list (left) + thread (center) + controls
  (right). Rolling-counter stats, appReveal sections, keyboard nav.

## Where surfaces live

| Surface | Path |
|---------|------|
| Worker routes | `src/routes/inbox.ts` |
| Inbox service | `src/services/inbox.ts` |
| Identity resolver | `src/services/visitor_identity.ts` |
| D1 migration | `migrations/0511_inbox.sql` (visitor_identities, conversations, messages) |
| Angular component | `frontend/src/app/pages/admin/sections/inbox.component.ts` |

## Flag key

`unified_inbox` — default off. Companion feature: `multimodal_copilot` (#25).

## Tests

| Suite | Count | Files |
|-------|-------|-------|
| E2E | 12 tests | `e2e/inbox/inbox.spec.ts` |
| E2E fortress happy | 7 tests | `e2e/_fortress/inbox/happy-path.spec.ts` |
| E2E fortress adversarial | 8 tests | `e2e/_fortress/inbox/adversarial.spec.ts` |
| Unit | **0** | DRIFT — `src/__tests__/inbox.test.ts` missing |

## Drift notes

- **No unit tests** — needs `src/__tests__/inbox.test.ts` covering
  `resolveOrCreateIdentity`, `listConversations`, `appendMessage`, `draftReplyWithAI`.
- SLA timer logic is not yet enforced — `sla_deadline` is set but no cron
  fires on breach (needs a `scheduled` handler or Workflow alarm).
- Push notifications on new conversation not yet wired.

## SLA behavior

Default SLA = 24 h from first message. Overridable per conversation. No
automated escalation yet (see Drift notes).

## How to enable for testing

```bash
curl -X POST https://projectsites.dev/api/super-admin/feature-flags/unified_inbox/override \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -d '{"org_id":"<your_org>","enabled":1}'
```

## Removal

See `removalNotes` in `feature.manifest.ts`.
