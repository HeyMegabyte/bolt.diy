/**
 * Unit tests for the contacts_core form-submission mapper — the logic that
 * `src/routes/forms.ts` uses to turn a submission into a contact upsert.
 * Covers: email-only, phone extraction + sanitization, name aliases,
 * neither-key → null, and tag/source defaults.
 */

import { formSubmissionToContactInput } from '../mappers.js';
import { UpsertContactSchema } from '../schemas.js';

describe('formSubmissionToContactInput', () => {
  const base = { orgId: 'org1', siteId: 'site1', formName: 'contact' };

  it('maps an email-only submission', () => {
    const out = formSubmissionToContactInput({ ...base, email: 'ada@example.com', fields: {} });
    expect(out).not.toBeNull();
    expect(out!.email).toBe('ada@example.com');
    expect(out!.source).toBe('inbox');
    expect(out!.tags).toEqual(['contact']);
    // Result must satisfy the upsert contract.
    expect(() => UpsertContactSchema.parse(out)).not.toThrow();
  });

  it('extracts name from name/full_name/fullName aliases', () => {
    expect(
      formSubmissionToContactInput({
        ...base,
        email: 'a@b.com',
        fields: { full_name: 'Ada Lovelace' },
      })!.name,
    ).toBe('Ada Lovelace');
    expect(
      formSubmissionToContactInput({ ...base, email: 'a@b.com', fields: { fullName: 'Grace H' } })!
        .name,
    ).toBe('Grace H');
  });

  it('sanitizes a formatted phone so it passes the schema guard', () => {
    const out = formSubmissionToContactInput({
      ...base,
      email: null,
      fields: { phone: '(555) 123-4567' },
    });
    expect(out).not.toBeNull();
    expect(out!.phone).toBe('5551234567');
    expect(() => UpsertContactSchema.parse(out)).not.toThrow();
  });

  it('returns null when neither email nor phone is present', () => {
    expect(formSubmissionToContactInput({ ...base, fields: { message: 'hi there' } })).toBeNull();
    expect(formSubmissionToContactInput({ ...base, email: '   ', fields: {} })).toBeNull();
  });

  it('never reads org from the body — org/site come from args', () => {
    const out = formSubmissionToContactInput({
      ...base,
      email: 'a@b.com',
      fields: { orgId: 'EVIL', org_id: 'EVIL' },
    });
    expect(out!.orgId).toBe('org1');
    expect(out!.siteId).toBe('site1');
  });
});
