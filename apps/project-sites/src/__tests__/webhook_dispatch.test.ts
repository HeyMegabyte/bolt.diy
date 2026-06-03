import { dispatchEvent, type DispatchDeps, type DispatchEndpoint } from '../services/webhook_dispatch';
import { nextRetryDelayMs } from '../services/outbound_webhooks';

/**
 * Guards the outbound-webhook dispatch orchestrator (#10 / reused by #11): the
 * glue tying planDeliveries → decrypt → sign → attemptDelivery → recordDelivery
 * → bounded retry. All effects are injected so the retry/backoff loop is tested
 * with no real crypto, no D1, and no wall-clock waiting.
 */
const URL_OK = 'https://hooks.example.com/webhook';
const SITE = 'site-1';
const TS = '2026-06-02T00:00:00.000Z';

function makeDeps(over: Partial<DispatchDeps> = {}): {
  deps: DispatchDeps;
  fetchFn: jest.Mock;
  record: jest.Mock;
  sleep: jest.Mock;
} {
  const fetchFn = jest.fn().mockResolvedValue({ status: 200 } as Response);
  const record = jest.fn().mockResolvedValue(undefined);
  const sleep = jest.fn().mockResolvedValue(undefined);
  const deps: DispatchDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    decrypt: jest.fn().mockResolvedValue('plaintext-secret'),
    sign: jest.fn().mockResolvedValue('deadbeef'),
    record,
    sleep,
    ...over,
  };
  return { deps, fetchFn, record, sleep };
}

const endpoint = (over: Partial<DispatchEndpoint> = {}): DispatchEndpoint => ({
  id: 'e1',
  url: URL_OK,
  eventTypes: ['site.published'],
  enabled: true,
  secretEncrypted: 'enc-blob',
  ...over,
});

const EVENT = { type: 'site.published', payload: { siteId: SITE } };

describe('dispatchEvent', () => {
  it('delivers to a subscribed enabled endpoint on 2xx', async () => {
    const { deps, fetchFn, record } = makeDeps();
    const out = await dispatchEvent(deps, EVENT, [endpoint()], SITE, TS);

    expect(out).toEqual({ delivered: 1, failed: 0, skipped: 0, attempts: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(URL_OK);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ endpointId: 'e1', siteId: SITE, ok: true, statusCode: 200, attempt: 1 }));
  });

  it('skips disabled + not-subscribed endpoints without fetching', async () => {
    const { deps, fetchFn } = makeDeps();
    const out = await dispatchEvent(
      deps,
      EVENT,
      [endpoint({ id: 'off', enabled: false }), endpoint({ id: 'other', eventTypes: ['payment.succeeded'] })],
      SITE,
      TS,
    );
    expect(out).toEqual({ delivered: 0, failed: 0, skipped: 2, attempts: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retries on 5xx then succeeds, sleeping with exponential backoff', async () => {
    const { deps, fetchFn, sleep, record } = makeDeps();
    fetchFn.mockResolvedValueOnce({ status: 503 } as Response).mockResolvedValueOnce({ status: 200 } as Response);

    const out = await dispatchEvent(deps, EVENT, [endpoint()], SITE, TS);

    expect(out).toEqual({ delivered: 1, failed: 0, skipped: 0, attempts: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(nextRetryDelayMs(1));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503, ok: false, attempt: 1 }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 200, ok: true, attempt: 2 }));
  });

  it('does NOT retry a permanent 4xx', async () => {
    const { deps, fetchFn, sleep } = makeDeps();
    fetchFn.mockResolvedValue({ status: 404 } as Response);

    const out = await dispatchEvent(deps, EVENT, [endpoint()], SITE, TS);

    expect(out).toEqual({ delivered: 0, failed: 1, skipped: 0, attempts: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('records a sign_error and skips the fetch when decrypt throws', async () => {
    const { deps, fetchFn, record } = makeDeps({ decrypt: jest.fn().mockRejectedValue(new Error('bad key')) });
    const out = await dispatchEvent(deps, EVENT, [endpoint()], SITE, TS);

    expect(out).toEqual({ delivered: 0, failed: 1, skipped: 0, attempts: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ error: 'sign_error', ok: false }));
  });

  it('records missing_secret when an endpoint has no stored secret', async () => {
    const { deps, fetchFn, record } = makeDeps();
    const out = await dispatchEvent(deps, EVENT, [endpoint({ secretEncrypted: '' })], SITE, TS);

    expect(out).toEqual({ delivered: 0, failed: 1, skipped: 0, attempts: 1 });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ error: 'missing_secret' }));
  });
});
