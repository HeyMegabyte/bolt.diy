/**
 * Convergence §62 — error taxonomy + envelope serialization.
 */
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  JobDispatchError,
  QuotaExceededError,
  toErrorResponse,
} from '../platform/errors.js';

class FakeInputError extends Error {
  constructor(m: string) {
    super(m);
    this.name = 'FakeInputError';
  }
}

describe('AppError taxonomy', () => {
  it('carries stable code + status + retryable', () => {
    expect(new ValidationError('x')).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, retryable: false });
    expect(new UnauthorizedError('x')).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(new ForbiddenError('x')).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(new NotFoundError('x')).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(new QuotaExceededError('x')).toMatchObject({ code: 'QUOTA_EXCEEDED', status: 429 });
    expect(new RateLimitedError('x')).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryable: true });
    expect(new JobDispatchError('x')).toMatchObject({ code: 'JOB_DISPATCH_ERROR', status: 502, retryable: true });
  });

  it('is an Error subclass (instanceof works)', () => {
    expect(new ValidationError('x')).toBeInstanceOf(AppError);
    expect(new ValidationError('x')).toBeInstanceOf(Error);
  });
});

describe('toErrorResponse', () => {
  it('serializes an AppError with its code/status + request_id', () => {
    const r = toErrorResponse(new NotFoundError('Job not found'), 'req-1');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Job not found', request_id: 'req-1' });
  });

  it('maps port *InputError/*ContextError/*EventError to 400 VALIDATION_ERROR', () => {
    const r = toErrorResponse(new FakeInputError('bad field'), 'req-2');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps an unknown error to 500 INTERNAL_ERROR (no leak)', () => {
    const r = toErrorResponse(new Error('secret detail'), 'req-3');
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(r.body.error.message).toBe('Internal server error'); // does not leak the raw message
  });
});
