/**
 * Tests for the listmonk_client service module.
 *
 * All tests are pure (no real network). `fetch` is injected as a parameter
 * so every branch is exercised without any I/O.
 */

import { listmonkHealth, listmonkUpsertSubscriber } from '../services/listmonk_client.js';
import type { ListmonkConfig } from '../services/listmonk_client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid config pointing at a mock listmonk instance. */
const validCfg: ListmonkConfig = {
  baseUrl: 'https://listmonk.megabyte.space',
  apiUser: 'testuser',
  apiToken: 'secrettoken',
};

/** Builds a minimal `Response`-shaped object accepted by the DI param. */
function makeResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// listmonkHealth
// ---------------------------------------------------------------------------

describe('listmonkHealth', () => {
  it('returns not_configured and never calls fetch when baseUrl is missing', async () => {
    const fetchMock = jest.fn();
    const cfg: ListmonkConfig = { baseUrl: '', apiUser: 'u', apiToken: 't' };
    const result = await listmonkHealth(cfg, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes /health even without an apiToken — public liveness needs no auth', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(200));
    const cfg: ListmonkConfig = { baseUrl: 'https://x.com', apiUser: 'u', apiToken: '' };
    const result = await listmonkHealth(cfg, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe('https://x.com/health');
  });

  it('returns ok:true when the health endpoint responds 200', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(200));
    const result = await listmonkHealth(validCfg, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe('https://listmonk.megabyte.space/health');
  });

  it('returns unhealthy when the health endpoint responds 500', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(500));
    const result = await listmonkHealth(validCfg, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('unhealthy');
  });

  it('returns unreachable when fetch throws a network error', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await listmonkHealth(validCfg, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('unreachable');
  });
});

// ---------------------------------------------------------------------------
// listmonkUpsertSubscriber
// ---------------------------------------------------------------------------

describe('listmonkUpsertSubscriber', () => {
  const subscriberInput = {
    email: 'brian@megabyte.space',
    name: 'Brian Zalewski',
    lists: [1, 2],
  };

  it('sends Basic auth header derived from apiUser:apiToken', async () => {
    const responseBody = { data: { id: 42 } };
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(200, responseBody));

    await listmonkUpsertSubscriber(validCfg, subscriberInput, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expectedBasic = `Basic ${btoa('testuser:secrettoken')}`;
    expect(headers['Authorization']).toBe(expectedBasic);
  });

  it('sends a POST to the correct URL with the expected JSON body', async () => {
    const responseBody = { data: { id: 7 } };
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(200, responseBody));

    await listmonkUpsertSubscriber(validCfg, subscriberInput, fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://listmonk.megabyte.space/api/subscribers');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.email).toBe('brian@megabyte.space');
    expect(body.name).toBe('Brian Zalewski');
    expect(body.lists).toEqual([1, 2]);
    expect(body.status).toBe('enabled');
  });

  it('returns ok:true and the subscriber id on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(200, { data: { id: 42 } }));

    const result = await listmonkUpsertSubscriber(
      validCfg,
      subscriberInput,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    expect((result as { id: number }).id).toBe(42);
  });

  it('returns ok:false with a reason when fetch throws', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('Network failure'));

    const result = await listmonkUpsertSubscriber(
      validCfg,
      subscriberInput,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBeTruthy();
  });

  it('returns ok:false when the API returns a non-2xx status', async () => {
    const fetchMock = jest.fn().mockResolvedValue(makeResponse(422, { message: 'duplicate' }));

    const result = await listmonkUpsertSubscriber(
      validCfg,
      subscriberInput,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBeTruthy();
  });
});
