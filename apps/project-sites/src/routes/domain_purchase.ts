/**
 * @module routes/domain_purchase
 *
 * @description
 * Wallet-charged inline domain purchase + Stripe Link wallet onboarding +
 * one-time top-up + wallet state read.
 *
 * Glues together three sibling workstreams:
 * - #98 RDAP availability + CF Registrar (`rdap_availability.ts`,
 *   `cf_registrar.ts`)
 * - #99 AI domain suggestions backend (provides `suggestion_id`)
 * - #100 Stripe wallet billing (`services/wallet.ts` — chargeWallet,
 *   creditWallet, startSubscription, topUpWallet, getWalletState)
 *
 * Mounted in `index.ts` BEFORE the legacy `api` route so this wallet-aware
 * handler wins at `POST /api/domains/purchase`. The legacy hosted-Stripe
 * checkout route in `api.ts` is preserved as a fall-back when the wallet
 * service binding isn't installed.
 *
 * Routes:
 * - `POST /api/domains/purchase`            Wallet-charged purchase
 * - `POST /api/billing/checkout/wallet`     Stripe Checkout for $50/mo wallet sub
 * - `POST /api/billing/checkout/topup`      One-time PaymentIntent topup
 * - `GET  /api/billing/wallet`              Current wallet snapshot
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { badRequest, unauthorized, notFound } from '@project-sites/shared';
import { dbQueryOne } from '../services/db.js';
import * as auditService from '../services/audit.js';
import * as domainService from '../services/domains.js';
import { checkAvailability } from '../services/rdap_availability.js';
import {
  buildTldPriceMap,
  porkbunFallback,
  registerDomain as cfRegisterDomain,
} from '../services/cf_registrar.js';
import {
  chargeWallet,
  creditWallet,
  getWalletState,
  startWalletSubscription,
  topUpWallet,
  walletAvailable,
  type WalletChargeResult,
  type WalletState,
} from '../services/wallet_adapter.js';

const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';

const domainPurchase = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/domains/purchase ───────────────────────────────────

const purchaseSchema = z.object({
  site_id: z.string().min(1, 'site_id required'),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'invalid domain'),
  suggestion_id: z.string().optional(),
});

/**
 * Wallet-charged inline domain purchase.
 *
 * Steps (single request lifecycle):
 *   a. RDAP availability → 409 if taken
 *   b. CF Registrar TLD lookup → 424 + Porkbun fallback if unsupported
 *   c. wallet.chargeWallet() → 402 + topup_url if insufficient
 *   d. CF Registrar register → on failure, wallet refund + 500
 *   e. domainService.provisionCustomDomain() → CF for SaaS + SSL
 *   f. Audit `domain.purchased`
 *   g. 200 with hostname_id, ssl_status, balance_after, transaction_id
 */
