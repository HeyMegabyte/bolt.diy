/**
 * @module services/integration_client
 * @description Zod schemas and inferred types for MCP/Social OAuth integration
 *   connection shapes. Pure zero-I/O — every schema is a stateless Zod object
 *   safe to import in any runtime context (Worker, Jest, container build).
 *
 * @see src/services/mcp_connections.ts (runtime CRUD on D1 + KV)
 */

import { z } from 'zod';

// ── Connection status ─────────────────────────────────────────────────────────

/**
 * Enum of possible states for a third-party integration connection.
 *
 * @example
 * import { ConnectionStatus } from './integration_client.js';
 * if (status === ConnectionStatus.Connected) { /* refresh token *\/ }
 */
export const ConnectionStatus = z.enum(['connected', 'disconnected', 'expired', 'error']);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

// ── Provider-level schemas ─────────────────────────────────────────────────────

/**
 * Static metadata for an OAuth / paste-key provider. Every integration
 * (MCP server, social connector) has one persisted ProviderConfig.
 *
 * @example
 * const stripeConfig: ProviderConfig = {
 *   name: 'stripe',
 *   clientId: 'ca_xxx',
 *   scopes: ['read', 'write'],
 *   redirectUri: 'https://projectsites.dev/api/mcp/stripe/callback',
 * };
 */
export const ProviderConfigSchema = z.object({
  /** OAuth client ID issued by the third party (or empty for paste-key). */
  clientId: z.string().max(512).default(''),
  /** Lowercase snake-case provider identifier (e.g. `"stripe"`, `"hubspot"`). */
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Provider name must be lowercase alphanumeric'),
  /** Absolute callback URL the provider redirects to after auth. */
  redirectUri: z.string().url().optional(),
  /** Permission scopes requested at authorization time. */
  scopes: z.array(z.string().min(1)).default([]),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * A single OAuth scope string. Reusable union type for validating
 * connection-level scope lists.
 *
 * @example
 * // Validate that all requested scopes are recognised
 * MY_SCOPES.every((s) => ProviderScopeSchema.safeParse(s).success);
 */
export const ProviderScopeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9_:./-]*$/, 'Invalid scope format');
export type ProviderScope = z.infer<typeof ProviderScopeSchema>;

// ── Token schemas ──────────────────────────────────────────────────────────────

/**
 * OAuth 2.0 token set returned from a token-exchange endpoint.
 *
 * @example
 * const token: OAuthToken = {
 *   accessToken: 'ya29.a0AfH6SMC…',
 *   refreshToken: '1//0gABC…',
 *   expiresAt: 1750000000000,
 * };
 */
export const OAuthTokenSchema = z.object({
  /** The bearer token sent in API request Authorization headers. */
  accessToken: z.string().min(1),
  /** Unix-millisecond timestamp at which {@link accessToken} expires. */
  expiresAt: z.number().int().positive(),
  /** Long-lived token used to mint fresh access tokens (absent for
   *  client-credentials or paste-key flows). */
  refreshToken: z.string().optional(),
});
export type OAuthToken = z.infer<typeof OAuthTokenSchema>;

// ── Connection-level schemas ───────────────────────────────────────────────────

/**
 * Runtime connection state for a single provider + site pair. Captures
 * the current status, the cached token, and error detail when failed.
 *
 * @example
 * const state: ConnectionState = {
 *   status: 'connected',
 *   token: { accessToken: 'sk-…', expiresAt: 1750000000000 },
 *   lastCheckedAt: Date.now(),
 * };
 */
export const ConnectionStateSchema = z.object({
  /** Human-readable error description (present only when status is `error`). */
  errorMessage: z.string().max(1024).optional(),
  /** Unix-millisecond timestamp of the last status check. */
  lastCheckedAt: z.number().int().positive(),
  /** Current connectivity status of this integration. */
  status: ConnectionStatus,
  /** Cached OAuth token (absent when disconnected or error). */
  token: OAuthTokenSchema.optional(),
});
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

/**
 * Fully resolved integration connection combining the provider's static
 * config with the runtime connection state. Returned by the MCP OAuth
 * layer when a site requests its integration status.
 *
 * @example
 * const conn: IntegrationConnection = {
 *   provider: { name: 'stripe', clientId: 'ca_xxx' },
 *   state: {
 *     status: 'connected',
 *     token: { accessToken: 'sk-…', expiresAt: 1750000000000 },
 *     lastCheckedAt: Date.now(),
 *   },
 * };
 */
export const IntegrationConnectionSchema = z.object({
  /** Static provider metadata (name, client id, scopes, redirect uri). */
  provider: ProviderConfigSchema,
  /** Runtime state: status, token, error, timestamp. */
  state: ConnectionStateSchema,
});
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
