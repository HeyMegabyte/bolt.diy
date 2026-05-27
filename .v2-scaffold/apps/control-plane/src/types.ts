/** Shared types + AppError + Problem Details envelope. */

import type { Env } from './env.js';

/** Hono context variables populated by middleware. */
export interface Variables {
  requestId: string;
  userId: string | null;
  userEmail: string | null;
  orgId: string | null;
  /** Role the session is currently viewing as (X-View-As). */
  viewAs: string | null;
  isSuperAdmin: boolean;
  tenantId: string | null;
}

export type HonoEnv = { Bindings: Env; Variables: Variables };

/** Stable error codes. Maps to HTTP statuses in the error handler. */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_DUPLICATE: 'WEBHOOK_DUPLICATE',
  STRIPE_ERROR: 'STRIPE_ERROR',
  DOMAIN_PROVISIONING_ERROR: 'DOMAIN_PROVISIONING_ERROR',
  AI_GENERATION_ERROR: 'AI_GENERATION_ERROR',
} as const;

export type ErrorCodeT = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_MAP: Record<ErrorCodeT, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  STRIPE_ERROR: 502,
  WEBHOOK_SIGNATURE_INVALID: 400,
  WEBHOOK_DUPLICATE: 200,
  DOMAIN_PROVISIONING_ERROR: 502,
  AI_GENERATION_ERROR: 502,
};

export class AppError extends Error {
  readonly code: ErrorCodeT;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeT, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS_MAP[code];
    this.details = details;
  }
}

/** Problem Details (RFC 7807) envelope. */
export interface ProblemEnvelope {
  error: {
    code: ErrorCodeT;
    message: string;
    request_id: string;
    details?: unknown;
  };
}

/** Capability strings — every super-admin endpoint also re-checks email. */
export type Capability =
  | 'billing.read'
  | 'billing.write'
  | 'sites.read'
  | 'sites.write'
  | 'sites.delete'
  | 'team.read'
  | 'team.write'
  | 'integrations.read'
  | 'integrations.write'
  | 'jobs.read'
  | 'jobs.write'
  | 'admin.sql';
