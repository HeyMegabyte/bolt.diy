import {
  forwardPostHog,
  forwardGa4,
  forwardGtm,
  type ProviderCreds,
} from '../services/analytics_providers.js';
import type { IncomingEvent } from '../services/analytics_events.js';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const EVENT: IncomingEvent = {
  type: 'page_view',
  siteId: 'site-001',
  userId: 'user-001',
  anonId: 'anon-001',
  url: 'https://example.com/page',
  timestamp: '2024-01-01T00:00:00.000Z',
  properties: {},
};

const OK_RESPONSE = { ok: true, status: 200 } as Response;
const ERR_RESPONSE = { ok: false, status: 500 } as Response;

// ---------------------------------------------------------------------------
// forwardPostHog
// ---------------------------------------------------------------------------

describe('forwardPostHog', () => {
  it('POSTs once for a 1-event batch', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(OK_RESPONSE);
    const creds: ProviderCreds = { posthog: { apiKey: 'pk_test_abc' } };

    await forwardPostHog([EVENT], creds, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/capture/');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { api_key: string; batch: unknown[] };
    expect(body.api_key).toBe('pk_test_abc');
    expect(body.batch).toHaveLength(1);
  });

  it('throws posthog_500 on non-OK response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ERR_RESPONSE);
    const creds: ProviderCreds = { posthog: { apiKey: 'pk_test_abc' } };

    await expect(forwardPostHog([EVENT], creds, fetchImpl)).rejects.toThrow('posthog_500');
  });

  it('is a no-op when creds.posthog is absent', async () => {
    const fetchImpl = jest.fn();
    await forwardPostHog([EVENT], {}, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// forwardGa4
// ---------------------------------------------------------------------------

describe('forwardGa4', () => {
  it('POSTs once for a 1-event batch', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(OK_RESPONSE);
    const creds: ProviderCreds = {
      ga4: { measurementId: 'G-TEST123', apiSecret: 'secret' },
    };

    await forwardGa4([EVENT], creds, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('measurement_id=G-TEST123');
    expect(url).toContain('api_secret=secret');
    expect(init.method).toBe('POST');
  });

  it('throws ga4_500 on non-OK response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ERR_RESPONSE);
    const creds: ProviderCreds = {
      ga4: { measurementId: 'G-TEST123', apiSecret: 'secret' },
    };

    await expect(forwardGa4([EVENT], creds, fetchImpl)).rejects.toThrow('ga4_500');
  });

  it('is a no-op when creds.ga4 is absent', async () => {
    const fetchImpl = jest.fn();
    await forwardGa4([EVENT], {}, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// forwardGtm
// ---------------------------------------------------------------------------

describe('forwardGtm', () => {
  it('POSTs once for a 1-event batch', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(OK_RESPONSE);
    const creds: ProviderCreds = {
      gtm: { endpoint: 'https://collect.example.com/gtm' },
    };

    await forwardGtm([EVENT], creds, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://collect.example.com/gtm');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as unknown[];
    expect(body).toHaveLength(1);
  });

  it('throws gtm_500 on non-OK response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ERR_RESPONSE);
    const creds: ProviderCreds = {
      gtm: { endpoint: 'https://collect.example.com/gtm' },
    };

    await expect(forwardGtm([EVENT], creds, fetchImpl)).rejects.toThrow('gtm_500');
  });

  it('is a no-op when creds.gtm is absent', async () => {
    const fetchImpl = jest.fn();
    await forwardGtm([EVENT], {}, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
