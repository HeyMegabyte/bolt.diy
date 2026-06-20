import { createSite } from '../services/site_create';
import { dbInsert } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';
import { trackSite } from '../lib/posthog.js';
import { tryEmitEvent } from '../services/emit_event.js';

/**
 * The site-creation core extracted from POST /api/sites (so the claim funnel can
 * reuse it). Mocks the side-effect deps (db insert / audit / posthog / bus emit)
 * — all src-sibling module mocks, which @swc/jest intercepts in src/__tests__.
 */
jest.mock('../services/db.js', () => ({ dbInsert: jest.fn() }));
jest.mock('../services/audit.js', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../lib/posthog.js', () => ({ trackSite: jest.fn() }));
jest.mock('../services/emit_event.js', () => ({ tryEmitEvent: jest.fn() }));

const mockInsert = dbInsert as jest.Mock;
const mockAudit = writeAuditLog as jest.Mock;
const mockTrack = trackSite as jest.Mock;
const mockEmit = tryEmitEvent as jest.Mock;

const env = { DB: {} } as never;
const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockAudit.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue({ inserted: true });
});

describe('createSite', () => {
  it('inserts a draft site row with the resolved fields + a uuid id', async () => {
    const site = await createSite(env, {
      orgId: 'org-1',
      slug: 'acme',
      businessName: 'Acme Plumbing',
      businessPhone: '+1973',
      businessAddress: '1 Main St',
      googlePlaceId: 'place-9',
    });
    expect(site.status).toBe('draft');
    expect(site.org_id).toBe('org-1');
    expect(site.slug).toBe('acme');
    expect(site.business_name).toBe('Acme Plumbing');
    expect(site.business_phone).toBe('+1973');
    expect(site.business_address).toBe('1 Main St');
    expect(site.google_place_id).toBe('place-9');
    expect(typeof site.id).toBe('string');
    expect(site.id.length).toBeGreaterThan(0);

    const [, table, row] = mockInsert.mock.calls[0];
    expect(table).toBe('sites');
    expect(row).toEqual(
      expect.objectContaining({ org_id: 'org-1', slug: 'acme', status: 'draft' }),
    );
  });

  it('nulls absent optional fields', async () => {
    const site = await createSite(env, { orgId: 'o', slug: 's', businessName: 'B' });
    expect(site.business_phone).toBeNull();
    expect(site.business_email).toBeNull();
    expect(site.business_address).toBeNull();
    expect(site.google_place_id).toBeNull();
  });

  it('writes a site.created audit log with the site id + actor', async () => {
    const site = await createSite(
      env,
      { orgId: 'org-1', slug: 'acme', businessName: 'Acme' },
      { actorId: 'user-1', requestId: 'req-1' },
    );
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const entry = mockAudit.mock.calls[0][1];
    expect(entry).toEqual(
      expect.objectContaining({
        org_id: 'org-1',
        actor_id: 'user-1',
        action: 'site.created',
        target_type: 'site',
        target_id: site.id,
        request_id: 'req-1',
      }),
    );
  });

  it('throws BAD_REQUEST when the insert fails (slug collision)', async () => {
    mockInsert.mockResolvedValue({ error: 'UNIQUE constraint failed: sites.slug' });
    await expect(
      createSite(env, { orgId: 'o', slug: 'taken', businessName: 'B' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // audit + posthog never fire on a failed insert.
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('fires PostHog created only when an executionCtx is present', async () => {
    await createSite(env, { orgId: 'o', slug: 's', businessName: 'B' }); // no ctx
    expect(mockTrack).not.toHaveBeenCalled();

    await createSite(env, { orgId: 'o', slug: 's', businessName: 'B' }, { executionCtx: execCtx });
    expect(mockTrack).toHaveBeenCalledTimes(1);
    const [, , action] = mockTrack.mock.calls[0];
    expect(action).toBe('created');
  });

  it('emits site.created onto the bus with the site id + tenant', async () => {
    const site = await createSite(
      env,
      { orgId: 'org-1', slug: 'acme', businessName: 'Acme' },
      { actorId: 'user-1', requestId: 'req-1' },
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const [, input, deps] = mockEmit.mock.calls[0];
    expect(input).toEqual(
      expect.objectContaining({
        type: 'site.created',
        producer: 'worker',
        tenantId: 'org-1',
        siteId: site.id,
        userId: 'user-1',
        traceId: 'req-1',
      }),
    );
    expect(input.data).toEqual({ slug: 'acme', businessName: 'Acme' });
    expect(deps).toEqual({ scope: [site.id] });
  });

  it('does NOT emit site.created when the insert fails', async () => {
    mockInsert.mockResolvedValue({ error: 'UNIQUE constraint failed: sites.slug' });
    await expect(
      createSite(env, { orgId: 'o', slug: 'taken', businessName: 'B' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('a PostHog throw never blocks creation', async () => {
    mockTrack.mockImplementation(() => {
      throw new Error('posthog down');
    });
    const site = await createSite(
      env,
      { orgId: 'o', slug: 's', businessName: 'B' },
      { executionCtx: execCtx },
    );
    expect(site.status).toBe('draft'); // still returned
  });
});