domainPurchase.post(
  '/api/domains/purchase',
  zValidator('json', purchaseSchema),
  async (c) => {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    if (!orgId) throw unauthorized('Must be authenticated');

    const body = c.req.valid('json');
    const domain = body.domain.trim().toLowerCase();
    const siteId = body.site_id.trim();

    // Cross-org guard.
    const site = await dbQueryOne<{ id: string; org_id: string }>(
      c.env.DB,
      'SELECT id, org_id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
      [siteId, orgId],
    );
    if (!site) throw notFound('Site not found');

    // (a) Availability pre-check via RDAP.
    const avail = await checkAvailability(c.env, domain);
    if (avail.status === 'taken') {
      return c.json(
        {
          error: {
            code: 'domain_taken',
            message: `${domain} is already registered`,
            domain,
          },
        },
        409,
      );
    }

    // (b) Price + TLD support via CF Registrar public TLD list.
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    const tldMap = await buildTldPriceMap(c.env);
    const tldRow = tldMap.get(tld);
    if (!tldRow || !tldRow.can_register || !tldRow.registration_price_usd_yr) {
      return c.json(
        {
          error: {
            code: 'tld_not_supported',
            message: `CF Registrar does not carry .${tld}`,
            fallback_url: porkbunFallback(domain),
          },
        },
        424,
      );
    }
    const priceCents = Math.round(tldRow.registration_price_usd_yr * 100);

    // (c) Wallet charge — also handles atomic D1 debit + optional auto-topup.
    if (!walletAvailable(c.env)) {
      // Wallet not yet wired (sibling #100 not deployed). Surface clearly.
      return c.json(
        {
          error: {
            code: 'wallet_not_configured',
            message: 'Wallet billing not configured on this environment.',
            topup_url: '/admin/billing',
          },
        },
        503,
      );
    }

    let charge: WalletChargeResult;
    try {
      charge = await chargeWallet(c.env, orgId, {
        category: 'domain_register',
        quantity: 1,
        base_cost_cents: priceCents,
        reference_type: 'domain',
        reference_id: domain,
        metadata: {
          suggestion_id: body.suggestion_id ?? null,
          source: 'inline_picker',
          site_id: siteId,
        },
      });
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'domain_purchase',
          message: 'wallet charge threw',
          error: String(err),
        }),
      );
      return c.json(
        {
          error: {
            code: 'wallet_error',
            message: 'Wallet charge failed unexpectedly.',
          },
        },
        500,
      );
    }

    if (!charge.ok) {
      if (charge.reason === 'insufficient') {
        return c.json(
          {
            error: {
              code: 'wallet_insufficient',
              message: 'Insufficient wallet balance and no auto-topup payment method.',
              topup_url: '/admin/billing?action=topup',
              current_balance_cents: charge.balance_cents ?? 0,
              required_cents: priceCents,
            },
          },
          402,
        );
      }
      return c.json(
        {
          error: {
            code: 'wallet_error',
            message: charge.message ?? 'Wallet charge failed.',
          },
        },
        500,
      );
    }

    // (d) CF Registrar register — refund on failure.
    const user = userId
      ? await dbQueryOne<{ email: string; name: string | null; phone: string | null }>(
          c.env.DB,
          'SELECT email, name, phone FROM users WHERE id = ? AND deleted_at IS NULL',
          [userId],
        )
      : null;
    const userName = (user?.name || 'Site Owner').trim();
    const nameParts = userName.split(/\s+/);
    const firstName = nameParts[0] || 'Site';
    const lastName = nameParts.slice(1).join(' ') || 'Owner';

    const regResult = await cfRegisterDomain(c.env, {
      domain,
      account_id: ACCOUNT_ID,
      contact: {
        first_name: firstName,
        last_name: lastName,
        email: user?.email || 'hey@projectsites.dev',
        phone: user?.phone || '+1.5555551212',
        organization: 'ProjectSites',
        address: '1 Infinite Loop',
        city: 'Newark',
        state: 'NJ',
        zip: '07102',
        country: 'US',
      },
    });

    if (!regResult.ok) {
      // Refund — never leave the wallet debited for a failed registration.
      let refunded = false;
      try {
        await creditWallet(c.env, orgId, {
          amount_cents: priceCents,
          reason: 'registrar_failure_refund',
          reference_type: 'domain',
          reference_id: domain,
          metadata: {
            original_transaction_id: charge.transaction_id,
            cf_error: regResult.error,
            cf_message: regResult.message,
          },
        });
        refunded = true;
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'error',
            service: 'domain_purchase',
            message: 'refund failed after registrar error',
            error: String(err),
          }),
        );
      }
      return c.json(
        {
          error: {
            code: 'registrar_error',
            message: regResult.message ?? 'Cloudflare Registrar rejected the registration.',
            refunded,
            fallback_url: regResult.fallback_url ?? null,
          },
        },
        500,
      );
    }

    // (e) Auto-bind to site (CF for SaaS custom hostname + SSL).
    let hostnameId: string | null = null;
    let sslStatus: 'pending' | 'failed' = 'pending';
    try {
      await domainService.provisionCustomDomain(c.env.DB, c.env, {
        org_id: orgId,
        site_id: siteId,
        hostname: domain,
      });
      const row = await dbQueryOne<{ id: string }>(
        c.env.DB,
        'SELECT id FROM hostnames WHERE hostname = ? AND deleted_at IS NULL',
        [domain],
      );
      hostnameId = row?.id ?? null;
    } catch (provErr) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'domain_purchase',
          message: 'hostname provisioning failed after register',
          error: String(provErr),
        }),
      );
      sslStatus = 'failed';
    }

    // (f) Audit.
    auditService
      .writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: userId ?? null,
        action: 'domain.purchased',
        message: `Domain '${domain}' purchased via wallet (${(priceCents / 100).toFixed(2)} USD) and bound to site '${siteId}'`,
        target_type: 'domain',
        target_id: siteId,
        metadata_json: {
          domain,
          site_id: siteId,
          hostname_id: hostnameId,
          charged_cents: priceCents,
          balance_after_cents: charge.balance_after_cents ?? null,
          transaction_id: charge.transaction_id,
          suggestion_id: body.suggestion_id ?? null,
          source: 'inline_picker',
          registrar_transaction_id: regResult.transaction_id ?? null,
        },
        request_id: c.get('requestId'),
      })
      .catch(() => {});

    // (g) Success. Wrapped in `{ data }` envelope to match the rest of the
    // API surface — sibling BillingService consumes `res.data.*`.
    return c.json({
      ok: true,
      data: {
        domain,
        hostname_id: hostnameId,
        ssl_status: sslStatus,
        charged_cents: priceCents,
        balance_after_cents: charge.balance_after_cents ?? null,
        transaction_id: charge.transaction_id,
      },
    });
  },
);

