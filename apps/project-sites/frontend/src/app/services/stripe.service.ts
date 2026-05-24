/**
 * @module services/stripe
 *
 * @description
 * Lazy-loader and mount-point manager for Stripe.js embedded checkout. Keeps
 * Stripe.js out of the initial bundle — only fetches `js.stripe.com/v3/` when
 * the user actually opens a checkout flow.
 *
 * @remarks
 * - The publishable key is read from `<meta name="x-stripe-pk">` (injected by
 *   the worker per-environment) so the bundle is environment-agnostic.
 * - All errors are surfaced as `null` returns + a `console.warn` — the calling
 *   component decides how to display the failure (toast, inline error, etc.).
 *   Callers MUST handle a `null` return: it means the script load failed or no
 *   publishable key was configured.
 *
 * @example
 * ```ts
 * const checkout = await stripe.mountEmbeddedCheckout(clientSecret, hostEl);
 * if (!checkout) toast.error('Checkout could not load — try again');
 * else this.activeCheckout = checkout;
 * ```
 */

import { Injectable, signal } from '@angular/core';

declare global {
  interface Window {
    Stripe?: (pk: string) => StripeInstance;
  }
}

interface StripeInstance {
  initEmbeddedCheckout(options: { clientSecret: string }): Promise<EmbeddedCheckout>;
}

interface EmbeddedCheckout {
  mount(el: string | HTMLElement): void;
  unmount(): void;
  destroy(): void;
}

@Injectable({ providedIn: 'root' })
export class StripeService {
  private stripe: StripeInstance | null = null;
  private loadPromise: Promise<StripeInstance | null> | null = null;

  /** True while Stripe.js is being fetched or a checkout is being initialized. */
  loading = signal(false);

  /**
   * Read the publishable key from `<meta name="x-stripe-pk">` (server-injected
   * per-env). Returns null when missing so callers can fail soft.
   */
  private getPublishableKey(): string | null {
    const meta = document.querySelector('meta[name="x-stripe-pk"]');
    return meta?.getAttribute('content') || null;
  }

  /**
   * Load Stripe.js (idempotent — concurrent callers share one inflight promise).
   * Caches the instance for the page lifetime.
   *
   * @returns The initialized Stripe instance, or `null` if the script failed
   *   to load or no publishable key was configured.
   */
  async loadStripe(): Promise<StripeInstance | null> {
    if (this.stripe) return this.stripe;
    if (this.loadPromise) return this.loadPromise;

    const pk = this.getPublishableKey();
    if (!pk) {
      console.warn('[StripeService] No Stripe publishable key found in <meta name="x-stripe-pk">');
      return null;
    }

    this.loadPromise = new Promise<StripeInstance | null>((resolve) => {
      if (window.Stripe) {
        this.stripe = window.Stripe(pk);
        resolve(this.stripe);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.onload = () => {
        if (window.Stripe) {
          this.stripe = window.Stripe(pk);
          resolve(this.stripe);
        } else {
          resolve(null);
        }
      };
      script.onerror = () => {
        console.warn('[StripeService] Failed to load Stripe.js');
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  /**
   * Initialize and mount the embedded checkout widget into a DOM container.
   * Toggles {@link loading} for the duration.
   *
   * @param clientSecret - The Stripe Checkout session client_secret returned
   *   by the worker's `/api/billing/embedded-checkout` endpoint.
   * @param container - The host element the widget mounts into.
   * @returns The mounted `EmbeddedCheckout` (caller is responsible for calling
   *   `.destroy()` on unmount), or `null` if anything failed.
   */
  async mountEmbeddedCheckout(
    clientSecret: string,
    container: HTMLElement,
  ): Promise<EmbeddedCheckout | null> {
    this.loading.set(true);
    try {
      const stripe = await this.loadStripe();
      if (!stripe) return null;
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret });
      checkout.mount(container);
      return checkout;
    } catch (err) {
      console.warn('[StripeService] Embedded checkout failed:', err);
      return null;
    } finally {
      this.loading.set(false);
    }
  }
}
