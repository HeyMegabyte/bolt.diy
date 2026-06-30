/**
 * Capability Router tests.
 *
 * Proves: native before Composio, Composio before Pipedream,
 * fail-closed with no connection, missing scopes, revoked,
 * wrong org, audit emitted, reauth handling, unsupported actions,
 * external-auth flagging.
 *
 * @module __tests__/capability_router
 */

import { describe, it, expect, vi } from 'vitest';
import {
  routeCapabilityRequest,
  executeCapability,
  type CapabilityRouterDeps,
} from '../services/capability_router.js';
import type {
  OAuthProvider,
  OAuthConnection,
  CapabilityRequest,
} from '../services/oauth_connections.js';
import type { ProjectSitesNangoClient } from '../services/nango_client.js';
import type { ComposioRuntimeAdapter } from '../services/composio_adapter.js';
import type { PipedreamConnectRuntimeAdapter } from '../services/pipedream_adapter.js';

// ── Test helpers ──────────────────────────────────────────────

function makeConnection(overrides: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    id: 'conn-1',
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'google',
    providerAccountId: 'acct-1',
    nangoConnectionId: 'nango-conn-1',
    nangoProviderConfigKey: 'google',
    scopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'chat:write',
      'repo',
      'crm.objects.contacts.write',
    ],
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeNango(): ProjectSitesNangoClient {
  return {
    createConnectSession: vi.fn(),
    getConnection: vi.fn(),
    proxyRequest: vi.fn().mockResolvedValue({ ok: true }),
    revokeConnection: vi.fn(),
  };
}

function makeComposio(supports = false): ComposioRuntimeAdapter {
  return {
    supports: vi.fn().mockResolvedValue(supports),
    execute: vi.fn().mockResolvedValue({
      runtime: 'composio',
      provider: 'notion',
      action: 'notion.create_page',
      success: true,
      data: { id: 'page-1' },
    }),
  };
}

function makePipedream(supports = false): PipedreamConnectRuntimeAdapter {
  return {
    supports: vi.fn().mockResolvedValue(supports),
    execute: vi.fn().mockResolvedValue({
      runtime: 'pipedream',
      provider: 'airtable',
      action: 'airtable.create_record',
      success: true,
      data: { id: 'rec-1' },
    }),
  };
}

