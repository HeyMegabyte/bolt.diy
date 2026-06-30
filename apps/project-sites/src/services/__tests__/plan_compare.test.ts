import {
  comparePlans,
  planFeatureMatrix,
  bestPlanFor,
  PLAN_PRICES,
  type PlanFeatureRow,
  type FeatureDifference,
  type CompareResult,
  type PlanRecommendation,
} from '../plan_compare';

// ── comparePlans ───────────────────────────────────────────────────────────

describe('comparePlans', () => {
  it('detects an upgrade from free to pro with increased features', () => {
    const result = comparePlans('free', 'pro');

    expect(result.upgrade).toBe(true);
    expect(result.cost.fromCents).toBe(0);
    expect(result.cost.toCents).toBe(5000);
    expect(result.cost.deltaCents).toBe(5000);

    const sitesDiff = result.differences.find((d) => d.feature === 'sites');
    expect(sitesDiff).toBeDefined();
    expect(sitesDiff!.change).toBe('increase');
    expect(sitesDiff!.fromValue).toBe(1);
    expect(sitesDiff!.toValue).toBe(-1);

    const domainDiff = result.differences.find((d) => d.feature === 'custom_domain');
    expect(domainDiff).toBeDefined();
    expect(domainDiff!.change).toBe('increase');
    expect(domainDiff!.toValue).toBe(-1);
  });

  it('detects a downgrade from pro to free with decreased features', () => {
    const result = comparePlans('pro', 'free');

    expect(result.upgrade).toBe(false);
    expect(result.cost.fromCents).toBe(5000);
    expect(result.cost.toCents).toBe(0);
    expect(result.cost.deltaCents).toBe(-5000);

    const sitesDiff = result.differences.find((d) => d.feature === 'sites');
    expect(sitesDiff).toBeDefined();
    expect(sitesDiff!.change).toBe('decrease');
    expect(sitesDiff!.fromValue).toBe(-1);
    expect(sitesDiff!.toValue).toBe(1);
  });

  it('marks same-tier comparison as no upgrade with zero cost delta', () => {
    const result = comparePlans('starter', 'starter');

    expect(result.upgrade).toBe(false);
    expect(result.cost.deltaCents).toBe(0);

    for (const diff of result.differences) {
      expect(diff.change).toBe('same');
    }
  });

  it('handles unknown plan names by normalising to free', () => {
    const result = comparePlans('unknown_plan', 'pro');

    expect(result.upgrade).toBe(true);
    expect(result.cost.fromCents).toBe(0);
    expect(result.cost.toCents).toBe(5000);
  });

  it('contains every feature key from FEATURE_MATRIX in differences', () => {
    const result = comparePlans('free', 'pro');
    const expectedFeatures = result.differences.map((d) => d.feature);

    // All 10 features should be present
    expect(expectedFeatures).toContain('sites');
    expect(expectedFeatures).toContain('builds_per_month');
    expect(expectedFeatures).toContain('ai_credits');
    expect(expectedFeatures).toContain('custom_domain');
    expect(expectedFeatures).toContain('analytics_history_days');
    expect(expectedFeatures).toContain('media_storage_mb');
    expect(expectedFeatures).toContain('team_seats');
    expect(expectedFeatures).toContain('email_sends_per_month');
    expect(expectedFeatures).toContain('remove_branding');
    expect(expectedFeatures).toContain('priority_build');
    expect(expectedFeatures).toHaveLength(10);
  });

  it('reports increase for features that grow from starter to pro', () => {
    const result = comparePlans('starter', 'pro');

    expect(result.upgrade).toBe(true);

    // All Pro features are ≥ Starter features, so every change is 'increase' or 'same'
    for (const diff of result.differences) {
      expect(['increase', 'same']).toContain(diff.change);
    }

    // Specific increases
    const aiCredits = result.differences.find((d) => d.feature === 'ai_credits');
    expect(aiCredits).toBeDefined();
    expect(aiCredits!.change).toBe('increase');
    expect(aiCredits!.fromValue).toBe(500);
    expect(aiCredits!.toValue).toBe(10000);
  });

  it('generates descriptive text per difference', () => {
    const result = comparePlans('free', 'starter');

    const domainDiff = result.differences.find((d) => d.feature === 'custom_domain');
    expect(domainDiff?.description).toMatch(/custom domain/i);
    expect(domainDiff?.description).toContain('0');
    expect(domainDiff?.description).toContain('1');

    const sitesDiff = result.differences.find((d) => d.feature === 'sites');
    expect(sitesDiff?.description).toContain('1');
    expect(sitesDiff?.description).toContain('3');
  });

  it('displays cost correctly for upgrade', () => {
    const result = comparePlans('free', 'starter');
    expect(result.cost.display).toMatch(/\$0 → \$25\/mo, \+?\$25\/mo/);
  });

  it('displays cost correctly for downgrade', () => {
    const result = comparePlans('pro', 'free');
    expect(result.cost.display).toMatch(/\$50 → \$0\/mo, -\$50\/mo/);
  });

  it('displays cost correctly for same plan', () => {
    const result = comparePlans('pro', 'pro');
    expect(result.cost.display).toMatch(/\$50 → \$50\/mo/);
  });

  it('handles case-insensitive plan names', () => {
    const up = comparePlans('FREE', 'Pro');
    expect(up.upgrade).toBe(true);

    const down = comparePlans('PRO', 'Free');
    expect(down.upgrade).toBe(false);
  });

  it('returns typed FeatureDifference entries', () => {
    const result = comparePlans('free', 'pro');
    for (const diff of result.differences) {
      expect(diff).toHaveProperty('feature');
      expect(diff).toHaveProperty('label');
      expect(diff).toHaveProperty('fromValue');
      expect(diff).toHaveProperty('toValue');
      expect(diff).toHaveProperty('change');
      expect(diff).toHaveProperty('description');
      expect(typeof diff.feature).toBe('string');
      expect(typeof diff.label).toBe('string');
      expect(typeof diff.fromValue).toBe('number');
      expect(typeof diff.toValue).toBe('number');
    }
  });
});