// ─── POST /api/billing/checkout/wallet ────────────────────────────

const walletCheckoutSchema = z.object({
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

/**
 * Create a Stripe Checkout Session for the $50/mo wallet subscription
 * with Link enabled and the PM stored off-session for future background
 * charges. Delegates to sibling #100's `wallet.startSubscription()`.
 */
domainPurchase.post(
  '/api/billing/checkout/wallet',
  zValidator('json', walletCheckoutSchema),
  async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) throw unauthorized('Must be authenticated');
    if (!walletAvailable(c.env)) {
      throw badRequest('Wallet billing not configured on this environment');
    }
    const { success_url, cancel_url } = c.req.valid('json');

    const result = await startWalletSubscription(c.env, orgId, {
      success_url,
      cancel_url,
    });
    if (!result.ok) {
      throw badRequest(result.message ?? 'Failed to create wallet checkout session');
    }
    return c.json({ data: { checkout_url: result.checkout_url } });
  },
);

// ─── POST /api/billing/checkout/topup ─────────────────────────────

const topupSchema = z.object({
  amount_cents: z.number().int().min(500).max(50_000),
});

/**
 * One-time PaymentIntent against the stored wallet PM.
 */
domainPurchase.post(
  '/api/billing/checkout/topup',
  zValidator('json', topupSchema),
  async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) throw unauthorized('Must be authenticated');
    if (!walletAvailable(c.env)) {
      throw badRequest('Wallet billing not configured on this environment');
    }
    const { amount_cents } = c.req.valid('json');

    const result = await topUpWallet(c.env, orgId, amount_cents);
    if (!result.ok) {
      throw badRequest(result.message ?? 'Top-up failed');
    }
    return c.json({
      data: {
        ok: true,
        charged_cents: amount_cents,
        state: result.state ?? null,
      },
    });
  },
);

// ─── GET /api/billing/wallet ──────────────────────────────────────

/**
 * Render-ready wallet snapshot for the picker UI.
 */
domainPurchase.get('/api/billing/wallet', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  if (!walletAvailable(c.env)) {
    // Soft-degrade so the UI can show a "wallet not enabled" CTA without
    // throwing — same shape as a fresh org with no subscription.
    const empty: WalletState = {
      balance_cents: 0,
      subscription_status: 'none',
      default_payment_method_brand: null,
      default_payment_method_last4: null,
      last_topup_at: null,
      monthly_credit_remaining_days: null,
      recent_transactions: [],
    };
    // Expose under both the canonical `data` envelope AND the legacy flat
    // shape so the sibling BillingService (which reads `res.data`) keeps
    // working while preserving the typed wallet contract for new callers.
    return c.json({
      data: {
        has_wallet: false,
        monthly_topup_cents: 0,
        default_card_last4: null,
        active: false,
        ...empty,
      },
    });
  }

  const state = await getWalletState(c.env, orgId);
  return c.json({
    data: {
      has_wallet: state.subscription_status !== 'none',
      active: state.subscription_status === 'active',
      monthly_topup_cents: 0,
      default_card_last4: state.default_payment_method_last4,
      ...state,
    },
  });
});

export { domainPurchase };
