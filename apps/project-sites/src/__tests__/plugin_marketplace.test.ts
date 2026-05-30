/**
 * Unit tests for the Plugin / Integration Marketplace service (IDEAS-50 #41).
 *
 * Covers:
 *   - computePluginRevenueSplit pure function (70/30)
 *   - PluginManifestSchema validates hooks + env vars + scripts
 *   - submitPlugin enforces slug uniqueness and lands as 'pending'
 *   - installPlugin requires payment for paid plugins, computes split
 *   - listSiteInstalls + uninstallPlugin state machine
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbExecute, dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import {
  getPlugin,
  installPlugin,
  listPlugins,
  listSiteInstalls,
  siteOrgId,
  submitPlugin,
  uninstallPlugin,
} from '../services/plugin_marketplace.js';
import {
  computePluginRevenueSplit,
  PluginInstallInputSchema,
  PluginManifestSchema,
  PluginSubmissionSchema,
  PLUGIN_CREATOR_BPS,
  PLUGIN_PLATFORM_BPS,
} from '../../libs/features/plugin_marketplace/feature.schemas.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

function makeEnv(): any {
  return { DB: {} as D1Database };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
  mockExecute.mockResolvedValue({ error: null, changes: 1 });
});

// ---------------------------------------------------------------------------
// Revenue split
// ---------------------------------------------------------------------------
describe('computePluginRevenueSplit', () => {
  it('splits 10000 cents as 7000/3000', () => {
    const split = computePluginRevenueSplit(10_000);
    expect(split.creator_share_cents).toBe(7_000);
    expect(split.platform_share_cents).toBe(3_000);
  });

  it('handles 0-priced plugins', () => {
    const split = computePluginRevenueSplit(0);
    expect(split.creator_share_cents).toBe(0);
    expect(split.platform_share_cents).toBe(0);
  });

  it('sum equals input for odd values', () => {
    const split = computePluginRevenueSplit(9_999);
    expect(split.creator_share_cents + split.platform_share_cents).toBe(9_999);
  });

  it('rejects negative inputs', () => {
    expect(() => computePluginRevenueSplit(-100)).toThrow(RangeError);
  });

  it('exposes 70/30 constants', () => {
    expect(PLUGIN_CREATOR_BPS).toBe(7000);
    expect(PLUGIN_PLATFORM_BPS).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------
describe('PluginManifestSchema', () => {
  it('accepts minimal valid manifest', () => {
    const result = PluginManifestSchema.safeParse({ version: '1.0' });
    expect(result.success).toBe(true);
  });

  it('accepts manifest with hooks + env vars + scripts', () => {
    const result = PluginManifestSchema.safeParse({
      version: '1.0',
      hooks: [{ phase: 'post-build', script: 'hooks/install.js' }],
      env_vars: [{ name: 'STRIPE_KEY', required: true, description: 'Stripe secret key' }],
      scripts: [{ position: 'head', src: 'https://cdn.example.com/sdk.js', defer: true }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects bad env var name (lowercase)', () => {
    const result = PluginManifestSchema.safeParse({
      version: '1.0',
      env_vars: [{ name: 'stripe_key', required: true, description: 'wrong case' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad script src (non-URL)', () => {
    const result = PluginManifestSchema.safeParse({
      version: '1.0',
      scripts: [{ position: 'head', src: 'javascript:alert(1)' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown manifest version', () => {
    const result = PluginManifestSchema.safeParse({ version: '2.0' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// submitPlugin
// ---------------------------------------------------------------------------
describe('submitPlugin', () => {
  const validSubmission = {
    slug: 'stripe-checkout',
    name: 'Stripe Checkout',
    description: 'One-click Stripe Checkout integration for any site.',
    category: 'payments' as const,
    manifest: {
      version: '1.0' as const,
      hooks: [],
      env_vars: [
        { name: 'STRIPE_PUBLISHABLE_KEY', required: true, description: 'Publishable key' },
      ],
      scripts: [
        { position: 'head' as const, src: 'https://js.stripe.com/v3/', defer: false, async: false },
      ],
      permissions: [],
    },
    price_cents: 1_900,
  };

  it('lands as pending', async () => {
    const env = makeEnv();
    const result = await submitPlugin(env, validSubmission, 'usr_creator_1');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('pending');
    expect(mockInsert).toHaveBeenCalledWith(
      env.DB,
      'plugins',
      expect.objectContaining({
        slug: 'stripe-checkout',
        creator_user_id: 'usr_creator_1',
        status: 'pending',
        install_count: 0,
      }),
    );
  });

  it('throws SLUG_TAKEN on conflict', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'plg_existing' });
    const env = makeEnv();
    await expect(submitPlugin(env, validSubmission, 'usr_creator_1')).rejects.toThrow('SLUG_TAKEN');
  });
});

// ---------------------------------------------------------------------------
// installPlugin
// ---------------------------------------------------------------------------
describe('installPlugin', () => {
  const livePlugin = {
    id: 'plg_stripe',
    slug: 'stripe-checkout',
    name: 'Stripe Checkout',
    description: 'One-click Stripe Checkout integration.',
    creator_user_id: 'usr_creator',
    category: 'payments' as const,
    manifest_json: '{"version":"1.0","hooks":[],"env_vars":[],"scripts":[],"permissions":[]}',
    price_cents: 1_900,
    install_count: 5,
    sales_count: 4,
    total_revenue_cents: 7_600,
    rating_avg: 4.7,
    rating_count: 3,
    status: 'live' as const,
    thumbnail_url: null,
    repository_url: null,
    created_at: '2026-05-20T00:00:00Z',
    updated_at: null,
  };

  it('installs a paid plugin with payment + records 70/30 split', async () => {
    mockQueryOne.mockResolvedValueOnce(livePlugin); // getPlugin
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org_42' }); // siteOrgId — owned
    const env = makeEnv();
    const result = await installPlugin(
      env,
      {
        plugin_id: 'plg_stripe',
        site_id: 'site_42',
        config: { mode: 'live' },
        stripe_payment_intent: 'pi_live_001',
      },
      'usr_installer',
      'org_42',
    );
    expect(result.creator_share_cents).toBe(1_330);
    expect(result.platform_share_cents).toBe(570);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('rejects paid plugin without payment intent', async () => {
    mockQueryOne.mockResolvedValueOnce(livePlugin);
    const env = makeEnv();
    await expect(
      installPlugin(
        env,
        { plugin_id: 'plg_stripe', site_id: 'site_42', config: {} },
        'usr_installer',
        'org_42',
      ),
    ).rejects.toThrow('PAYMENT_REQUIRED');
  });

  it('rejects when plugin is pending (not live)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...livePlugin, status: 'pending' });
    const env = makeEnv();
    await expect(
      installPlugin(
        env,
        { plugin_id: 'plg_x', site_id: 'site_42', config: {}, stripe_payment_intent: 'pi_x' },
        'usr_installer',
        'org_42',
      ),
    ).rejects.toThrow('PLUGIN_NOT_LIVE');
  });

  it('installs free plugin without payment intent', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...livePlugin, price_cents: 0 }); // getPlugin
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org_42' }); // siteOrgId — owned
    const env = makeEnv();
    const result = await installPlugin(
      env,
      { plugin_id: 'plg_free', site_id: 'site_42', config: {} },
      'usr_installer',
      'org_42',
    );
    expect(result.price_paid_cents).toBe(0);
    expect(result.creator_share_cents).toBe(0);
  });

  it('rejects installing onto a site owned by another org (tenant isolation)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...livePlugin, price_cents: 0 }); // getPlugin
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' }); // siteOrgId — foreign
    const env = makeEnv();
    await expect(
      installPlugin(
        env,
        { plugin_id: 'plg_free', site_id: 'site_other', config: {} },
        'usr_installer',
        'org_42',
      ),
    ).rejects.toThrow('SITE_NOT_OWNED');
    expect(mockInsert).not.toHaveBeenCalled(); // blocked before any write
  });

  it('rejects installing onto a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...livePlugin, price_cents: 0 }); // getPlugin
    mockQueryOne.mockResolvedValueOnce(null); // siteOrgId — missing
    const env = makeEnv();
    await expect(
      installPlugin(
        env,
        { plugin_id: 'plg_free', site_id: 'ghost', config: {} },
        'usr_installer',
        'org_42',
      ),
    ).rejects.toThrow('SITE_NOT_OWNED');
  });
});

// ---------------------------------------------------------------------------
// uninstallPlugin
// ---------------------------------------------------------------------------
describe('uninstallPlugin', () => {
  it('marks an install as uninstalled (org owns it)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'plgi_1', org_id: 'org_1', uninstalled_at: null });
    const env = makeEnv();
    const result = await uninstallPlugin(env, 'plgi_1', 'org_1');
    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      env.DB,
      'plugin_installs',
      expect.objectContaining({ uninstalled_at: expect.any(String) }),
      'id = ?',
      ['plgi_1'],
    );
  });

  it('rejects when install missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const env = makeEnv();
    await expect(uninstallPlugin(env, 'plgi_missing', 'org_1')).rejects.toThrow(
      'INSTALL_NOT_FOUND',
    );
  });

  it('rejects cross-org uninstall as not-found (tenant isolation)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'plgi_1', org_id: 'OTHER_ORG', uninstalled_at: null });
    const env = makeEnv();
    await expect(uninstallPlugin(env, 'plgi_1', 'org_1')).rejects.toThrow('INSTALL_NOT_FOUND');
    expect(mockUpdate).not.toHaveBeenCalled(); // never mutated another org's install
  });

  it('rejects when already uninstalled', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'plgi_1',
      org_id: 'org_1',
      uninstalled_at: '2026-05-27T00:00:00Z',
    });
    const env = makeEnv();
    await expect(uninstallPlugin(env, 'plgi_1', 'org_1')).rejects.toThrow('ALREADY_UNINSTALLED');
  });
});

// ---------------------------------------------------------------------------
// listSiteInstalls
// ---------------------------------------------------------------------------
describe('listSiteInstalls', () => {
  it('returns empty list when site has no installs', async () => {
    const env = makeEnv();
    const installs = await listSiteInstalls(env, 'site_empty');
    expect(installs).toEqual([]);
  });

  it('parses config_json into config object', async () => {
    mockQuery.mockResolvedValueOnce({
      data: [
        {
          install_id: 'plgi_1',
          plugin_id: 'plg_stripe',
          plugin_name: 'Stripe',
          plugin_slug: 'stripe-checkout',
          installed_at: '2026-05-27T00:00:00Z',
          config_json: '{"mode":"live","webhook":"https://x.com"}',
        },
      ],
      error: null,
    } as any);
    const env = makeEnv();
    const installs = await listSiteInstalls(env, 'site_42');
    expect(installs[0]?.config).toEqual({ mode: 'live', webhook: 'https://x.com' });
  });
});

// ---------------------------------------------------------------------------
// PluginInstallInputSchema
// ---------------------------------------------------------------------------
describe('PluginInstallInputSchema', () => {
  it('accepts minimal install', () => {
    const result = PluginInstallInputSchema.safeParse({
      plugin_id: 'plg_x',
      site_id: 'site_42',
    });
    expect(result.success).toBe(true);
  });

  it('defaults config to empty object', () => {
    const result = PluginInstallInputSchema.parse({
      plugin_id: 'plg_x',
      site_id: 'site_42',
    });
    expect(result.config).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PluginSubmissionSchema
// ---------------------------------------------------------------------------
describe('PluginSubmissionSchema', () => {
  it('rejects price > $500 cap', () => {
    const result = PluginSubmissionSchema.safeParse({
      slug: 'a',
      name: 'A',
      description: 'too short',
      category: 'payments',
      manifest: { version: '1.0' },
      price_cents: 100_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown category', () => {
    const result = PluginSubmissionSchema.safeParse({
      slug: 'good-slug',
      name: 'Good Name',
      description: 'A long enough description for the marketplace listing.',
      category: 'cryptocurrency',
      manifest: { version: '1.0' },
      price_cents: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listPlugins
// ---------------------------------------------------------------------------
describe('listPlugins', () => {
  it('filters by live status by default', async () => {
    const env = makeEnv();
    await listPlugins(env, {});
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'live'");
  });

  it('includes non-live when includeUnapproved=true', async () => {
    const env = makeEnv();
    await listPlugins(env, { includeUnapproved: true });
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("status = 'live'");
  });
});

// ---------------------------------------------------------------------------
// getPlugin
// ---------------------------------------------------------------------------
describe('getPlugin', () => {
  it('returns null when not found', async () => {
    const env = makeEnv();
    const result = await getPlugin(env, 'plg_missing');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// siteOrgId
// ---------------------------------------------------------------------------
describe('siteOrgId', () => {
  it('returns the owning org for an existing site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org_9' });
    expect(await siteOrgId(makeEnv(), 'site_1')).toBe('org_9');
  });

  it('returns undefined for a missing site', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await siteOrgId(makeEnv(), 'ghost')).toBeUndefined();
  });
});
