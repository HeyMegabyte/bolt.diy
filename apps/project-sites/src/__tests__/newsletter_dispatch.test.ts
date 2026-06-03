import {
  dispatchToIntegrations,
  type DispatchSubmission,
  type IntegrationRow,
} from '../services/newsletter_dispatch';
import type { NewsletterProvider } from '@project-sites/shared';

/**
 * Guards the newsletter dispatch fan-out (#forms): per-provider request shaping
 * (mailchimp/sendgrid/convertkit/klaviyo/resend/webhook), recipient/api-key/list
 * gating, per-integration error isolation (one provider failing never aborts the
 * rest), upstream non-2xx capture, empty-list short-circuit, and name-field
 * extraction helpers. `global.fetch` is mocked so zero real APIs are hit.
 */

const originalFetch = global.fetch;
const mockFetch = jest.fn() as unknown as jest.Mock;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

const submission = (over: Partial<DispatchSubmission> = {}): DispatchSubmission => ({
  site_id: 'site-1',
  site_slug: 'acme',
  form_name: 'newsletter',
  email: 'jane@example.com',
  fields: { name: 'Jane Doe' },
  origin_url: 'https://acme.projectsites.dev/',
  ip_address: '203.0.113.7',
  user_agent: 'jest',
  submitted_at: '2026-06-02T00:00:00.000Z',
  ...over,
});

const integration = (
  provider: NewsletterProvider,
  over: Partial<IntegrationRow> = {},
): IntegrationRow => ({
  id: `int-${provider}`,
  site_id: 'site-1',
  provider,
  api_key_encrypted: 'key-us21',
  list_id: 'list-9',
  webhook_url: null,
  config: null,
  ...over,
});

/** Pull the parsed JSON body of the Nth fetch call. */
function bodyOf(callIndex = 0): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function urlOf(callIndex = 0): string {
  return String((mockFetch.mock.calls[callIndex] as [string, RequestInit])[0]);
}

