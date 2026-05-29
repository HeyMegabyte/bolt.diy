/**
 * Unit tests for the Template Marketplace v1 service (IDEAS-50 #39).
 *
 * Covers:
 *   - computeRevenueSplit pure function (Framer 100/0 direct, 50/50 referred)
 *   - submitTemplate enforces slug uniqueness and lands as 'pending'
 *   - recordPurchase computes split, persists ledger, is idempotent on PI
 *   - listTemplates filters by category and approval status
 *   - getCreatorRevenue aggregates correctly
 *   - TemplateSubmissionSchema rejects invalid input
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import {
  getCreatorRevenue,
  listBuyerPurchases,
  listTemplates,
  recordPurchase,
  submitTemplate,
} from '../services/template_marketplace.js';
import {
  BPS_FULL,
  computeRevenueSplit,
  DIRECT_PLATFORM_FEE_BPS,
  REFERRAL_REFERRER_BPS,
  TemplateLicenseSchema,
  TemplatePurchaseInputSchema,
  TemplateSubmissionSchema,
} from '../../libs/features/template_marketplace/feature.schemas.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

function makeEnv(): any {
  return { DB: {} as D1Database };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockExecute.mockResolvedValue({ error: null, changes: 1 });
});

// ---------------------------------------------------------------------------
// computeRevenueSplit (pure)
// ---------------------------------------------------------------------------
describe('computeRevenueSplit', () => {
  it('100% to creator on a direct sale (no referrer)', () => {
    const split = computeRevenueSplit(10_000, null);
    expect(split.creator_share_cents).toBe(10_000);
    expect(split.platform_share_cents).toBe(0);
    expect(split.referrer_share_cents).toBe(0);
  });

  it('50/50 creator + referrer on a referred sale, 0 to platform', () => {
    const split = computeRevenueSplit(10_000, 'usr_referrer_1');
    expect(split.creator_share_cents).toBe(5_000);
    expect(split.referrer_share_cents).toBe(5_000);
    expect(split.platform_share_cents).toBe(0);
    expect(
      split.creator_share_cents + split.referrer_share_cents + split.platform_share_cents,
    ).toBe(10_000);
  });

  it('handles odd amounts without losing cents (sum equals input)', () => {
    const split = computeRevenueSplit(9_999, 'usr_referrer_1');
    expect(
      split.creator_share_cents + split.referrer_share_cents + split.platform_share_cents,
    ).toBe(9_999);
  });

  it('handles zero-priced templates', () => {
    const split = computeRevenueSplit(0, null);
    expect(split.creator_share_cents).toBe(0);
    expect(split.platform_share_cents).toBe(0);
    expect(split.referrer_share_cents).toBe(0);
  });

  it('rejects negative amounts', () => {
    expect(() => computeRevenueSplit(-1, null)).toThrow(RangeError);
  });

  it('rejects non-integer amounts', () => {
    expect(() => computeRevenueSplit(99.5, null)).toThrow(RangeError);
  });

  it('exposes Framer-parity constants', () => {
    expect(DIRECT_PLATFORM_FEE_BPS).toBe(0);
    expect(REFERRAL_REFERRER_BPS).toBe(5000);
    expect(BPS_FULL).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// TemplateSubmissionSchema validation
// ---------------------------------------------------------------------------
describe('TemplateSubmissionSchema', () => {
  it('accepts a valid submission', () => {
    const result = TemplateSubmissionSchema.safeParse({
      slug: 'modern-bakery-v2',
      name: 'Modern Bakery',
      description: 'A clean, cinematic bakery template with menu + ordering integration.',
      category: 'restaurant',
      price_cents: 4_900,
      base_files_r2_prefix: 'templates/modern-bakery/v2/',
      license_terms: 'single-site',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid slug (uppercase)', () => {
    const result = TemplateSubmissionSchema.safeParse({
      slug: 'BAD_SLUG',
      name: 'X',
      description: 'A clean cinematic bakery template with menu plus ordering.',
      category: 'restaurant',
      price_cents: 4_900,
      base_files_r2_prefix: 'templates/x/v1/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects price cap > $1000', () => {
    const result = TemplateSubmissionSchema.safeParse({
      slug: 'over-priced',
      name: 'Over Priced',
      description: 'A clean cinematic bakery template with menu plus ordering.',
      category: 'restaurant',
      price_cents: 999_999,
      base_files_r2_prefix: 'templates/x/v1/',
    });
    expect(result.success).toBe(false);
  });

  it('defaults license_terms to single-site', () => {
    const result = TemplateSubmissionSchema.parse({
      slug: 'no-license',
      name: 'No License',
      description: 'A clean cinematic bakery template with menu plus ordering.',
      category: 'restaurant',
      price_cents: 0,
      base_files_r2_prefix: 'templates/x/v1/',
    });
    expect(result.license_terms).toBe('single-site');
  });
});

// ---------------------------------------------------------------------------
// submitTemplate
// ---------------------------------------------------------------------------
describe('submitTemplate', () => {
  const validSubmission = {
    slug: 'lake-cabin-v1',
    name: 'Lake Cabin',
    description: 'A warm cabin-rental template with booking + gallery + reviews.',
    category: 'travel',
    price_cents: 2_900,
    base_files_r2_prefix: 'templates/lake-cabin/v1/',
    license_terms: 'single-site' as const,
  };

  it('inserts a row with submission_status=pending', async () => {
    const env = makeEnv();
    const result = await submitTemplate(env, validSubmission, 'usr_creator_1');

    expect(result.ok).toBe(true);
    expect(result.submission_status).toBe('pending');
    expect(mockInsert).toHaveBeenCalledWith(
      env.DB,
      'templates',
      expect.objectContaining({
        slug: 'lake-cabin-v1',
        creator_user_id: 'usr_creator_1',
        submission_status: 'pending',
        sales_count: 0,
        total_revenue_cents: 0,
      }),
    );
  });

  it('throws SLUG_TAKEN when slug already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'tpl_existing' });
    const env = makeEnv();
    await expect(submitTemplate(env, validSubmission, 'usr_creator_1')).rejects.toThrow('SLUG_TAKEN');
  });
});

// ---------------------------------------------------------------------------
// recordPurchase
// ---------------------------------------------------------------------------
describe('recordPurchase', () => {
  const mockApprovedTemplate = {
    id: 'tpl_modern_bakery',
    slug: 'modern-bakery',
    name: 'Modern Bakery',
    description: 'A clean cinematic bakery template.',
    category: 'restaurant',
    creator_user_id: 'usr_creator_1',
    stripe_product_id: 'prod_abc',
    stripe_price_id: 'price_abc',
    price_cents: 4_900,
    sales_count: 12,
    total_revenue_cents: 58_800,
    submission_status: 'approved' as const,
    license_terms: 'single-site' as const,
    base_files_r2_prefix: 'templates/modern-bakery/v1/',
    preview_url: null,
    install_count: 14,
    rating_avg: 4.8,
    rating_count: 6,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: null,
  };

  it('records a direct sale with 100% to the creator', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // idempotency lookup
      .mockResolvedValueOnce(mockApprovedTemplate); // getTemplate

    const env = makeEnv();
    const result = await recordPurchase(
      env,
      {
        template_id: 'tpl_modern_bakery',
        stripe_payment_intent: 'pi_direct_001',
      },
      'usr_buyer_1',
    );

    expect(result.creator_share_cents).toBe(4_900);
    expect(result.platform_share_cents).toBe(0);
    expect(result.referrer_share_cents).toBe(0);
    expect(mockInsert).toHaveBeenCalledWith(
      env.DB,
      'template_purchases',
      expect.objectContaining({
        buyer_user_id: 'usr_buyer_1',
        stripe_payment_intent: 'pi_direct_001',
        amount_cents: 4_900,
        creator_share_cents: 4_900,
      }),
    );
    expect(mockExecute).toHaveBeenCalled(); // sales_count++ update
  });

  it('records a referred sale with 50/50 creator/referrer split', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // idempotency lookup
      .mockResolvedValueOnce(mockApprovedTemplate); // getTemplate

    const env = makeEnv();
    const result = await recordPurchase(
      env,
      {
        template_id: 'tpl_modern_bakery',
        stripe_payment_intent: 'pi_ref_001',
        referrer_user_id: 'usr_referrer_1',
      },
      'usr_buyer_2',
    );

    expect(result.creator_share_cents).toBe(2_450);
    expect(result.referrer_share_cents).toBe(2_450);
    expect(result.platform_share_cents).toBe(0);
  });

  it('is idempotent on the same Stripe PaymentIntent', async () => {
    const persisted = {
      id: 'tplp_existing',
      template_id: 'tpl_modern_bakery',
      amount_cents: 4_900,
      creator_share_cents: 4_900,
      platform_share_cents: 0,
      referrer_share_cents: 0,
    };
    mockQueryOne.mockResolvedValueOnce(persisted);

    const env = makeEnv();
    const result = await recordPurchase(
      env,
      {
        template_id: 'tpl_modern_bakery',
        stripe_payment_intent: 'pi_dup_001',
      },
      'usr_buyer_3',
    );

    expect(result.purchase_id).toBe('tplp_existing');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('throws TEMPLATE_NOT_FOUND when the template is missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // idempotency
      .mockResolvedValueOnce(null); // template lookup

    const env = makeEnv();
    await expect(
      recordPurchase(
        env,
        { template_id: 'tpl_missing', stripe_payment_intent: 'pi_x' },
        'usr_buyer',
      ),
    ).rejects.toThrow('TEMPLATE_NOT_FOUND');
  });

  it('throws TEMPLATE_NOT_APPROVED when status is pending', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // idempotency
      .mockResolvedValueOnce({ ...mockApprovedTemplate, submission_status: 'pending' });

    const env = makeEnv();
    await expect(
      recordPurchase(
        env,
        { template_id: 'tpl_pending', stripe_payment_intent: 'pi_p' },
        'usr_buyer',
      ),
    ).rejects.toThrow('TEMPLATE_NOT_APPROVED');
  });
});

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------
describe('listTemplates', () => {
  it('filters by approved status by default', async () => {
    const env = makeEnv();
    await listTemplates(env, {});
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("submission_status = 'approved'");
  });

  it('includes unapproved when includeUnapproved=true', async () => {
    const env = makeEnv();
    await listTemplates(env, { includeUnapproved: true, creatorUserId: 'usr_1' });
    const [, sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("submission_status = 'approved'");
  });

  it('caps limit at 500', async () => {
    const env = makeEnv();
    await listTemplates(env, { limit: 99_999 });
    const [, , params] = mockQuery.mock.calls[0];
    expect(params?.[params.length - 1]).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// getCreatorRevenue + listBuyerPurchases
// ---------------------------------------------------------------------------
describe('creator + buyer dashboards', () => {
  it('returns zeros when creator has no sales', async () => {
    const env = makeEnv();
    const rev = await getCreatorRevenue(env, 'usr_new_creator');
    expect(rev).toEqual({
      templates: 0,
      sales_count: 0,
      gross_cents: 0,
      creator_share_cents: 0,
      referred_sales_count: 0,
    });
  });

  it('returns empty list when buyer has no purchases', async () => {
    const env = makeEnv();
    const purchases = await listBuyerPurchases(env, 'usr_new_buyer');
    expect(purchases).toEqual([]);
  });

  it('caps buyer history at 500', async () => {
    const env = makeEnv();
    await listBuyerPurchases(env, 'usr_buyer', 9_999);
    const [, , params] = mockQuery.mock.calls[0];
    expect(params?.[1]).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// TemplatePurchaseInputSchema validation
// ---------------------------------------------------------------------------
describe('TemplatePurchaseInputSchema', () => {
  it('accepts a minimal direct purchase', () => {
    const result = TemplatePurchaseInputSchema.safeParse({
      template_id: 'tpl_x',
      stripe_payment_intent: 'pi_x',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a referred purchase', () => {
    const result = TemplatePurchaseInputSchema.safeParse({
      template_id: 'tpl_x',
      stripe_payment_intent: 'pi_x',
      referrer_user_id: 'usr_ref_1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing stripe_payment_intent', () => {
    const result = TemplatePurchaseInputSchema.safeParse({ template_id: 'tpl_x' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TemplateLicenseSchema
// ---------------------------------------------------------------------------
describe('TemplateLicenseSchema', () => {
  it('accepts the three valid licenses', () => {
    expect(TemplateLicenseSchema.safeParse('single-site').success).toBe(true);
    expect(TemplateLicenseSchema.safeParse('unlimited').success).toBe(true);
    expect(TemplateLicenseSchema.safeParse('agency').success).toBe(true);
  });

  it('rejects unknown license names', () => {
    expect(TemplateLicenseSchema.safeParse('lifetime').success).toBe(false);
  });
});
