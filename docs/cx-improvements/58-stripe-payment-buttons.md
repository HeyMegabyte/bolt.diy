# CX Improvement #58 — Stripe Payment Buttons (Inline Checkout on Customer Sites)

> **Goal:** Let site-owners sell directly. Owner connects Stripe via Connect (already shipped),
> creates products in `/admin/products`, drops `<a class="ps-buy-button">` on their public site.
> Visitors click → Stripe Checkout opens in a new tab → webhook records the order.

---

## 50 Sub-Ideas

### P0 — Ship this batch (top 8)
1. D1 schema `site_products` + `site_orders` (price_cents, currency, image_url, FK to sites).
2. `POST /api/sites/:siteId/products` — create product + sync to Stripe under connected acct.
3. `GET /api/sites/:siteId/products` — list with order counts.
4. `PATCH /api/sites/:siteId/products/:id` — edit name/price/image; updates Stripe price (price-creation pattern, archive old).
5. `DELETE /api/sites/:siteId/products/:id` — soft delete + archive Stripe product.
6. `POST /api/sites/:slug/checkout` — public endpoint; creates Stripe Checkout session under owner's account, applies 1.5% platform fee.
7. Webhook handler extension: `checkout.session.completed` on connected accounts → upsert `site_orders`.
8. Frontend `/admin/products` Angular component: list + create modal + edit + delete + orders panel.

### P1 — Next sprint
9. Multi-currency support per product (USD, EUR, GBP, CAD).
10. Inventory tracking (`stock_remaining`, auto-decrement on order).
11. Product variants (size, color) via single SKU + options JSON.
12. Tax collection via Stripe Tax automatic mode.
13. Shipping rates picker (flat, calculated, free over $X).
14. Discount codes / promotion codes minted in Stripe.
15. Bulk product import via CSV upload.
16. Product images stored in R2 with auto-WebP conversion via Sharp.
17. Inline buy button JS embed (no full-page redirect; Stripe Elements modal).
18. Apple Pay / Google Pay enabled by default on Checkout.
19. Subscription products (recurring monthly/yearly).
20. Email receipt customization via Stripe Receipt branding.
21. Refund button in `/admin/orders` row with reason picker.
22. Order export to CSV / QuickBooks / Xero.
23. Customer email opt-in checkbox during checkout (newsletter signup).
24. Product page deep-link `/p/:productId` rendered server-side on owner's site.
25. Abandoned-cart recovery: scheduled cron emails Checkout-session timed-out customers.

### P2 — Future polish
26. Print-on-demand integration (Printful / Printify).
27. Digital downloads (R2-signed URL delivered post-payment).
28. Affiliate links per product with revenue split.
29. Bundle discounts (buy 2, get 10% off).
30. Gift cards as Stripe products with code generation.
31. Loyalty points (1 pt per $ spent, redeem for discount).
32. Wishlists per visitor email.
33. Product reviews with photo upload, moderated in `/admin/reviews`.
34. Cross-sells: "Customers also bought" computed from `site_orders` history.
35. Upsells in Checkout via Stripe Checkout `after_completion`.
36. Inventory alerts via email + SMS when stock < threshold.
37. Reserved stock during checkout (15 min hold).
38. Pre-orders with deposit + balance later.
39. Marketplace mode: multiple sellers on one site, revenue split via Stripe Connect Express.
40. POS mode: in-person sales via Stripe Terminal SDK.
41. Wholesale tier pricing tied to customer groups.
42. Custom checkout fields (gift message, monogram).
43. Multi-language Checkout (auto-detect via Accept-Language).
44. Recurring delivery subscriptions (every 30/60/90 days).
45. AB-test product titles + images via PostHog.
46. AI product description generator from name + image.
47. AI product photo generator (DALL-E) for products without images.
48. AI price suggestion based on industry benchmarks (ties into #65).
49. Sales velocity dashboard with cohort retention.
50. Stripe Atlas integration for new businesses without LLC.

---

## Acceptance Criteria for P0
- [ ] Migration `0026_live_site_features.sql` adds `site_products` + `site_orders` tables.
- [ ] `POST /api/sites/:siteId/products` returns 201 + Stripe product ID + price ID.
- [ ] `POST /api/sites/:slug/checkout` returns valid Stripe Checkout URL (mode=payment, application_fee_amount=1.5%).
- [ ] Webhook handler upserts `site_orders` on `checkout.session.completed`.
- [ ] `/admin/products` lists, creates, edits, deletes products with image upload.
- [ ] Unit tests: 8+ (CRUD, checkout session creation, webhook handling, fee math, FK constraints).
- [ ] E2E: site-owner creates product → buy button on public site → checkout opens → mock webhook → order appears in `/admin/products`.
