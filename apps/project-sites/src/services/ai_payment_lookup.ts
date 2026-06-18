/**
 * AI payment-command — the constrained READ-ONLY discovery tools.
 *
 * @remarks
 * Before an agent can issue a charge it must resolve a CUSTOMER and a SAVED
 * payment-method reference (a `pm_…`) — never a raw card number. These two tools
 * provide exactly that, and nothing more:
 *
 *  - {@link lookupCustomer} — resolve a Stripe customer by `cus_…` id or email.
 *  - {@link listSavedPaymentMethods} — list a customer's saved cards, returning
 *    ONLY the masked brand / last-4 / expiry Stripe itself surfaces (never a PAN).
 *
 * Both are READ-ONLY: they move no money and write no audit. The Stripe calls
 * are INJECTED ({@link ListPmDeps} / {@link LookupCustomerDeps}) so every guard
 * is unit-provable with no network — mirroring `ai_payment_execute.ts`. The
 * route mounts these behind the same `ai_payment_command` flag + auth gate.
 */
import type { Env } from '../types/env.js';

const CUSTOMER_REF = /^cus_[A-Za-z0-9]+$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A saved card, masked exactly as Stripe returns it (no PAN, ever). */
export interface SavedPaymentMethod {
  readonly id: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly expMonth: number | null;
  readonly expYear: number | null;
}

/** Outcome of {@link listSavedPaymentMethods}. */
export type ListPmOutcome =
  | { ok: true; methods: SavedPaymentMethod[] }
  | { ok: false; code: 'invalid_customer' | 'lookup_failed'; message: string };

/** Injected read seam for {@link listSavedPaymentMethods}. */
export interface ListPmDeps {
  list: (customerRef: string) => Promise<SavedPaymentMethod[]>;
}

/**
 * List a customer's saved payment methods (masked). Read-only — no audit.
 *
 * @param customerRef - A Stripe customer id (`cus_…`).
 * @param deps - Injected Stripe list seam.
 * @returns A {@link ListPmOutcome}; never throws.
 */
export async function listSavedPaymentMethods(
  customerRef: string,
  deps: ListPmDeps,
): Promise<ListPmOutcome> {
  if (!CUSTOMER_REF.test(customerRef)) {
    return {
      ok: false,
      code: 'invalid_customer',
      message: 'A valid Stripe customer id (cus_…) is required.',
    };
  }
  try {
    return { ok: true, methods: await deps.list(customerRef) };
  } catch {
    return {
      ok: false,
      code: 'lookup_failed',
      message: 'Saved payment methods could not be retrieved.',
    };
  }
}

/** A resolved customer (id + the contact fields Stripe returns). */
export interface CustomerMatch {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
}

/** Outcome of {@link lookupCustomer}. */
export type LookupCustomerOutcome =
  | { ok: true; customers: CustomerMatch[] }
  | { ok: false; code: 'invalid_query' | 'lookup_failed'; message: string };

/** Injected read seams for {@link lookupCustomer}. */
export interface LookupCustomerDeps {
  byId: (id: string) => Promise<CustomerMatch | null>;
  byEmail: (email: string) => Promise<CustomerMatch[]>;
}

/**
 * Resolve a customer by `cus_…` id (exact) or email (exact, lower-cased). A
 * non-id/non-email query is refused (`invalid_query`) without any Stripe call.
 *
 * @param query - A `cus_…` id or an email address.
 * @param deps - Injected Stripe read seams.
 * @returns A {@link LookupCustomerOutcome}; never throws. An id with no match is
 *   a successful empty list, NOT an error.
 */
export async function lookupCustomer(
  query: string,
  deps: LookupCustomerDeps,
): Promise<LookupCustomerOutcome> {
  const q = query.trim();
  if (CUSTOMER_REF.test(q)) {
    try {
      const c = await deps.byId(q);
      return { ok: true, customers: c ? [c] : [] };
    } catch {
      return { ok: false, code: 'lookup_failed', message: 'Customer lookup failed.' };
    }
  }
  if (EMAIL.test(q)) {
    try {
      return { ok: true, customers: await deps.byEmail(q.toLowerCase()) };
    } catch {
      return { ok: false, code: 'lookup_failed', message: 'Customer lookup failed.' };
    }
  }
  return {
    ok: false,
    code: 'invalid_query',
    message: 'Provide a Stripe customer id (cus_…) or an email address.',
  };
}

/** Production Stripe seam — list a customer's saved cards (read-only). */
export function stripeListPaymentMethods(env: Env): ListPmDeps['list'] {
  return async (customerRef: string): Promise<SavedPaymentMethod[]> => {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_methods?customer=${encodeURIComponent(customerRef)}&type=card&limit=20`,
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
    );
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number };
      }>;
      error?: { message?: string };
    };
    if (!res.ok || !json.data) throw new Error(json.error?.message ?? `stripe_error_${res.status}`);
    return json.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
    }));
  };
}

/** Production Stripe seam — resolve a customer by id or email (read-only). */
export function stripeLookupCustomer(env: Env): LookupCustomerDeps {
  const auth = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  return {
    byId: async (id: string): Promise<CustomerMatch | null> => {
      const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(id)}`, {
        headers: auth,
      });
      if (res.status === 404) return null;
      const json = (await res.json()) as {
        id?: string;
        email?: string;
        name?: string;
        deleted?: boolean;
        error?: { message?: string };
      };
      if (!res.ok || !json.id) throw new Error(json.error?.message ?? `stripe_error_${res.status}`);
      if (json.deleted) return null;
      return { id: json.id, email: json.email ?? null, name: json.name ?? null };
    },
    byEmail: async (email: string): Promise<CustomerMatch[]> => {
      const res = await fetch(
        `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
        { headers: auth },
      );
      const json = (await res.json()) as {
        data?: Array<{ id: string; email?: string; name?: string }>;
        error?: { message?: string };
      };
      if (!res.ok || !json.data)
        throw new Error(json.error?.message ?? `stripe_error_${res.status}`);
      return json.data.map((c) => ({ id: c.id, email: c.email ?? null, name: c.name ?? null }));
    },
  };
}
