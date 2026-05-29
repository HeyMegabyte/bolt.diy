/**
 * Unit tests for the Trust Center feature module (idea #50).
 *
 * Covers:
 *   - Zod schemas + redactor (private fields never leak to public view)
 *   - JSON-LD builder shape (DigitalDocument)
 *   - upsertProfile preserves existing fields when update is partial
 *   - publishOrgProfile stamps published=1 + published_at
 *   - getEffectiveProfileForSite returns site override → org fallback
 */

import {
  TrustProfileSchema,
  TrustProfileUpdateSchema,
  PublicTrustProfileSchema,
  toPublicProfile,
  buildTrustJsonLd,
} from '../../libs/features/trust_center/feature.schemas.js';
import {
  getOrgProfile,
  getSiteProfile,
  getEffectiveProfileForSite,
  upsertProfile,
  publishOrgProfile,
} from '../services/trust_center.js';

// ─── In-memory D1 mock ───────────────────────────────────────────────────────

interface MockRow {
  id: string;
  org_id: string;
  site_id: string | null;
  ai_models_json: string;
  data_residency: string;
  audit_log_policy: string;
  content_provenance: string;
  ai_outage_behavior: string;
  custom_disclosures: string | null;
  published: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function makeEnv() {
  const rows: MockRow[] = [];

  function selectMatching(orgId: string, siteId: string | null): MockRow | null {
    for (const r of rows) {
      if (r.deleted_at !== null) continue;
      if (r.org_id !== orgId) continue;
      if (siteId === null && r.site_id === null) return r;
      if (siteId !== null && r.site_id === siteId) return r;
    }
    return null;
  }

  function makePrepared(sql: string) {
    let bindings: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bindings = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (/FROM trust_profiles/.test(sql)) {
          const orgId = bindings[0] as string;
          const siteIdArg = bindings[1] as string | null;
          const row = selectMatching(orgId, siteIdArg);
          return (row as unknown as T) ?? null;
        }
        return null;
      },
      async run() {
        if (/^INSERT INTO trust_profiles/.test(sql.trim())) {
          const [
            id,
            org_id,
            site_id,
            ai_models_json,
            data_residency,
            audit_log_policy,
            content_provenance,
            ai_outage_behavior,
            custom_disclosures,
            published,
            published_at,
          ] = bindings as [
            string,
            string,
            string | null,
            string,
            string,
            string,
            string,
            string,
            string | null,
            number,
            string | null,
          ];
          const existing = selectMatching(org_id, site_id);
          const now = new Date().toISOString();
          if (existing) {
            existing.ai_models_json = ai_models_json;
            existing.data_residency = data_residency;
            existing.audit_log_policy = audit_log_policy;
            existing.content_provenance = content_provenance;
            existing.ai_outage_behavior = ai_outage_behavior;
            existing.custom_disclosures = custom_disclosures;
            existing.updated_at = now;
          } else {
            rows.push({
              id,
              org_id,
              site_id,
              ai_models_json,
              data_residency,
              audit_log_policy,
              content_provenance,
              ai_outage_behavior,
              custom_disclosures,
              published,
              published_at,
              created_at: now,
              updated_at: now,
              deleted_at: null,
            });
          }
          return { success: true, meta: { last_row_id: 1 } };
        }
        if (/^UPDATE trust_profiles/.test(sql.trim())) {
          // publishOrgProfile path
          const [stampedAt, id] = bindings as [string, string];
          const row = rows.find((r) => r.id === id);
          if (row) {
            row.published = 1;
            row.published_at = row.published_at ?? stampedAt;
            row.updated_at = new Date().toISOString();
          }
          return { success: true, meta: {} };
        }
        return { success: true, meta: {} };
      },
    };
    return stmt;
  }

  const env = {
    DB: {
      prepare: (sql: string) => makePrepared(sql),
    } as unknown as D1Database,
  };
  return { env, rows };
}

// ─── Schema + redactor ───────────────────────────────────────────────────────

describe('trust_center schemas', () => {
  test('TrustProfileUpdateSchema accepts a partial', () => {
    const parsed = TrustProfileUpdateSchema.parse({
      data_residency: 'eu',
    });
    expect(parsed.data_residency).toBe('eu');
    expect(parsed.ai_models).toBeUndefined();
  });

  test('TrustProfileUpdateSchema rejects bad enum', () => {
    expect(() =>
      TrustProfileUpdateSchema.parse({ data_residency: 'mars' as never }),
    ).toThrow();
  });

  test('toPublicProfile redacts private surface', () => {
    const fullProfile = TrustProfileSchema.parse({
      id: 'prof-1',
      org_id: 'org-1',
      site_id: 'site-1',
      ai_models: [
        {
          vendor: 'Anthropic',
          model: 'claude-opus-4-7',
          purpose: 'Content polish',
        },
      ],
      data_residency: 'eu',
      audit_log_policy: 'self-serve',
      content_provenance: [],
      ai_outage_behavior: 'graceful-degradation',
      custom_disclosures: 'Public-ok markdown',
      published: true,
      published_at: '2026-05-28T00:00:00Z',
      updated_at: '2026-05-28T00:00:00Z',
    });
    const pub = toPublicProfile(fullProfile, 'vito-mens-salon');
    expect(pub.site_slug).toBe('vito-mens-salon');
    expect(pub.data_residency).toBe('eu');
    // Internal fields must not be present
    expect((pub as Record<string, unknown>).id).toBeUndefined();
    expect((pub as Record<string, unknown>).org_id).toBeUndefined();
    expect((pub as Record<string, unknown>).updated_at).toBeUndefined();
    // Public schema must validate the output
    expect(() => PublicTrustProfileSchema.parse(pub)).not.toThrow();
  });
});