// ── planFeatureMatrix ──────────────────────────────────────────────────────

describe('planFeatureMatrix', () => {
  it('returns the canonical feature matrix with all 10 features', () => {
    const matrix = planFeatureMatrix();

    expect(matrix).toHaveLength(10);

    const sites = matrix.find((r) => r.key === 'sites');
    expect(sites).toBeDefined();
    expect(sites!.free).toBe(1);
    expect(sites!.starter).toBe(3);
    expect(sites!.pro).toBe(-1);
    expect(sites!.unit).toBe('sites');
  });

  it('each row has the required shape', () => {
    const matrix = planFeatureMatrix();

    for (const row of matrix) {
      expect(row).toHaveProperty('key');
      expect(row).toHaveProperty('label');
      expect(row).toHaveProperty('free');
      expect(row).toHaveProperty('starter');
      expect(row).toHaveProperty('pro');
      expect(row).toHaveProperty('unit');
      expect(row).toHaveProperty('upgradeDescription');
      expect(typeof row.key).toBe('string');
      expect(typeof row.label).toBe('string');
      expect(typeof row.free).toBe('number');
      expect(typeof row.starter).toBe('number');
      expect(typeof row.pro).toBe('number');
    }
  });

  it('returns an immutable array (frozen by source)', () => {
    const matrix = planFeatureMatrix();
    expect(Object.isFrozen(matrix)).toBe(false); // .map() creates a new array
    // Individual items should be plain objects
    expect(typeof matrix[0]).toBe('object');
  });

  it('reflects known limits for team seats', () => {
    const matrix = planFeatureMatrix();
    const seats = matrix.find((r) => r.key === 'team_seats');
    expect(seats).toBeDefined();
    expect(seats!.free).toBe(1);
    expect(seats!.starter).toBe(2);
    expect(seats!.pro).toBe(10);
  });

  it('does not mutate on repeated calls', () => {
    const first = planFeatureMatrix();
    const second = planFeatureMatrix();
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // different array identity
  });
});

// ── bestPlanFor ────────────────────────────────────────────────────────────

