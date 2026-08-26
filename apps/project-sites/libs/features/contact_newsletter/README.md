# contact_newsletter

Public form-ingest endpoints that generated sites POST to: the **contact form**
(persist a lead to `contacts` + `form_submissions`, deliver to the owner via
SES→SendGrid→Resend + an in-app bell) and the **newsletter double-opt-in
subscribe** (feeds `newsletter_subscribers`). **Core, un-gated** routes (no
feature flag) — a route-organization module extracted VERBATIM from the
`search.ts` monolith (route-decomposition installment 23).

## Routes (`handlers.ts` → `contactNewsletter`, mounted at `app.route('/', contactNewsletter)`)

| Method | Path                        | Auth   |
| ------ | --------------------------- | ------ |
| POST   | `/api/contact-form/:slug`   | public |
| POST   | `/api/newsletter/subscribe` | public |

## Boundaries

- Both are public + guest-reachable and Zod-validated (`contactFormSchema` /
  `newsletterSubscribeSchema`). Both are **persist-first + error-checked**: the
  lead/subscriber is written durably BEFORE best-effort delivery, so a provider
  failure never becomes a lying-success and never loses the record. The contact
  visitor's `200` stands even if email/bell delivery fails.
- Contact-form escapes every untrusted field (`escapeHtml`) before HTML
  interpolation. Owner delivery walks the **SES → SendGrid → Resend** chain
  (Resend/SendGrid are intentional live fallbacks behind SES per ADR-0019, NOT
  the removed integration) — preserved byte-for-byte.
- The exclusive `contactFormSchema` + `escapeHtml` + `getEmailProvider` deps all
  moved here from search.ts (none remain used there).
  No `onError` (handlers return explicit JSON / catch to 500), matching the
  original.