describe('dispatchToIntegrations', () => {
  it('short-circuits with an empty array when there are no integrations', async () => {
    const out = await dispatchToIntegrations(submission(), []);
    expect(out).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('dispatches in parallel to every integration and reports ok results', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('mailchimp'),
      integration('sendgrid'),
      integration('webhook', { webhook_url: 'https://hook.example.com/in' }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.ok && r.error === null)).toBe(true);
    expect(out.map((r) => r.provider)).toEqual(['mailchimp', 'sendgrid', 'webhook']);
    expect(out.map((r) => r.integration_id)).toEqual(['int-mailchimp', 'int-sendgrid', 'int-webhook']);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('isolates a per-integration failure — the rest still succeed', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('boom', { status: 500 })) // mailchimp fails upstream
      .mockResolvedValueOnce(new Response('{}', { status: 200 })); // sendgrid ok
    const out = await dispatchToIntegrations(submission(), [
      integration('mailchimp'),
      integration('sendgrid'),
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toContain('Upstream 500');
    expect(out[0].error).toContain('boom');
    expect(out[1].ok).toBe(true);
  });

  it('captures a thrown (non-Error) rejection as a string error', async () => {
    mockFetch.mockRejectedValueOnce('network exploded');
    const out = await dispatchToIntegrations(submission(), [integration('sendgrid')]);
    expect(out[0]).toMatchObject({ ok: false, error: 'network exploded', provider: 'sendgrid' });
  });
});

describe('mailchimp', () => {
  it('posts subscribed member with merge fields, tags, basic auth, and DC host', async () => {
    await dispatchToIntegrations(submission(), [integration('mailchimp')]);
    expect(urlOf()).toBe('https://us21.api.mailchimp.com/3.0/lists/list-9/members');
    const body = bodyOf();
    expect(body['email_address']).toBe('jane@example.com');
    expect(body['status']).toBe('subscribed');
    expect(body['merge_fields']).toEqual({ FNAME: 'Jane', LNAME: 'Doe' });
    expect(body['tags']).toEqual(['projectsites:acme', 'form:newsletter']);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Basic ${btoa('anystring:key-us21')}`);
  });

  it('fails when the API key lacks a datacenter suffix', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('mailchimp', { api_key_encrypted: 'keyonly' }),
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].error).toContain('datacenter suffix');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails when the integration is missing its list_id', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('mailchimp', { list_id: null }),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('list_id');
  });

  it('fails when the integration is missing its api_key', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('mailchimp', { api_key_encrypted: null }),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('api_key');
  });

  it('fails when the submission has no email', async () => {
    const out = await dispatchToIntegrations(submission({ email: undefined }), [
      integration('mailchimp'),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('requires an email');
  });
});

describe('sendgrid', () => {
  it('PUTs the contact with list_ids and split name', async () => {
    await dispatchToIntegrations(submission(), [integration('sendgrid')]);
    expect(urlOf()).toBe('https://api.sendgrid.com/v3/marketing/contacts');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    const body = bodyOf();
    expect(body['list_ids']).toEqual(['list-9']);
    expect((body['contacts'] as unknown[])[0]).toEqual({
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
    });
  });

  it('sends an empty list_ids array when no list_id is configured', async () => {
    await dispatchToIntegrations(submission(), [integration('sendgrid', { list_id: null })]);
    expect(bodyOf()['list_ids']).toEqual([]);
  });
});

describe('convertkit', () => {
  it('subscribes using config.form_id and the api_key in the body', async () => {
    await dispatchToIntegrations(submission(), [
      integration('convertkit', { config: JSON.stringify({ form_id: 'fk-77' }) }),
    ]);
    expect(urlOf()).toBe('https://api.convertkit.com/v3/forms/fk-77/subscribe');
    const body = bodyOf();
    expect(body['api_key']).toBe('key-us21');
    expect(body['email']).toBe('jane@example.com');
    expect(body['first_name']).toBe('Jane');
    expect(body['fields']).toEqual({ source: 'projectsites:acme:newsletter' });
  });

  it('falls back to list_id when config has no form_id', async () => {
    await dispatchToIntegrations(submission(), [
      integration('convertkit', { list_id: 'lid-from-list', config: null }),
    ]);
    expect(urlOf()).toContain('/forms/lid-from-list/subscribe');
  });

  it('ignores malformed config JSON and still uses list_id', async () => {
    await dispatchToIntegrations(submission(), [
      integration('convertkit', { list_id: 'lid-x', config: 'not-json{' }),
    ]);
    expect(urlOf()).toContain('/forms/lid-x/subscribe');
  });

  it('fails when neither form_id nor list_id resolves', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('convertkit', { list_id: null, config: null }),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('form_id');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('klaviyo', () => {
  it('posts a subscription bulk-create job with the list relationship and revision header', async () => {
    await dispatchToIntegrations(submission(), [integration('klaviyo')]);
    expect(urlOf()).toBe('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Klaviyo-API-Key key-us21');
    expect(headers['revision']).toBe('2024-10-15');
    const body = bodyOf() as { data: { attributes: Record<string, unknown>; relationships: Record<string, unknown> } };
    expect(body.data.attributes['custom_source']).toBe('projectsites:acme:newsletter');
    expect(body.data.relationships).toEqual({ list: { data: { type: 'list', id: 'list-9' } } });
  });

  it('fails without a list_id', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('klaviyo', { list_id: null }),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('list_id');
  });
});

describe('resend', () => {
  it('adds a contact to the audience with split name', async () => {
    await dispatchToIntegrations(submission(), [
      integration('resend', { list_id: 'aud-42' }),
    ]);
    expect(urlOf()).toBe('https://api.resend.com/audiences/aud-42/contacts');
    const body = bodyOf();
    expect(body).toEqual({
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      unsubscribed: false,
    });
  });

  it('fails without an audience (list_id)', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('resend', { list_id: null }),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('list_id');
  });
});

describe('webhook', () => {
  it('posts the full envelope to the configured webhook_url with event headers', async () => {
    await dispatchToIntegrations(submission(), [
      integration('webhook', { webhook_url: 'https://hook.example.com/in' }),
    ]);
    expect(urlOf()).toBe('https://hook.example.com/in');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Projectsites-Event']).toBe('form.submission');
    expect(headers['User-Agent']).toBe('projectsites.dev/forms');
    const body = bodyOf();
    expect(body).toMatchObject({
      event: 'form.submission',
      site_id: 'site-1',
      site_slug: 'acme',
      form_name: 'newsletter',
      email: 'jane@example.com',
      fields: { name: 'Jane Doe' },
      origin_url: 'https://acme.projectsites.dev/',
      submitted_at: '2026-06-02T00:00:00.000Z',
    });
  });

  it('fails when webhook_url is missing', async () => {
    const out = await dispatchToIntegrations(submission(), [
      integration('webhook', { webhook_url: null }),
    ]);
    expect(out[0]).toMatchObject({ ok: false });
    expect(out[0].error).toContain('webhook_url');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('name + merge-field extraction', () => {
  it('prefers explicit first_name / last_name fields over a combined name', async () => {
    await dispatchToIntegrations(
      submission({ fields: { first_name: 'Ada', last_name: 'Lovelace', name: 'Ignored Person' } }),
      [integration('resend', { list_id: 'aud-1' })],
    );
    const body = bodyOf();
    expect(body['first_name']).toBe('Ada');
    expect(body['last_name']).toBe('Lovelace');
  });

  it('falls back to camelCase name aliases', async () => {
    await dispatchToIntegrations(
      submission({ fields: { firstName: 'Grace', lastName: 'Hopper' } }),
      [integration('resend', { list_id: 'aud-1' })],
    );
    const body = bodyOf();
    expect(body['first_name']).toBe('Grace');
    expect(body['last_name']).toBe('Hopper');
  });

  it('omits merge fields entirely when no name can be derived', async () => {
    await dispatchToIntegrations(
      submission({ fields: { message: 'hello' } }),
      [integration('mailchimp')],
    );
    expect(bodyOf()['merge_fields']).toEqual({});
  });

  it('does not split a single-word name into first/last', async () => {
    await dispatchToIntegrations(
      submission({ fields: { name: 'Cher' } }),
      [integration('resend', { list_id: 'aud-1' })],
    );
    const body = bodyOf();
    expect(body['first_name']).toBeUndefined();
    expect(body['last_name']).toBeUndefined();
  });

  it('splits a multi-word combined name into first + remaining last', async () => {
    await dispatchToIntegrations(
      submission({ fields: { name: 'Mary Jane Watson' } }),
      [integration('resend', { list_id: 'aud-1' })],
    );
    const body = bodyOf();
    expect(body['first_name']).toBe('Mary');
    expect(body['last_name']).toBe('Jane Watson');
  });

  it('ignores blank/whitespace-only field values', async () => {
    await dispatchToIntegrations(
      submission({ fields: { first_name: '   ', name: 'Real Name' } }),
      [integration('resend', { list_id: 'aud-1' })],
    );
    // blank first_name is skipped → falls through to combined "name" split
    expect(bodyOf()['first_name']).toBe('Real');
  });
});

describe('timeout wiring', () => {
  it('passes an AbortSignal on every request', async () => {
    await dispatchToIntegrations(submission(), [integration('sendgrid')]);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
