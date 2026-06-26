/**
 * Unit tests for the Pulse Social AI campaign generator
 * ({@link services/social_campaign}).
 *
 * The PURE planner ({@link planCampaign}) is tested exhaustively with no mocks
 * — it has no I/O and takes the start date as input, so it is fully
 * deterministic. The orchestrator ({@link generateCampaignDrafts}) is tested
 * with an injected `contentFn` (no LLM) + a hand-rolled D1 stub (no module
 * mocking — avoids the @swc/jest hoist pitfall).
 */
import type { Env } from '../types/env.js';
import {
  planCampaign,
  generateCampaignDrafts,
  loadCampaignPrefill,
  CampaignSpecSchema,
  CAMPAIGN_POST_TYPES,
  type CampaignSpec,
  type CampaignSignals,
} from '../services/social_campaign.js';

const baseSpec: CampaignSpec = {
  length: 7,
  start_date: '2026-07-01',
  posts_per_week: 5,
  account_ids: ['acct-1'],
};

const richSignals: CampaignSignals = {
  business_name: 'Vito Salon',
  services: ['Haircut', 'Beard Trim', 'Hot Towel Shave'],
  has_reviews: true,
  has_photos: true,
  has_offers: true,
  area_name: 'Lake Hiawatha',
};

const thinSignals: CampaignSignals = {
  business_name: 'Solo Shop',
  services: [],
  has_reviews: false,
  has_photos: false,
  has_offers: false,
};

describe('planCampaign — slot count + cadence', () => {
  it('7-day @ 5/wk → 5 slots', () => {
    expect(planCampaign(baseSpec, richSignals).slot_count).toBe(5);
  });

  it('30-day @ 4/wk → 17 slots', () => {
    const plan = planCampaign({ ...baseSpec, length: 30, posts_per_week: 4 }, richSignals);
    expect(plan.slot_count).toBe(17);
    expect(plan.slots).toHaveLength(17);
  });

  it('14-day with default cadence (5/wk) → 10 slots', () => {
    const { posts_per_week: _omit, ...noPpw } = baseSpec;
    const plan = planCampaign({ ...noPpw, length: 14 }, richSignals);
    expect(plan.slot_count).toBe(10);
  });

  it('clamps an out-of-range cadence into 1..7', () => {
    const plan = planCampaign({ ...baseSpec, posts_per_week: 99 as unknown as 7 }, richSignals);
    // 7-day @ 7/wk → 7
    expect(plan.slot_count).toBe(7);
  });
});

describe('planCampaign — dates', () => {
  it('first slot lands on the start date and dates are non-decreasing + in-range', () => {
    const plan = planCampaign({ ...baseSpec, length: 30, posts_per_week: 4 }, richSignals);
    expect(plan.slots[0].date).toBe('2026-07-01');
    const start = Date.parse('2026-07-01T00:00:00.000Z');
    let prev = -Infinity;
    for (const s of plan.slots) {
      const d = Date.parse(`${s.date}T00:00:00.000Z`);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThan(start + 30 * 86_400_000);
      prev = d;
    }
  });

  it('accepts a full ISO start_date as well as a date-only one', () => {
    const plan = planCampaign({ ...baseSpec, start_date: '2026-07-01T12:34:56.000Z' }, richSignals);
    expect(plan.slots[0].date).toBe('2026-07-01');
  });
});

describe('planCampaign — determinism', () => {
  it('same inputs → identical plan', () => {
    const a = planCampaign(baseSpec, richSignals);
    const b = planCampaign(baseSpec, richSignals);
    expect(a).toEqual(b);
  });
});

