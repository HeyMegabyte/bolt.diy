/**
 * `@org/feature-billing` — admin billing surface.
 *
 * Routes: `/dashboard/billing`, `/dashboard/billing/receipts`,
 * `/dashboard/billing/connect`. Pricing per BILLING.md ($50/mo base +
 * 100k included reqs + $0.001/req overage, 12% take-rate, 1.5% Connect
 * fee).
 */
export * from './lib/billing-page/billing-page.component';
export * from './lib/upgrade-dialog/upgrade-dialog.component';
export * from './lib/connect-onboarding/connect-onboarding.component';
export * from './lib/refund-request/refund-request.component';
export * from './lib/receipts-page/receipts-page.component';
export * from './lib/feature-billing.routes';