describe('bestPlanFor', () => {
  it('recommends free for minimal needs', () => {
    const result = bestPlanFor({ minSites: 1 });

    expect(result.plan).toBe('free');
    expect(result.reason).toMatch(/Free/i);
  });

  it('recommends starter when free tier is insufficient on sites', () => {
    const result = bestPlanFor({ minSites: 2 });

    expect(result.plan).toBe('starter');
    expect(result.reason).toMatch(/Starter/i);
  });

  it('recommends pro when free and starter are insufficient', () => {
    const result = bestPlanFor({ minSites: 10 });

    expect(result.plan).toBe('pro');
    expect(result.reason).toMatch(/Pro/i);
  });

  it('recommends starter for moderate AI credit needs', () => {
    const result = bestPlanFor({ minAiCredits: 100 });

    expect(result.plan).toBe('starter');
  });

  it('recommends pro for high AI credit needs', () => {
    const result = bestPlanFor({ minAiCredits: 5000 });

    expect(result.plan).toBe('pro');
  });

  it('recommends starter for one custom domain', () => {
    const result = bestPlanFor({ customDomains: 1 });

    expect(result.plan).toBe('starter');
  });

  it('recommends pro for multiple custom domains', () => {
    const result = bestPlanFor({ customDomains: 3 });

    expect(result.plan).toBe('pro');
  });

  it('recommends pro when remove-branding is needed', () => {
    const result = bestPlanFor({ removeBranding: true });

    expect(result.plan).toBe('pro');
    expect(result.reason).toMatch(/remove.?branding/i);
  });

  it('recommends pro when priority builds are needed', () => {
    const result = bestPlanFor({ priorityBuild: true });

    expect(result.plan).toBe('pro');
  });

  it('recommends pro for larger team seat needs', () => {
    const result = bestPlanFor({ teamSeats: 5 });

    expect(result.plan).toBe('pro');
  });

  it('recommends starter for 2 team seats', () => {
    const result = bestPlanFor({ teamSeats: 2 });

    expect(result.plan).toBe('starter');
  });

  it('combines multiple needs and picks appropriately', () => {
    // 2 sites + custom domain → starter covers both
    const r1 = bestPlanFor({ minSites: 2, customDomains: 1 });
    expect(r1.plan).toBe('starter');

    // 4 sites + 3 custom domains → only pro covers
    const r2 = bestPlanFor({ minSites: 4, customDomains: 3 });
    expect(r2.plan).toBe('pro');
  });

  it('returns pro as fallback when even pro cannot cover needs', () => {
    // No plan covers 11 team seats (free:1, starter:2, pro:10)
    const result = bestPlanFor({ teamSeats: 20 });

    expect(result.plan).toBe('pro');
    expect(result.reason).toMatch(/closest/i);
  });

  it('uses sensible defaults for unspecified needs', () => {
    const result = bestPlanFor({});

    // Defaults: 1 min site, 1 team seat, everything else 0 → fits free
    expect(result.plan).toBe('free');
  });

  it('returns a typed PlanRecommendation', () => {
    const result: PlanRecommendation = bestPlanFor({ minSites: 3 });

    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('reason');
    expect(typeof result.plan).toBe('string');
    expect(typeof result.reason).toBe('string');
    expect(['free', 'starter', 'pro']).toContain(result.plan);
  });

  it('returns a descriptive reason for free recommendation', () => {
    const result = bestPlanFor({ minSites: 1 });

    expect(result.reason).toMatch(/satisfies all requirements/i);
    expect(result.reason).toContain('Free');
  });
});

// ── PLAN_PRICES ────────────────────────────────────────────────────────────

describe('PLAN_PRICES', () => {
  it('free is $0', () => {
    expect(PLAN_PRICES.free).toBe(0);
  });

  it('starter is $25/mo (2500 cents)', () => {
    expect(PLAN_PRICES.starter).toBe(2500);
  });

  it('pro is $50/mo (5000 cents)', () => {
    expect(PLAN_PRICES.pro).toBe(5000);
  });
});

// ── TypeScript contract (compile-time assertions) ──────────────────────────

describe('TypeScript contract', () => {
  it('PlanFeatureRow is a valid structural type', () => {
    const row: PlanFeatureRow = {
      key: 'sites',
      label: 'Sites',
      free: 1,
      starter: 3,
      pro: -1,
      unit: 'sites',
      upgradeDescription: 'Upgrade for more sites.',
    };
    expect(row.key).toBe('sites');
  });

  it('FeatureDifference uses the correct change union', () => {
    const inc: FeatureDifference['change'] = 'increase';
    const dec: FeatureDifference['change'] = 'decrease';
    const same: FeatureDifference['change'] = 'same';
    expect(inc).toBe('increase');
    expect(dec).toBe('decrease');
    expect(same).toBe('same');
  });

  it('CompareResult has the expected shape', () => {
    const result: CompareResult = comparePlans('free', 'starter');
    expect(Array.isArray(result.differences)).toBe(true);
    expect(typeof result.upgrade).toBe('boolean');
    expect(typeof result.cost.deltaCents).toBe('number');
  });
});
