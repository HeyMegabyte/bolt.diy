/**
 * BillingService — wallet + one-click domain purchase facade.
 *
 * @remarks
 * Wraps the wallet/checkout/purchase endpoints owned by sibling agent #101.
 * Exposes a `walletState` signal that auto-refreshes every 60s while at least
 * one consumer is observing (refcount via `start()` / `stop()`). The picker
 * starts polling when its panel opens and stops on close.
 *
 * `purchaseDomain()` returns a discriminated union so callers can branch on
 * the exact failure mode (taken / tld_unsupported / registrar_error /
 * wallet_insufficient / no_wallet) without string-matching error messages.
 *
 * Sibling agent #101 will replace the placeholder HTTP calls with the real
 * ones — this file's surface (signal shape + discriminated-union result)
 * is the contract.
 *
 * @example
 * ```ts
 * const billing = inject(BillingService);
 * billing.start();
 * const result = await billing.purchaseDomain(siteId, 'acme.dev');
 * if (result.kind === 'purchased') toast.success(`${result.domain} is yours.`);
 * ```
 */
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';

/** Wallet account state mirrored from `GET /api/billing/wallet`. */
export interface WalletState {
  has_wallet: boolean;
  /** Current available cents in the wallet. */
  balance_cents: number;
  /** Monthly auto-topup amount in cents. */
  monthly_topup_cents: number;
  /** Last-4 of the default card; `null` when no wallet exists. */
  default_card_last4: string | null;
  /** Convenience flag: wallet exists AND subscription is active. */
  active: boolean;
}

const EMPTY_WALLET: WalletState = {
  active: false,
  balance_cents: 0,
  default_card_last4: null,
  has_wallet: false,
  monthly_topup_cents: 0,
};

/** Discriminated result returned by `purchaseDomain()`. */
export type PurchaseResult =
  | { kind: 'purchased'; domain: string; hostname_id: string | null; charged_cents: number; ssl_status: string }
  | { kind: 'taken' }
  | { kind: 'tld_unsupported'; tld: string; fallback_url: string }
  | { kind: 'registrar_error' }
  | { kind: 'wallet_insufficient'; needed_cents: number; balance_cents: number }
  | { kind: 'no_wallet'; checkout_url: string }
  | { kind: 'unknown_error'; message: string };

/** Sibling #101's `POST /api/billing/checkout/wallet` response shape. */
interface CheckoutResponse {
  data: { checkout_url: string };
}

/** Sibling #101's `POST /api/billing/checkout/topup` response shape. */
interface TopupResponse {
  data: { ok: boolean; charged_cents: number };
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private api = inject(ApiService);

  /** Mutable signal — the wallet state truth. */
  readonly walletState = signal<WalletState>(EMPTY_WALLET);

  /** Convenience computed: caller branches `has_wallet && balance_cents >= price`. */
  readonly hasActiveWallet = computed(() => this.walletState().active);

  private refCount = 0;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Begin auto-refreshing wallet state every 60s. Reference-counted so multiple
   * panels can subscribe without colliding. Fires an immediate refresh on the
   * first observer.
   */
  start(): void {
    this.refCount++;
    if (this.refCount === 1) {
      void this.refreshWallet();
      this.pollHandle = setInterval(() => void this.refreshWallet(), 60_000);
    }
  }

  /** Decrement reference count; stops polling when no observers remain. */
  stop(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0 && this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /** Force-refresh the wallet state on demand (e.g., after a purchase). */
  async refreshWallet(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.api.get<{ data: WalletState }>('/billing/wallet'),
      );
      this.walletState.set(res.data ?? EMPTY_WALLET);
    } catch (err) {
      // No wallet yet (404) → leave state at empty, don't toast.
      console.warn('billing.refreshWallet failed', err);
    }
  }

  /**
   * Create a Stripe Checkout session for the $50/mo wallet subscription.
   * Returns the checkout URL the caller should open in a popup window.
   */
  async startWalletCheckout(): Promise<string> {
    const res = await firstValueFrom(
      this.api.post<CheckoutResponse>('/billing/checkout/wallet', {
        return_url: typeof window !== 'undefined' ? window.location.origin : '',
      }),
    );
    return res.data.checkout_url;
  }

  /** One-time top-up; resolves when the charge clears. */
  async topupWallet(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.api.post<TopupResponse>('/billing/checkout/topup', {}),
      );
      await this.refreshWallet();
      return res.data?.ok === true;
    } catch (err) {
      console.warn('billing.topupWallet failed', err);
      return false;
    }
  }

  /**
   * One-click domain purchase.
   *
   * Branches via discriminated union so the UI can render distinct messaging
   * per failure mode without parsing error strings. On success, wallet state
   * is refreshed before the result resolves.
   */
  async purchaseDomain(
    siteId: string,
    domain: string,
    suggestionId?: string,
  ): Promise<PurchaseResult> {
    interface PurchaseResponseOk {
      data: {
        domain: string;
        hostname_id: string | null;
        charged_cents: number;
        ssl_status: string;
      };
    }
    try {
      const body: { site_id: string; domain: string; suggestion_id?: string } = {
        domain,
        site_id: siteId,
      };
      if (suggestionId) body.suggestion_id = suggestionId;
      const res = await firstValueFrom(
        this.api.post<PurchaseResponseOk>('/domains/purchase', body),
      );
      void this.refreshWallet();
      return {
        charged_cents: res.data.charged_cents,
        domain: res.data.domain,
        hostname_id: res.data.hostname_id,
        kind: 'purchased',
        ssl_status: res.data.ssl_status,
      };
    } catch (err: unknown) {
      const e = err as { error?: { error?: { code?: string; message?: string; fallback_url?: string; checkout_url?: string; needed_cents?: number; balance_cents?: number; tld?: string } } };
      const body = e?.error?.error;
      const code = body?.code ?? '';
      if (code === 'taken' || code === 'domain_taken') return { kind: 'taken' };
      if (code === 'tld_not_supported_by_cf' || code === 'tld_unsupported') {
        return {
          fallback_url: body?.fallback_url ?? `https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`,
          kind: 'tld_unsupported',
          tld: body?.tld ?? domain.split('.').slice(-1)[0],
        };
      }
      if (code === 'wallet_insufficient') {
        return {
          balance_cents: body?.balance_cents ?? 0,
          kind: 'wallet_insufficient',
          needed_cents: body?.needed_cents ?? 0,
        };
      }
      if (code === 'no_wallet' || code === 'wallet_not_found') {
        return {
          checkout_url: body?.checkout_url ?? '',
          kind: 'no_wallet',
        };
      }
      if (code === 'registrar_error' || code === 'registrar_not_configured') {
        return { kind: 'registrar_error' };
      }
      return { kind: 'unknown_error', message: body?.message ?? 'Purchase failed.' };
    }
  }
}