describe('buildTrustJsonLd', () => {
  test('emits DigitalDocument shape', () => {
    const pub = toPublicProfile(
      TrustProfileSchema.parse({
        id: 'prof-1',
        org_id: 'org-1',
        site_id: null,
        ai_models: [],
        data_residency: 'global',
        audit_log_policy: 'on-request',
        content_provenance: [],
        ai_outage_behavior: 'graceful-degradation',
        custom_disclosures: null,
        published: true,
        published_at: '2026-05-28T00:00:00Z',
        updated_at: '2026-05-28T00:00:00Z',
      }),
      'vito',
    );
    const ld = buildTrustJsonLd(pub, {
      siteUrl: 'https://vito.projectsites.dev/',
      businessName: "Vito's Mens Salon",
    });
    expect(ld['@type']).toBe('DigitalDocument');
    expect(ld['url']).toBe('https://vito.projectsites.dev/trust');
    expect(ld['name']).toContain("Vito");
    expect((ld['publisher'] as Record<string, unknown>)['@type']).toBe(
      'Organization',
    );
  });
});

// ─── Service-level ───────────────────────────────────────────────────────────

describe('trust_center service', () => {
  test('upsertProfile creates org-level profile when missing', async () => {
    const { env } = makeEnv();
    const profile = await upsertProfile(env as never, {
      orgId: 'org-1',
      siteId: null,
      update: {
        ai_models: [
          {
            vendor: 'Cloudflare',
            model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            purpose: 'Site generation',
          },
        ],
        data_residency: 'us',
      },
    });
    expect(profile.org_id).toBe('org-1');
    expect(profile.site_id).toBeNull();
    expect(profile.ai_models).toHaveLength(1);
    expect(profile.data_residency).toBe('us');
    // Defaults preserved
    expect(profile.audit_log_policy).toBe('on-request');
    expect(profile.ai_outage_behavior).toBe('graceful-degradation');
    expect(profile.published).toBe(false);
  });

  test('upsertProfile preserves existing fields on partial update', async () => {
    const { env } = makeEnv();
    await upsertProfile(env as never, {
      orgId: 'org-2',
      siteId: null,
      update: {
        data_residency: 'eu',
        audit_log_policy: 'self-serve',
      },
    });
    const updated = await upsertProfile(env as never, {
      orgId: 'org-2',
      siteId: null,
      update: { ai_outage_behavior: 'queue-and-retry' },
    });
    expect(updated.data_residency).toBe('eu');
    expect(updated.audit_log_policy).toBe('self-serve');
    expect(updated.ai_outage_behavior).toBe('queue-and-retry');
  });

  test('publishOrgProfile flips published=1 + stamps published_at; second call is idempotent', async () => {
    const { env } = makeEnv();
    await upsertProfile(env as never, {
      orgId: 'org-3',
      siteId: null,
      update: { data_residency: 'eu' },
    });
    const first = await publishOrgProfile(env as never, 'org-3');
    expect(first?.published).toBe(true);
    expect(first?.published_at).toBeTruthy();
    const second = await publishOrgProfile(env as never, 'org-3');
    expect(second?.published_at).toBe(first?.published_at);
  });

  test('publishOrgProfile returns null when no profile exists', async () => {
    const { env } = makeEnv();
    const result = await publishOrgProfile(env as never, 'missing-org');
    expect(result).toBeNull();
  });

  test('getEffectiveProfileForSite prefers site override over org-level', async () => {
    const { env } = makeEnv();
    await upsertProfile(env as never, {
      orgId: 'org-4',
      siteId: null,
      update: { data_residency: 'global' },
    });
    await upsertProfile(env as never, {
      orgId: 'org-4',
      siteId: 'site-7',
      update: { data_residency: 'eu' },
    });
    const effective = await getEffectiveProfileForSite(
      env as never,
      'org-4',
      'site-7',
    );
    expect(effective?.data_residency).toBe('eu');
    expect(effective?.site_id).toBe('site-7');
  });

  test('getEffectiveProfileForSite falls back to org-level when no override', async () => {
    const { env } = makeEnv();
    await upsertProfile(env as never, {
      orgId: 'org-5',
      siteId: null,
      update: { data_residency: 'apac' },
    });
    const effective = await getEffectiveProfileForSite(
      env as never,
      'org-5',
      'site-without-override',
    );
    expect(effective?.data_residency).toBe('apac');
    expect(effective?.site_id).toBeNull();
  });

  test('getOrgProfile / getSiteProfile return null when missing', async () => {
    const { env } = makeEnv();
    expect(await getOrgProfile(env as never, 'nobody')).toBeNull();
    expect(await getSiteProfile(env as never, 'nobody', 'nope')).toBeNull();
  });
});
