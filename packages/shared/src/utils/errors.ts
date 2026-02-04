/**
 * Error handling utilities
 */

import { API_ERROR_CODES } from '../schemas/api.js';

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Base application error
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string = API_ERROR_CODES.INTERNAL_ERROR,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    // Maintains proper stack trace
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

/**
 * Authentication error (401)
 */
export class AuthError extends AppError {
  constructor(
    message: string = 'Authentication required',
    code: string = API_ERROR_CODES.UNAUTHORIZED,
    details?: Record<string, unknown>
  ) {
    super(message, code, 401, details);
    this.name = 'AuthError';
  }
}

/**
 * Authorization error (403)
 */
export class ForbiddenError extends AppError {
  constructor(
    message: string = 'Access denied',
    code: string = API_ERROR_CODES.FORBIDDEN,
    details?: Record<string, unknown>
  ) {
    super(message, code, 403, details);
    this.name = 'ForbiddenError';
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string = 'Resource',
    details?: Record<string, unknown>
  ) {
    super(`${resource} not found`, API_ERROR_CODES.NOT_FOUND, 404, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(
    message: string = 'Validation failed',
    details?: Record<string, unknown>
  ) {
    super(message, API_ERROR_CODES.VALIDATION_ERROR, 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(
    message: string = 'Too many requests',
    retryAfter?: number,
    details?: Record<string, unknown>
  ) {
    super(message, API_ERROR_CODES.RATE_LIMITED, 429, details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Payment required error (402)
 */
export class PaymentRequiredError extends AppError {
  constructor(
    message: string = 'Payment required',
    details?: Record<string, unknown>
  ) {
    super(message, API_ERROR_CODES.PAYMENT_REQUIRED, 402, details);
    this.name = 'PaymentRequiredError';
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(
    message: string = 'Resource already exists',
    details?: Record<string, unknown>
  ) {
    super(message, API_ERROR_CODES.CONFLICT, 409, details);
    this.name = 'ConflictError';
  }
}

/**
 * External service error (502)
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(
    service: string,
    message: string = 'External service error',
    details?: Record<string, unknown>
  ) {
    super(message, API_ERROR_CODES.EXTERNAL_SERVICE_ERROR, 502, details);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

// ============================================================================
// ERROR UTILITIES
// ============================================================================

/**
 * Check if an error is operational (expected) vs programmer error
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Normalize any error into an AppError
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      error.message,
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      { originalName: error.name }
    );
  }

  if (typeof error === 'string') {
    return new AppError(error);
  }

  return new AppError('An unexpected error occurred');
}

/**
 * Extract user-safe error message
 */
export function getUserSafeMessage(error: unknown): string {
  if (error instanceof AppError && error.isOperational) {
    return error.message;
  }
  return 'An unexpected error occurred. Please try again later.';
}

/**
 * Create error response object
 */
export function createErrorResponse(
  error: unknown,
  requestId?: string
): {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  request_id?: string;
} {
  const appError = normalizeError(error);
  return {
    success: false,
    error: {
      code: appError.code,
      message: appError.isOperational
        ? appError.message
        : 'An unexpected error occurred',
      details: appError.isOperational ? appError.details : undefined,
    },
    ...(requestId && { request_id: requestId }),
  };
}

// ============================================================================
// RETRY UTILITIES
// ============================================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: (error) => {
    // Retry on network/temporary errors, not on client errors
    if (error instanceof AppError) {
      return error.statusCode >= 500 || error.statusCode === 429;
    }
    return true;
  },
};

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  // Add jitter (0-25% of delay)
  const jitter = delay * 0.25 * Math.random();
  return Math.round(delay + jitter);
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (
        attempt === opts.maxAttempts ||
        !opts.shouldRetry?.(error, attempt)
      ) {
        throw error;
      }

      const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
