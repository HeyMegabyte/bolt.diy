/**
 * @module libs/features/contacts_core/mappers
 * @description Pure input mappers that turn a capture surface's payload into a
 * {@link UpsertContactInput} (or `null` when there's nothing dedupe-able).
 *
 * Colocated in the core so EVERY consumer (forms, donations, reviews, GBP …)
 * shares one mapping + dedupe-gate rule instead of each re-deriving name/phone
 * extraction. Pure + side-effect-free → trivially unit-testable; the Hono
 * plumbing in `forms.ts` stays thin.
 *
 * @packageDocumentation
 */

import type { ContactSource, UpsertContactInput } from './schemas.js';

/** Trim a value to a non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Map a website form submission to a contact upsert input.
 *
 * @remarks Pulls `name` from `name`/`full_name`/`fullName` and `phone` from
 * `phone`/`tel`/`phone_number`, sanitizing the phone to digits (+ optional
 * leading `+`) so formatted numbers like `(555) 123-4567` pass the schema guard.
 * Returns `null` when neither email nor phone is present — a contact with no
 * dedupe key is not worth storing.
 *
 * @param args.orgId    - Owning org (from auth/site context, never the body).
 * @param args.siteId   - Originating site.
 * @param args.formName - Form name, used as a tag + metadata.
 * @param args.email    - Submitter email if captured.
 * @param args.fields   - Arbitrary submitted field bag.
 * @returns A {@link UpsertContactInput} or `null`.
 * @example
 * ```ts
 * const input = formSubmissionToContactInput({
 *   orgId, siteId, formName: 'contact', email: 'a@b.com', fields: { name: 'Ada' },
 * });
 * if (input) await recordContact(env, input);
 * ```
 */
export function formSubmissionToContactInput(args: {
  orgId: string;
  siteId: string;
  formName: string;
  email?: string | null;
  fields?: Record<string, unknown> | null;
  source?: ContactSource;
}): UpsertContactInput | null {
  const fields = args.fields ?? {};
  const email = str(args.email);
  const name = str(fields.name) ?? str(fields.full_name) ?? str(fields.fullName);
  const phoneRaw = str(fields.phone) ?? str(fields.tel) ?? str(fields.phone_number);
  const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, '') : undefined;

  if (!email && !phone) return null;

  return {
    orgId: args.orgId,
    siteId: args.siteId,
    email,
    phone,
    name,
    source: args.source ?? 'inbox',
    tags: [args.formName],
    metadata: { formName: args.formName },
  };
}