describe('planCampaign — signal gating', () => {
  it('omits archetypes whose signals are absent', () => {
    const plan = planCampaign({ ...baseSpec, length: 30, posts_per_week: 7 }, thinSignals);
    const types = new Set(plan.slots.map((s) => s.post_type));
    expect(types.has('service_spotlight')).toBe(false); // no services
    expect(types.has('review_social_proof')).toBe(false); // no reviews
    expect(types.has('before_after')).toBe(false); // no photos
    expect(types.has('seasonal_offer')).toBe(false); // no offers
    expect(types.has('local_event')).toBe(false); // no area
    // Always-on base pool is still present.
    expect(types.has('gbp_update')).toBe(true);
  });

  it('leads with service_spotlight when services exist and rotates them', () => {
    const plan = planCampaign({ ...baseSpec, length: 30, posts_per_week: 7 }, richSignals);
    expect(plan.slots[0].post_type).toBe('service_spotlight');
    const spotlightAngles = plan.slots
      .filter((s) => s.post_type === 'service_spotlight')
      .map((s) => s.angle);
    // With 3 services and multiple spotlights, more than one service is referenced.
    const referenced = new Set(
      spotlightAngles.map((a) => richSignals.services.find((svc) => a.includes(svc))),
    );
    expect(referenced.size).toBeGreaterThan(1);
  });

  it('never emits two identical archetypes back-to-back when the pool allows', () => {
    const plan = planCampaign({ ...baseSpec, length: 30, posts_per_week: 7 }, richSignals);
    for (let i = 1; i < plan.slots.length; i++) {
      expect(plan.slots[i].post_type).not.toBe(plan.slots[i - 1].post_type);
    }
  });
});

describe('planCampaign — slot shape', () => {
  it('every slot has a non-empty angle, a known type, and ≤3 hashtags', () => {
    const plan = planCampaign({ ...baseSpec, length: 30 }, richSignals);
    for (const s of plan.slots) {
      expect(s.angle.length).toBeGreaterThan(10);
      expect(CAMPAIGN_POST_TYPES).toContain(s.post_type);
      expect(s.hashtags.length).toBeGreaterThan(0);
      expect(s.hashtags.length).toBeLessThanOrEqual(3);
      expect(s.hashtags.every((h) => !h.startsWith('#'))).toBe(true);
    }
  });
});

