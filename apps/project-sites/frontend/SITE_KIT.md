# Site Kit — the template/generated-site component library

> **Scope (read first):** `storybook.projectsites.dev` hosts the blocks that
> `template.projectsites.dev` composes into **generated tenant sites** — per
> industry. It is **NOT** a showcase of projectsites.dev's own admin/marketing
> components (domain-picker, rolling-counter, admin chrome). Those never belong here.
>
> Source: `src/app/site-kit/<name>/<name>.component.ts` (+ `.stories.ts`). Owned,
> standalone, Tailwind + `--ps-*` design tokens (one-token-source), WCAG AA,
> `prefers-reduced-motion`-safe. Every `@Input` defaulted so stories render bare.

## The 50 (researched across Relume · Tailwind Plus · shadcnblocks · Flowbite · Wix/Squarespace/GoDaddy · ThemeForest)

Status: ✅ built (26) · ⏳ roadmap (24).

### Marketing core (19)
1. ✅ site-navbar — sticky header + nav + CTA
2. ✅ hero-split — headline/CTA + image
3. ✅ hero-centered — full-bleed centered
4. ⏳ hero-bento — asymmetric mosaic hero
5. ✅ logo-cloud — trust-logo marquee
6. ✅ feature-grid — 3-col icon cards
7. ✅ feature-split — alternating text+media
8. ⏳ feature-tabs — tab/accordion feature switcher
9. ✅ stats-band — metric numerals
10. ✅ testimonials-grid — quote cards
11. ✅ pricing-table — 3 tiers + "popular"
12. ⏳ comparison-table — plan/competitor matrix
13. ✅ faq-accordion — native details/summary
14. ✅ cta-band — full-width conversion strip
15. ✅ newsletter-signup — inline email capture
16. ⏳ blog-grid — article teaser cards
17. ⏳ team-grid — headshot + role cards
18. ✅ site-footer — multi-column footer
19. ⏳ announcement-banner — dismissible ribbon

### Conversion + AI-native + SEO (17)
20. ✅ sticky-call-bar — fixed tap-to-call + Book
21. ✅ trust-badges — free-floating SVG badges
22. ✅ before-after-slider — drag reveal
23. ✅ social-proof-toast — recent-activity toast
24. ✅ multi-step-form — wizard lead form
25. ✅ review-card — stars + AggregateRating schema
26. ✅ process-steps — numbered how-it-works
27. ✅ gallery-lightbox — lazy grid + lightbox
28. ⏳ ai-concierge-widget — site-scoped AI chat (Workers AI + DO)
29. ⏳ ai-faq — FAQPage JSON-LD generated from content
30. ⏳ conversational-qualify — chat-UI lead qualifier
31. ⏳ exit-intent-capture — leave-intent offer
32. ⏳ booking-embed — Calendly/Cal.com inline
33. ⏳ maps-directions — directions deep-link + LocalBusiness hasMap
34. ⏳ urgency-strip — real-availability scarcity (never fabricated)
35. ⏳ personalized-hero — edge geo/UTM hero swap
36. ⏳ quotable-answer-block — speakable schema 2-sentence answer
37. ⏳ localbusiness-card — LocalBusiness JSON-LD trust card
38. ⏳ breadcrumb — BreadcrumbList schema
39. ⏳ cookie-consent — GDPR/CCPA banner
40. ⏳ skip-link — a11y skip-to-content

### Industry-specialized (10)
41. ✅ menu-board — restaurant dish cards (price + dietary tags)
42. ✅ service-area-map — contractor coverage zones
43. ✅ provider-bio — clinic/law credentials + Person schema
44. ✅ pricing-tiers — membership / giving levels
45. ✅ listings-grid — real-estate/auto property cards
46. ⏳ reservation-widget — restaurant table booking
47. ⏳ hours-banner — open/close + holiday alert
48. ⏳ practice-areas-grid — law-firm areas → SEO subpages
49. ⏳ quote-estimator — contractor step-form price range
50. ⏳ donation-block — nonprofit inline giving + impact counters

## How it feeds the pipeline
storybook (design in isolation) → template.projectsites.dev (per-industry assembly)
→ projectsites.dev generator (composes → finished tenant site). Note: the template
repo is React+shadcn; these Angular blocks are the **canonical design reference** —
mirror them into the React template (same tokens, same structure) until/unless the
template stack converges. CI (`.github/workflows/storybook.yaml`) redeploys on merge.
