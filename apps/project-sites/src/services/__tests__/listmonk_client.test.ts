/**
 * Unit tests for Listmonk REST client functions.
 *
 * Every test injects a mock `fetchImpl` so no real I/O occurs. The mock returns
 * controlled JSON responses to exercise every branch: configured/unconfigured,
 * success, HTTP errors, network failures, edge cases.
 */
import {
  listmonkHealth,
  listmonkUpsertSubscriber,
  listmonkCreateCampaign,
  listmonkStartCampaign,
  listmonkUnsubscribe,
  listmonkSendTransactional,
  listmonkGetSubscriber,
  listmonkListSubscribers,
  listmonkGetLists,
  type ListmonkConfig,
} from '../listmonk_client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CFG: ListmonkConfig = {
  baseUrl: 'https://mail.projectsites.dev',
  apiUser: 'projectsites',
  apiToken: 'test-token',
};

const UNCONFIGURED: ListmonkConfig = {
  baseUrl: '',
  apiUser: '',
  apiToken: '',
};

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
}

function mockFetchThrow(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// listmonkHealth
// ---------------------------------------------------------------------------

describe('listmonkHealth', () => {
  it('returns not_configured when credentials are missing', async () => {
    const r = await listmonkHealth(UNCONFIGURED);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns ok when server responds 200', async () => {
    const r = await listmonkHealth(CFG, mockFetch(200, {}));
    expect(r).toEqual({ ok: true });
  });

  it('returns unhealthy when server responds 500', async () => {
    const r = await listmonkHealth(CFG, mockFetch(500, {}));
    expect(r).toEqual({ ok: false, reason: 'unhealthy' });
  });

  it('returns unreachable on network error', async () => {
    const r = await listmonkHealth(CFG, mockFetchThrow('ECONNREFUSED'));
    expect(r).toEqual({ ok: false, reason: 'unreachable' });
  });
});

// ---------------------------------------------------------------------------
// listmonkUpsertSubscriber
// ---------------------------------------------------------------------------

describe('listmonkUpsertSubscriber', () => {
  const input = { email: 'test@example.com', name: 'Test User', lists: [1] };

  it('creates subscriber and returns id', async () => {
    const r = await listmonkUpsertSubscriber(CFG, input, mockFetch(200, { data: { id: 42 } }));
    expect(r).toEqual({ ok: true, id: 42 });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkUpsertSubscriber(UNCONFIGURED, input);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error reason on 409 duplicate', async () => {
    const r = await listmonkUpsertSubscriber(CFG, input, mockFetch(409, { message: 'Duplicate' }));
    expect(r).toEqual({ ok: false, reason: 'Duplicate' });
  });

  it('returns http status reason when no message body', async () => {
    const r = await listmonkUpsertSubscriber(CFG, input, mockFetch(500, 'server error'));
    expect(r).toEqual({ ok: false, reason: 'http_500' });
  });

  it('returns network error reason on fetch failure', async () => {
    const r = await listmonkUpsertSubscriber(CFG, input, mockFetchThrow('timeout'));
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
});

// ---------------------------------------------------------------------------
// listmonkCreateCampaign
// ---------------------------------------------------------------------------

describe('listmonkCreateCampaign', () => {
  const input = { name: 'Welcome', subject: 'Hello', body: '<p>hi</p>', lists: [1] };

  it('creates campaign and returns id', async () => {
    const r = await listmonkCreateCampaign(CFG, input, mockFetch(200, { data: { id: 7 } }));
    expect(r).toEqual({ ok: true, id: 7 });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkCreateCampaign(UNCONFIGURED, input);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error on HTTP failure', async () => {
    const r = await listmonkCreateCampaign(CFG, input, mockFetch(422, {}));
    expect(r).toEqual({ ok: false, reason: 'http_422' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkCreateCampaign(CFG, input, mockFetchThrow('ENOTFOUND'));
    expect(r).toEqual({ ok: false, reason: 'ENOTFOUND' });
  });
});

// ---------------------------------------------------------------------------
// listmonkStartCampaign
// ---------------------------------------------------------------------------

describe('listmonkStartCampaign', () => {
  it('starts campaign and returns id', async () => {
    const r = await listmonkStartCampaign(CFG, 42, mockFetch(200, {}));
    expect(r).toEqual({ ok: true, id: 42 });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkStartCampaign(UNCONFIGURED, 1);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error on HTTP failure', async () => {
    const r = await listmonkStartCampaign(CFG, 99, mockFetch(404, {}));
    expect(r).toEqual({ ok: false, reason: 'http_404' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkStartCampaign(CFG, 1, mockFetchThrow('connection reset'));
    expect(r).toEqual({ ok: false, reason: 'connection reset' });
  });
});

// ---------------------------------------------------------------------------
// listmonkUnsubscribe
// ---------------------------------------------------------------------------

describe('listmonkUnsubscribe', () => {
  it('blocklists subscriber and returns ok', async () => {
    const r = await listmonkUnsubscribe(CFG, 'test@example.com', mockFetch(200, {}));
    expect(r).toEqual({ ok: true });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkUnsubscribe(UNCONFIGURED, 'test@example.com');
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('escapes single quotes in email', async () => {
    // The mock captures the body sent to listmonk — we verify the escaped query
    let capturedBody = '';
    const fetchSpy = (async (url: string, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await listmonkUnsubscribe(CFG, "o'brien@example.com", fetchSpy);
    expect(capturedBody).toContain("o''brien@example.com");
  });

  it('returns error on HTTP failure', async () => {
    const r = await listmonkUnsubscribe(CFG, 'x@y.com', mockFetch(500, {}));
    expect(r).toEqual({ ok: false, reason: 'http_500' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkUnsubscribe(CFG, 'x@y.com', mockFetchThrow('DNSError'));
    expect(r).toEqual({ ok: false, reason: 'DNSError' });
  });
});

// ---------------------------------------------------------------------------
// listmonkSendTransactional (NEW)
// ---------------------------------------------------------------------------

describe('listmonkSendTransactional', () => {
  const input = {
    templateId: 1,
    subscriberEmail: 'test@example.com',
    data: { code: 'abc123', name: 'Alice' },
  };

  it('sends transactional email and returns messageId', async () => {
    const r = await listmonkSendTransactional(
      CFG,
      input,
      mockFetch(200, { data: { id: 'msg-001' } }),
    );
    expect(r).toEqual({ ok: true, messageId: 'msg-001' });
  });

  it('falls back to message field when data.id is absent', async () => {
    const r = await listmonkSendTransactional(CFG, input, mockFetch(200, { message: 'queued' }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.messageId).toBe('queued');
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkSendTransactional(UNCONFIGURED, input);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('omits data field from body when data is undefined', async () => {
    let capturedBody = '';
    const fetchSpy = (async (_url: string, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return { ok: true, status: 200, json: async () => ({ data: { id: 'x' } }) };
    }) as unknown as typeof fetch;
    await listmonkSendTransactional(CFG, { templateId: 2, subscriberEmail: 'n@x.com' }, fetchSpy);
    const parsed = JSON.parse(capturedBody);
    expect(parsed).toHaveProperty('subscriber_email', 'n@x.com');
    expect(parsed).toHaveProperty('template_id', 2);
    expect(parsed).not.toHaveProperty('data');
  });

  it('returns HTTP error reason with message body', async () => {
    const r = await listmonkSendTransactional(
      CFG,
      input,
      mockFetch(422, { message: 'Template not found' }),
    );
    expect(r).toEqual({ ok: false, reason: 'Template not found' });
  });

  it('returns http status reason when error body has no message', async () => {
    const r = await listmonkSendTransactional(CFG, input, mockFetch(500, 'boom'));
    expect(r).toEqual({ ok: false, reason: 'http_500' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkSendTransactional(CFG, input, mockFetchThrow('connect ETIMEDOUT'));
    expect(r).toEqual({ ok: false, reason: 'connect ETIMEDOUT' });
  });
});

// ---------------------------------------------------------------------------
// listmonkGetSubscriber (NEW)
// ---------------------------------------------------------------------------

describe('listmonkGetSubscriber', () => {
  const sub = {
    id: 99,
    email: 'found@example.com',
    name: 'Found User',
    status: 'enabled',
    lists: [1, 2],
    attribs: { city: 'NYC' },
  };

  it('returns subscriber when found', async () => {
    const r = await listmonkGetSubscriber(
      CFG,
      'found@example.com',
      mockFetch(200, { data: { results: [sub] } }),
    );
    expect(r).toEqual({
      ok: true,
      subscriber: {
        id: 99,
        email: 'found@example.com',
        name: 'Found User',
        status: 'enabled',
        lists: [1, 2],
        attribs: { city: 'NYC' },
      },
    });
  });

  it('returns null subscriber when not found', async () => {
    const r = await listmonkGetSubscriber(
      CFG,
      'nope@example.com',
      mockFetch(200, { data: { results: [] } }),
    );
    expect(r).toEqual({ ok: true, subscriber: null });
  });

  it('handles missing data.results gracefully', async () => {
    const r = await listmonkGetSubscriber(CFG, 'x@x.com', mockFetch(200, {}));
    expect(r).toEqual({ ok: true, subscriber: null });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkGetSubscriber(UNCONFIGURED, 'x@x.com');
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('escapes single quotes in email', async () => {
    let capturedUrl = '';
    const fetchSpy = (async (url: string, _init?: RequestInit) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ data: { results: [] } }) };
    }) as unknown as typeof fetch;
    await listmonkGetSubscriber(CFG, "o'brien@example.com", fetchSpy);
    expect(capturedUrl).toContain("o''brien%40example.com");
  });

  it('returns error on HTTP failure', async () => {
    const r = await listmonkGetSubscriber(CFG, 'x@x.com', mockFetch(503, {}));
    expect(r).toEqual({ ok: false, reason: 'http_503' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkGetSubscriber(CFG, 'x@x.com', mockFetchThrow('DNS fail'));
    expect(r).toEqual({ ok: false, reason: 'DNS fail' });
  });
});

// ---------------------------------------------------------------------------
// listmonkListSubscribers (Fire 4)
// ---------------------------------------------------------------------------

describe('listmonkListSubscribers', () => {
  const sub = { id: 1, email: 'a@x.com', name: 'A', status: 'enabled', lists: [1], attribs: {} };

  it('returns paginated subscribers', async () => {
    const r = await listmonkListSubscribers(
      CFG,
      1,
      50,
      mockFetch(200, {
        data: { results: [sub, { ...sub, id: 2 }], total: 100, page: 1, per_page: 50 },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.page.subscribers).toHaveLength(2);
      expect(r.page.total).toBe(100);
      expect(r.page.page).toBe(1);
    }
  });

  it('returns empty page when no subscribers', async () => {
    const r = await listmonkListSubscribers(CFG, 1, 50, mockFetch(200, { data: { results: [] } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.page.subscribers).toHaveLength(0);
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkListSubscribers(UNCONFIGURED);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error on HTTP failure', async () => {
    const r = await listmonkListSubscribers(CFG, 1, 50, mockFetch(500, {}));
    expect(r).toEqual({ ok: false, reason: 'http_500' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkListSubscribers(CFG, 1, 50, mockFetchThrow('timeout'));
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
});

// ---------------------------------------------------------------------------
// listmonkGetLists (Fire 4)
// ---------------------------------------------------------------------------

describe('listmonkGetLists', () => {
  it('returns mailing lists', async () => {
    const r = await listmonkGetLists(
      CFG,
      mockFetch(200, {
        data: { results: [{ id: 1, name: 'Newsletter', type: 'public', subscriber_count: 42 }] },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lists).toHaveLength(1);
      expect(r.lists[0].name).toBe('Newsletter');
      expect(r.lists[0].subscriberCount).toBe(42);
    }
  });

  it('returns empty array when no lists', async () => {
    const r = await listmonkGetLists(CFG, mockFetch(200, { data: { results: [] } }));
    expect(r).toEqual({ ok: true, lists: [] });
  });

  it('returns not_configured when credentials missing', async () => {
    const r = await listmonkGetLists(UNCONFIGURED);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('returns error on HTTP failure', async () => {
    const r = await listmonkGetLists(CFG, mockFetch(503, {}));
    expect(r).toEqual({ ok: false, reason: 'http_503' });
  });

  it('returns network error on fetch failure', async () => {
    const r = await listmonkGetLists(CFG, mockFetchThrow('ENOTFOUND'));
    expect(r).toEqual({ ok: false, reason: 'ENOTFOUND' });
  });
});
