/**
 * DRIFT GUARD (audit-arc "Codify" + "Regression protection" step) for the optional-null
 * class — see [[optional-field-form-sends-null-schema-rejects]], which bit FOUR times:
 * env-vars, contactFormSchema.phone (462165aa), createSiteSchema business fields (9e242102),
 * formSubmissionInputSchema.email/origin_url (0dbd8c42 — a PUBLIC endpoint, proven live).
 *
 * The invariant: every USER-FACING form / create / update schema MUST tolerate `null` on
 * its optional string fields. Forms ubiquitously send `input.value || null` for an empty
 * field, and a bare `z.string().optional()` REJECTS null ("Expected string, received null")
 * → 400s the WHOLE submission, silently losing it. The fix is always `.nullable()` /
 * `.nullish()`; downstream already null-guards (`?? null` / `?? undefined`).
 *
 * This guards ALL known form schemas in ONE place. Adding a new user-facing form / create /
 * update schema? ADD IT to GUARDED below — that is the discipline that closes the class.
 */
import { contactFormSchema } from '../schemas/contact';
import { createSiteSchema, updateSiteSchema } from '../schemas/site';
import { formSubmissionInputSchema } from '../schemas/forms';

interface GuardedSchema {
  name: string;
  schema: { safeParse: (v: unknown) => { success: boolean } };
  /** A minimal, otherwise-VALID payload (all required fields satisfied). */
  base: Record<string, unknown>;
  /** Optional string fields a form may send as `null` — each MUST be tolerated. */
  nullableFields: string[];
}

const GUARDED: GuardedSchema[] = [
  {
    name: 'contactFormSchema',
    schema: contactFormSchema,
    base: { name: 'Test User', email: 'test@example.com', message: 'A perfectly valid message.' },
    nullableFields: ['phone'],
  },
  {
    name: 'createSiteSchema',
    schema: createSiteSchema,
    base: { business_name: 'Test Biz' },
    nullableFields: ['business_phone', 'business_email', 'business_address', 'google_place_id'],
  },
  {
    name: 'updateSiteSchema',
    schema: updateSiteSchema,
    base: {},
    nullableFields: [
      'business_phone',
      'business_email',
      'business_address',
      'business_website',
      'original_prompt',
      'logo_url',
      'app_icon_url',
      'bolt_chat_id',
      'current_build_version',
    ],
  },
  {
    name: 'formSubmissionInputSchema',
    schema: formSubmissionInputSchema,
    base: { form_name: 'contact', fields: {} },
    nullableFields: ['email', 'origin_url'],
  },
];

describe('form-schema null-tolerance drift guard (optional-null class)', () => {
  for (const g of GUARDED) {
    it(`${g.name} tolerates null on every optional string field`, () => {
      // (1) The base payload alone is valid (fixture sanity).
      expect({ schema: g.name, baseValid: g.schema.safeParse(g.base).success }).toEqual({
        schema: g.name,
        baseValid: true,
      });

      // (2) Each optional field individually set to null still parses — the exact
      //     `input.value || null` a form sends must NOT 400 the whole submission.
      for (const field of g.nullableFields) {
        const acceptsNull = g.schema.safeParse({ ...g.base, [field]: null }).success;
        // Name the field inside the asserted object (this jest lacks 2-arg expect).
        expect({ field: `${g.name}.${field}`, acceptsNull }).toEqual({
          field: `${g.name}.${field}`,
          acceptsNull: true,
        });
      }

      // (3) ALL optional fields null at once still parses (a fully-empty optional form).
      const allNull: Record<string, unknown> = { ...g.base };
      for (const field of g.nullableFields) allNull[field] = null;
      expect({ schema: g.name, allNullValid: g.schema.safeParse(allNull).success }).toEqual({
        schema: g.name,
        allNullValid: true,
      });
    });
  }
});
