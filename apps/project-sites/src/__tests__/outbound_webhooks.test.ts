import {
  signedPayloadBase,
  buildSignatureHeader,
  nextRetryDelayMs,
  isDeliverySuccess,
  shouldRetry,
  MAX_DELIVERY_ATTEMPTS,
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from '../services/outbound_webhooks.js';

describe('outbound_webhooks signed payload', () => {
  it('binds the timestamp into the signed material (replay-safety)', () => {
    expect(signedPayloadBase('1700000000', '{"a":1}')).toBe('1700000000.{"a":1}');
  });

  it('formats the signature header Svix/Stripe-style', () => {
    expect(buildSignatureHeader('1700000000', 'abc123')).toBe('t=1700000000,v1=abc123');
  });
});

describe('outbound_webhooks retry schedule', () => {
  it('doubles the delay each attempt', () => {
    expect(nextRetryDelayMs(1)).toBe(BASE_RETRY_DELAY_MS);
    expect(nextRetryDelayMs(2)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(nextRetryDelayMs(3)).toBe(BASE_RETRY_DELAY_MS * 4);
    expect(nextRetryDelayMs(4)).toBe(BASE_RETRY_DELAY_MS * 8);
  });

  it('caps the delay at MAX_RETRY_DELAY_MS', () => {
    expect(nextRetryDelayMs(50)).toBe(MAX_RETRY_DELAY_MS);
  });
});

describe('outbound_webhooks delivery outcome', () => {
  it('treats 2xx as success', () => {
    expect(isDeliverySuccess(200)).toBe(true);
    expect(isDeliverySuccess(204)).toBe(true);
    expect(isDeliverySuccess(299)).toBe(true);
    expect(isDeliverySuccess(300)).toBe(false);
    expect(isDeliverySuccess(500)).toBe(false);
  });
});

describe('outbound_webhooks shouldRetry', () => {
  it('retries transient failures (network, 429, 5xx) within the attempt budget', () => {
    expect(shouldRetry(1, 0)).toBe(true); // network error
    expect(shouldRetry(1, 429)).toBe(true); // rate limited
    expect(shouldRetry(1, 500)).toBe(true);
    expect(shouldRetry(1, 503)).toBe(true);
  });

  it('never retries a delivered (2xx) response', () => {
    expect(shouldRetry(1, 200)).toBe(false);
    expect(shouldRetry(1, 204)).toBe(false);
  });

  it('never retries a permanent (non-429) 4xx', () => {
    expect(shouldRetry(1, 400)).toBe(false);
    expect(shouldRetry(1, 401)).toBe(false);
    expect(shouldRetry(1, 404)).toBe(false);
  });

  it('stops once the attempt budget is exhausted', () => {
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS, 500)).toBe(false);
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS - 1, 500)).toBe(true);
  });
});