describe('CampaignSpecSchema', () => {
  it('accepts a valid spec', () => {
    expect(CampaignSpecSchema.safeParse(baseSpec).success).toBe(true);
  });

  it('rejects an unknown length', () => {
    expect(CampaignSpecSchema.safeParse({ ...baseSpec, length: 21 }).success).toBe(false);
  });

  it('rejects empty account_ids', () => {
    expect(CampaignSpecSchema.safeParse({ ...baseSpec, account_ids: [] }).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    expect(CampaignSpecSchema.safeParse({ ...baseSpec, sneaky: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface CapturedInsert {
  sql: string;
  vals: unknown[];
}

function fakeEnv(captured: CapturedInsert[]): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: (...vals: unknown[]) => ({
        run: async () => {
          captured.push({ sql, vals });
          return { success: true, meta: {} };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
  };
  return { DB: db } as unknown as Env;
}

describe('generateCampaignDrafts — orchestration', () => {
  it('creates one draft pulse_posts row per slot via the injected content fn', async () => {
    const captured: CapturedInsert[] = [];
    const env = fakeEnv(captured);
    const contentFn = jest.fn(async () => ({ text: 'Fresh fades all week.' }));

    const { plan, drafts } = await generateCampaignDrafts(
      env,
      'org-1',
      'user-1',
      baseSpec,
      richSignals,
      { contentFn },
    );

    expect(drafts).toHaveLength(plan.slot_count);
    expect(contentFn).toHaveBeenCalledTimes(plan.slot_count);
    expect(captured).toHaveLength(plan.slot_count);
    // Every insert targets pulse_posts as a draft.
    for (const ins of captured) {
      expect(ins.sql).toContain('INSERT INTO pulse_posts');
      expect(ins.vals).toContain('draft');
    }
    for (const d of drafts) {
      expect(typeof d.id).toBe('string');
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('skips a slot whose generation throws but persists the rest', async () => {
    const captured: CapturedInsert[] = [];
    const env = fakeEnv(captured);
    let call = 0;
    const contentFn = jest.fn(async () => {
      call++;
      if (call === 2) throw new Error('LLM 429');
      return { text: 'ok' };
    });

    const { plan, drafts } = await generateCampaignDrafts(
      env,
      'org-1',
      'user-1',
      baseSpec,
      richSignals,
      { contentFn },
    );

    expect(drafts).toHaveLength(plan.slot_count - 1);
    expect(captured).toHaveLength(plan.slot_count - 1);
  });
});

function fakeEnvWithSite(row: unknown): Env {
  const db = {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
        run: async () => ({ success: true, meta: {} }),
        // dbQueryOne → dbQuery → .all().results[0]
        all: async () => ({ results: row ? [row] : [] }),
      }),
    }),
  };
  return { DB: db } as unknown as Env;
}

describe('loadCampaignPrefill', () => {
  it('derives business_name + the city segment from a full street address', async () => {
    const env = fakeEnvWithSite({
      business_name: "Vito's Salon",
      business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
    });
    const pre = await loadCampaignPrefill(env, 'org-1');
    expect(pre.business_name).toBe("Vito's Salon");
    expect(pre.area_name).toBe('Lake Hiawatha');
  });

  it('uses the first segment for a 2-part "city, state" address', async () => {
    const env = fakeEnvWithSite({ business_name: 'X', business_address: 'Newark, NJ' });
    const pre = await loadCampaignPrefill(env, 'org-1');
    expect(pre.area_name).toBe('Newark');
  });

  it('returns an empty business_name + no area when the org has no site', async () => {
    const env = fakeEnvWithSite(null);
    const pre = await loadCampaignPrefill(env, 'org-1');
    expect(pre.business_name).toBe('');
    expect(pre.area_name).toBeUndefined();
    expect(pre.services).toEqual([]);
    expect(pre.has_photos).toBe(false);
  });
});

/** SQL-aware stub: returns a distinct row per queried table. */
function fakeEnvResearch(opts: { site?: unknown; profile?: unknown; images?: unknown }): Env {
  const rowFor = (sql: string): unknown => {
    if (/research_profile/.test(sql)) return opts.profile ?? null;
    if (/research_images/.test(sql)) return opts.images ?? null;
    if (/FROM sites/.test(sql)) return opts.site ?? null;
    return null;
  };
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => rowFor(sql),
        run: async () => ({ success: true, meta: {} }),
        all: async () => {
          const r = rowFor(sql);
          return { results: r ? [r] : [] };
        },
      }),
    }),
  };
  return { DB: db } as unknown as Env;
}

describe('loadCampaignPrefill — research-derived signals', () => {
  it('pulls services from research_profile + detects photos from research_images', async () => {
    const env = fakeEnvResearch({
      site: { id: 's1', business_name: 'Vito Salon', business_address: '1 Main St, Newark, NJ' },
      profile: { parsed_output: JSON.stringify({ services: ['Haircut', 'Shave', '  '] }) },
      images: { parsed_output: JSON.stringify({ hero_images: [{ url: 'x' }] }) },
    });
    const pre = await loadCampaignPrefill(env, 'org-1');
    expect(pre.services).toEqual(['Haircut', 'Shave']); // blank entry filtered out
    expect(pre.has_photos).toBe(true);
    expect(pre.business_name).toBe('Vito Salon');
  });

  it('degrades to no services / no photos on uncertain or empty research JSON', async () => {
    const env = fakeEnvResearch({
      site: { id: 's1', business_name: 'X', business_address: 'Y' },
      profile: { parsed_output: 'definitely not json' },
      images: { parsed_output: JSON.stringify({ gallery: [] }) },
    });
    const pre = await loadCampaignPrefill(env, 'org-1');
    expect(pre.services).toEqual([]);
    expect(pre.has_photos).toBe(false);
  });

  it('skips research lookups entirely when the site row has no id', async () => {
    const env = fakeEnvResearch({ site: { business_name: 'NoId', business_address: 'A, B, C' } });
    const pre = await loadCampaignPrefill(env, 'org-1');
    expect(pre.services).toEqual([]);
    expect(pre.has_photos).toBe(false);
    expect(pre.business_name).toBe('NoId');
  });
});