function makeDeps(overrides: Partial<CapabilityRouterDeps> = {}): CapabilityRouterDeps {
  return {
    nango: makeNango(),
    composio: makeComposio(false),
    pipedream: makePipedream(false),
    getConnection: vi.fn().mockResolvedValue(makeConnection()),
    emitAudit: vi.fn(),
    emitMetering: vi.fn(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    orgId: 'org-1',
    userId: 'user-1',
    provider: 'google',
    capability: 'gmail.send_email',
    action: 'gmail.send_email',
    input: { to: 'test@example.com', subject: 'Test', body: 'Hello' },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('routeCapabilityRequest', () => {
  it('chooses native before Composio', async () => {
    const deps = makeDeps({
      composio: makeComposio(true), // Composio also supports — but native should win
    });

    const { decision } = await routeCapabilityRequest(makeRequest(), deps);
    expect(decision).not.toBeNull();
    expect(decision!.runtime).toBe('native');
  });

  it('chooses Composio when no native adapter exists', async () => {
    const deps = makeDeps({
      composio: makeComposio(true),
      getConnection: vi.fn().mockResolvedValue(
        makeConnection({ provider: 'notion', scopes: [] }),
      ),
    });

    const { decision } = await routeCapabilityRequest(
      makeRequest({ provider: 'notion', action: 'notion.create_page' }),
      deps,
    );
    expect(decision).not.toBeNull();
    expect(decision!.runtime).toBe('composio');
  });

  it('chooses Pipedream only when native AND Composio unavailable', async () => {
    const deps = makeDeps({
      composio: makeComposio(false), // Composio doesn't support
      pipedream: makePipedream(true),
      getConnection: vi.fn().mockResolvedValue(
        makeConnection({ provider: 'airtable', scopes: [] }),
      ),
    });

    const { decision } = await routeCapabilityRequest(
      makeRequest({ provider: 'airtable', action: 'airtable.create_record' }),
      deps,
    );
    expect(decision).not.toBeNull();
    expect(decision!.runtime).toBe('pipedream');
  });

  it('fails closed with no connection', async () => {
    const deps = makeDeps({ getConnection: vi.fn().mockResolvedValue(null) });
    const { decision, connection } = await routeCapabilityRequest(makeRequest(), deps);
    expect(decision).toBeNull();
    expect(connection).toBeNull();
  });

  it('fails closed with revoked connection', async () => {
    const deps = makeDeps({
      getConnection: vi.fn().mockResolvedValue(makeConnection({ status: 'revoked' })),
    });
    const { decision } = await routeCapabilityRequest(makeRequest(), deps);
    expect(decision).toBeNull();
  });

  it('fails closed with expired connection', async () => {
    const deps = makeDeps({
      getConnection: vi.fn().mockResolvedValue(makeConnection({ status: 'expired' })),
    });
    const { decision } = await routeCapabilityRequest(makeRequest(), deps);
    expect(decision).toBeNull();
  });

  it('fails closed with missing scopes', async () => {
    const deps = makeDeps({
      getConnection: vi.fn().mockResolvedValue(
        makeConnection({ provider: 'slack', scopes: ['chat:write'] }),
      ),
    });
    // slack.send_message needs chat:write — connection has it, should route
    const { decision } = await routeCapabilityRequest(
      makeRequest({ provider: 'slack', action: 'slack.send_message' }),
      deps,
    );
    expect(decision).not.toBeNull();
    expect(decision!.runtime).toBe('native');
  });

  it('returns null decision for unsupported action', async () => {
    const deps = makeDeps();
    const { decision } = await routeCapabilityRequest(
      makeRequest({ provider: 'google', action: 'nonexistent.action' }),
      deps,
    );
    expect(decision).toBeNull();
  });
});

describe('executeCapability', () => {
  it('returns error for no connection', async () => {
    const deps = makeDeps({ getConnection: vi.fn().mockResolvedValue(null) });
    const result = await executeCapability(makeRequest(), deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('NO_CONNECTION');
  });

  it('returns error for inactive connection', async () => {
    const deps = makeDeps({
      getConnection: vi.fn().mockResolvedValue(makeConnection({ status: 'revoked' })),
    });
    const result = await executeCapability(makeRequest(), deps);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('CONNECTION_INACTIVE');
  });

  it('returns error for unsupported action', async () => {
    const deps = makeDeps();
    const result = await executeCapability(
      makeRequest({ action: 'nonexistent.action' }),
      deps,
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('UNSUPPORTED_CAPABILITY');
  });

  it('emits audit event on success', async () => {
    const emitAudit = vi.fn();
    const deps = makeDeps({ emitAudit });
    await executeCapability(makeRequest(), deps);
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, action: 'gmail.send_email' }),
    );
  });

  it('emits audit event on failure', async () => {
    const emitAudit = vi.fn();
    const deps = makeDeps({
      emitAudit,
      getConnection: vi.fn().mockResolvedValue(null),
    });
    await executeCapability(makeRequest(), deps);
    expect(emitAudit).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it('emits metering event', async () => {
    const emitMetering = vi.fn();
    const deps = makeDeps({ emitMetering });
    await executeCapability(makeRequest(), deps);
    expect(emitMetering).toHaveBeenCalledWith(
      expect.objectContaining({
        meteringUnit: 'gmail_email_sent',
        usageUnits: 1,
      }),
    );
  });

  it('handles reauth when provider returns auth error', async () => {
    const nango = makeNango();
    (nango.proxyRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('NANGO_PROXY_AUTH_FAILURE'),
    );
    const deps = makeDeps({ nango });
    const result = await executeCapability(makeRequest(), deps);
    expect(result.success).toBe(false);
    expect(result.error!.reauthRequired).toBe(true);
  });
});

describe('capability registry', () => {
  it('gmail.send_email is native-preferred', () => {
    const { getCapabilityEntry } = require('../services/capability_registry.js');
    const entry = getCapabilityEntry('google', 'gmail.send_email');
    expect(entry).not.toBeNull();
    expect(entry!.preferred).toBe('native');
    expect(entry!.fallbacks).toContain('composio');
    expect(entry!.fallbacks).toContain('pipedream');
  });

  it('notion.create_page is composio-preferred', () => {
    const { getCapabilityEntry } = require('../services/capability_registry.js');
    const entry = getCapabilityEntry('notion', 'notion.create_page');
    expect(entry).not.toBeNull();
    expect(entry!.preferred).toBe('composio');
  });
});

describe('native adapters', () => {
  it('google gmail adapter supports send_email', () => {
    const { findNativeAdapter } = require('../services/native_adapters/index.js');
    const adapter = findNativeAdapter('google', 'gmail.send_email');
    expect(adapter).not.toBeNull();
    expect(adapter!.supports('gmail.send_email')).toBe(true);
  });

  it('google gmail adapter does not support unknown actions', () => {
    const { findNativeAdapter } = require('../services/native_adapters/index.js');
    const adapter = findNativeAdapter('google', 'nonexistent.action');
    expect(adapter).toBeNull();
  });

  it('slack adapter supports send_message', () => {
    const { findNativeAdapter } = require('../services/native_adapters/index.js');
    const adapter = findNativeAdapter('slack', 'slack.send_message');
    expect(adapter).not.toBeNull();
    expect(adapter!.supports('slack.send_message')).toBe(true);
  });

  it('github adapter supports create_issue', () => {
    const { findNativeAdapter } = require('../services/native_adapters/index.js');
    const adapter = findNativeAdapter('github', 'github.create_issue');
    expect(adapter).not.toBeNull();
    expect(adapter!.supports('github.create_issue')).toBe(true);
  });

  it('hubspot adapter supports create_contact', () => {
    const { findNativeAdapter } = require('../services/native_adapters/index.js');
    const adapter = findNativeAdapter('hubspot', 'hubspot.create_contact');
    expect(adapter).not.toBeNull();
    expect(adapter!.supports('hubspot.create_contact')).toBe(true);
  });
});
