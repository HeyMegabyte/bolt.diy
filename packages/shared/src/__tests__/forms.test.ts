import {
  formSubmissionInputSchema,
  createIntegrationSchema,
  updateIntegrationSchema,
  newsletterProviderSchema,
} from '../schemas/forms.js';

/**
 * Coverage for the generic form-submission + newsletter-integration boundary
 * schemas (forms.ts). These validate untrusted public/API input at the worker
 * edge, so the contract (what passes, what's rejected, what defaults) is
 * locked here. Previously this exported module had zero tests.
 */
describe('formSubmissionInputSchema', () => {
  it('accepts a full valid submission', () => {
    const out = formSubmissionInputSchema.parse({
      form_name: 'contact-us',
      email: 'jane@example.com',
      fields: { subject: 'Hi', count: 3, agree: true, note: null },
      origin_url: 'https://acme.example.com/contact',
    });
    expect(out.form_name).toBe('contact-us');
    expect(out.fields.count).toBe(3);
  });

  it('applies defaults (form_name=default, fields={}) for an empty body', () => {
    const out = formSubmissionInputSchema.parse({});
    expect(out.form_name).toBe('default');
    expect(out.fields).toEqual({});
  });

  it('rejects a form_name with spaces / invalid slug chars', () => {
    expect(formSubmissionInputSchema.safeParse({ form_name: 'not a slug!' }).success).toBe(false);
  });

  it('rejects a form_name longer than 64 chars', () => {
    expect(formSubmissionInputSchema.safeParse({ form_name: 'a'.repeat(65) }).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(formSubmissionInputSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects a non-URL origin_url but accepts any valid URL scheme (origin metadata, not security-gated)', () => {
    expect(formSubmissionInputSchema.safeParse({ origin_url: 'not a url' }).success).toBe(false);
    expect(formSubmissionInputSchema.safeParse({ origin_url: 'https://acme.example.com/p' }).success).toBe(true);
  });

  it('accepts explicit null for email + origin_url (public endpoint — a custom form sending null must not 400 + lose the submission)', () => {
    // The `x.trim() || null` idiom is ubiquitous in custom/3rd-party forms. `.optional()`
    // alone would 400 the WHOLE submission on `email: null`; `.nullish()` accepts it.
    const out = formSubmissionInputSchema.safeParse({
      form_name: 'contact',
      email: null,
      origin_url: null,
      fields: { message: 'hi' },
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.email).toBeNull();
      expect(out.data.origin_url).toBeNull();
    }
  });

  it('rejects an oversized fields payload (> 16KB)', () => {
    const big = { blob: 'x'.repeat(17_000) };
    expect(formSubmissionInputSchema.safeParse({ fields: big }).success).toBe(false);
  });

  it('accepts string/number/boolean/null field values but not nested objects', () => {
    expect(formSubmissionInputSchema.safeParse({ fields: { a: 'x', b: 1, c: false, d: null } }).success).toBe(true);
    expect(formSubmissionInputSchema.safeParse({ fields: { nested: { deep: 1 } } }).success).toBe(false);
  });
});

describe('createIntegrationSchema (.refine provider rules)', () => {
  it('accepts a webhook integration with webhook_url', () => {
    expect(
      createIntegrationSchema.safeParse({ provider: 'webhook', webhook_url: 'https://hook.example.com/x' }).success,
    ).toBe(true);
  });

  it('rejects a webhook integration missing webhook_url', () => {
    expect(createIntegrationSchema.safeParse({ provider: 'webhook', api_key: 'k' }).success).toBe(false);
  });

  it('accepts an api-key provider (mailchimp) with api_key', () => {
    expect(createIntegrationSchema.safeParse({ provider: 'mailchimp', api_key: 'abc', list_id: 'l1' }).success).toBe(
      true,
    );
  });

  it('rejects an api-key provider (mailchimp) missing api_key', () => {
    expect(createIntegrationSchema.safeParse({ provider: 'mailchimp', list_id: 'l1' }).success).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(createIntegrationSchema.safeParse({ provider: 'pigeon', api_key: 'k' }).success).toBe(false);
  });
});

describe('updateIntegrationSchema + newsletterProviderSchema', () => {
  it('updateIntegrationSchema is fully optional (empty body valid)', () => {
    expect(updateIntegrationSchema.safeParse({}).success).toBe(true);
    expect(updateIntegrationSchema.safeParse({ active: false }).success).toBe(true);
  });

  it('newsletterProviderSchema enumerates the supported providers', () => {
    for (const p of ['mailchimp', 'webhook', 'resend', 'sendgrid', 'convertkit', 'klaviyo']) {
      expect(newsletterProviderSchema.safeParse(p).success).toBe(true);
    }
    expect(newsletterProviderSchema.safeParse('aweber').success).toBe(false);
  });
});
