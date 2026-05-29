/**
 * Unit tests for the AI Code Components Generator (IDEAS-50 #42).
 *
 * Covers:
 *   - loadBrandSnapshot returns a fallback when _brand.json is missing
 *   - buildPrompt injects palette + fonts + tone + theme
 *   - callAi validates output against GeneratedComponentSchema (rejects bad shapes)
 *   - generateComponent persists with status='draft' + AI_MODEL alias
 *   - publishComponent creates a plugins row + flips state to 'published'
 *   - regenerateComponent bumps generation_count
 *   - schemas reject bad input shapes
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
  AI_MODEL,
  archiveComponent,
  buildPrompt,
  callAi,
  generateComponent,
  loadBrandSnapshot,
  publishComponent,
  regenerateComponent,
} from '../services/ai_components.js';
import {
  GenerateComponentInputSchema,
  GeneratedComponentSchema,
  PublishComponentInputSchema,
} from '../../libs/features/ai_components/feature.schemas.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

function makeEnv(opts: {
  brandJson?: unknown;
  aiReply?: unknown;
  captureModel?: (model: string) => void;
} = {}): any {
  const r2Get = jest.fn(async (_key: string) => {
    if (opts.brandJson === undefined) return null;
    return {
      json: async () => opts.brandJson,
    };
  });

  const aiRun = jest.fn(async (model: string) => {
    if (opts.captureModel) opts.captureModel(model);
    return {
      response:
        typeof opts.aiReply === 'string'
          ? opts.aiReply
          : JSON.stringify(opts.aiReply ?? {
              name: 'QuoteCalculator',
              description: 'A multi-step quote calculator with conditional pricing.',
              component_code:
                'export default function QuoteCalculator() { return <div className="text-primary">hi</div>; }',
            }),
      usage: { total_tokens: 512 },
    };
  });

  return {
    DB: {} as D1Database,
    SITES_BUCKET: { get: r2Get } as any,
    AI: { run: aiRun } as any,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockExecute.mockResolvedValue({ error: null, changes: 1 });
});

// ---------------------------------------------------------------------------
// Model alias guard — ensures we never drift to the retired bare alias
// ---------------------------------------------------------------------------
describe('AI_MODEL alias', () => {
  it('uses the fp8-fast variant per [[model-routing]]', () => {
    expect(AI_MODEL).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });
});

// ---------------------------------------------------------------------------
// loadBrandSnapshot
// ---------------------------------------------------------------------------
describe('loadBrandSnapshot', () => {
  it('returns the fallback when site is missing', async () => {
    const env = makeEnv();
    const snap = await loadBrandSnapshot(env, 'site_missing');
    expect(snap.theme).toBe('dark');
    expect(snap.fonts?.heading).toBe('Inter');
  });

  it('returns fallback when _brand.json is absent', async () => {
    mockQueryOne.mockResolvedValueOnce({ slug: 'acme' });
    const env = makeEnv(); // no brandJson
    const snap = await loadBrandSnapshot(env, 'site_acme');
    expect(snap.theme).toBe('dark');
  });

  it('loads real brand tokens when _brand.json present', async () => {
    mockQueryOne.mockResolvedValueOnce({ slug: 'acme' });
    const env = makeEnv({
      brandJson: {
        palette: { primary: '#ff0000', accent: '#00ff00' },
        fonts: { heading: 'Sora', body: 'Inter' },
        tone: 'Bold and energetic.',
        theme: 'light',
      },
    });
    const snap = await loadBrandSnapshot(env, 'site_acme');
    expect(snap.palette?.primary).toBe('#ff0000');
    expect(snap.fonts?.heading).toBe('Sora');
    expect(snap.theme).toBe('light');
  });

  it('falls back gracefully when _brand.json malformed', async () => {
    mockQueryOne.mockResolvedValueOnce({ slug: 'acme' });
    const env = makeEnv({ brandJson: { palette: 'not-an-object' } });
    const snap = await loadBrandSnapshot(env, 'site_acme');
    // Falls back because the parse fails — `palette` is meant to be a record.
    expect(snap.fonts?.heading).toBe('Inter');
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------
describe('buildPrompt', () => {
  it('injects palette + fonts + tone + theme into the system prompt', () => {
    const result = buildPrompt(
      { site_id: 'site_x', description: 'A pricing slider widget' },
      {
        palette: { primary: '#abc123' },
        fonts: { heading: 'Sora', body: 'Hind' },
        tone: 'Premium and confident.',
        theme: 'light',
      },
    );
    expect(result.system).toContain('#abc123');
    expect(result.system).toContain('Sora');
    expect(result.system).toContain('Hind');
    expect(result.system).toContain('Premium and confident.');
    expect(result.system).toContain('light');
    expect(result.user).toContain('A pricing slider widget');
  });

  it('caps description length in the user prompt', () => {
    const long = 'x'.repeat(5000);
    const result = buildPrompt(
      { site_id: 'site_x', description: long },
      { palette: {}, fonts: {}, theme: 'dark' },
    );
    expect(result.user.length).toBeLessThan(2200);
  });
});

// ---------------------------------------------------------------------------
// callAi
// ---------------------------------------------------------------------------
describe('callAi', () => {
  it('strips fenced JSON and validates', async () => {
    const env = makeEnv({
      aiReply: '```json\n{"name":"Widget","description":"valid description here","component_code":"export default function Widget(){return null;}\\n\\n// padding so we exceed the schema min of 50 chars"}\n```',
    });
    const result = await callAi(env, { system: 's', user: 'u' });
    expect(result.generated.name).toBe('Widget');
    expect(result.tokens).toBe(512);
  });

  it('throws AI_INVALID_OUTPUT on malformed JSON', async () => {
    const env = makeEnv({ aiReply: 'not json at all' });
    await expect(callAi(env, { system: 's', user: 'u' })).rejects.toThrow('AI_INVALID_OUTPUT');
  });

  it('throws AI_INVALID_OUTPUT when shape fails schema', async () => {
    const env = makeEnv({ aiReply: { name: 'lowercase', component_code: 'short' } });
    await expect(callAi(env, { system: 's', user: 'u' })).rejects.toThrow('AI_INVALID_OUTPUT');
  });
});

// ---------------------------------------------------------------------------
// generateComponent
// ---------------------------------------------------------------------------
describe('generateComponent', () => {
  it('persists a draft component using the fp8-fast model', async () => {
    let captured = '';
    const env = makeEnv({
      captureModel: (m) => (captured = m),
      aiReply: {
        name: 'PricingSlider',
        description: 'A pricing slider with three tiers.',
        component_code:
          'export default function PricingSlider() { return <div className="text-primary">slider goes here</div>; }',
      },
    });
    const result = await generateComponent(
      env,
      { site_id: 'site_x', description: 'A pricing slider with three tiers.' },
      'usr_owner',
      'org_x',
    );
    expect(captured).toBe(AI_MODEL);
    expect(result.name).toBe('PricingSlider');
    expect(mockInsert).toHaveBeenCalledWith(
      env.DB,
      'ai_components',
      expect.objectContaining({
        status: 'draft',
        ai_model: AI_MODEL,
        generation_count: 1,
        created_by: 'usr_owner',
      }),
    );
  });

  it('uses caller-provided name override when supplied', async () => {
    const env = makeEnv({
      aiReply: {
        name: 'ModelChoseThis',
        description: 'A widget the model named.',
        component_code: 'export default function ModelChoseThis() { return <div>hi padding padding padding</div>; }',
      },
    });
    const result = await generateComponent(
      env,
      { site_id: 'site_x', description: 'Anything', name: 'UserChoseThis' },
      'usr',
      'org',
    );
    expect(result.name).toBe('UserChoseThis');
  });
});

// ---------------------------------------------------------------------------
// regenerateComponent
// ---------------------------------------------------------------------------
describe('regenerateComponent', () => {
  it('regenerates an existing component and bumps generation_count via UPDATE', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'aic_1',
      site_id: 'site_x',
      org_id: 'org_x',
      created_by: 'usr',
      name: 'Widget',
      description: 'Original description for the widget.',
      component_code: 'old',
      brand_tokens_snapshot: '{}',
      ai_model: AI_MODEL,
      ai_tokens: 100,
      status: 'draft',
      published_to_marketplace: 0,
      marketplace_plugin_id: null,
      generation_count: 1,
      created_at: '2026-05-27T00:00:00Z',
      updated_at: null,
    });
    const env = makeEnv({
      aiReply: {
        name: 'Widget',
        description: 'Regenerated description for the widget.',
        component_code: 'export default function Widget() { return <div>regenerated padding padding padding</div>; }',
      },
    });
    const result = await regenerateComponent(env, 'aic_1');
    expect(result.id).toBe('aic_1');
    expect(mockExecute).toHaveBeenCalledWith(
      env.DB,
      expect.stringContaining('generation_count = generation_count + 1'),
      expect.any(Array),
    );
  });

  it('rejects when component missing', async () => {
    const env = makeEnv();
    await expect(regenerateComponent(env, 'aic_missing')).rejects.toThrow('COMPONENT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// publishComponent
// ---------------------------------------------------------------------------
describe('publishComponent', () => {
  const baseComponent = {
    id: 'aic_1',
    site_id: 'site_x',
    org_id: 'org_x',
    created_by: 'usr_owner',
    name: 'Widget',
    description: 'Reusable widget.',
    component_code: 'export default function Widget() { return <div>x x x x x x x x x x x x x x x x</div>; }',
    brand_tokens_snapshot: '{}',
    ai_model: AI_MODEL,
    ai_tokens: 100,
    status: 'draft' as const,
    published_to_marketplace: 0,
    marketplace_plugin_id: null,
    generation_count: 1,
    created_at: '2026-05-27T00:00:00Z',
    updated_at: null,
  };

  it('creates a plugins row and flips component to published', async () => {
    mockQueryOne.mockResolvedValueOnce(baseComponent);
    const env = makeEnv();
    const result = await publishComponent(
      env,
      { component_id: 'aic_1', price_cents: 0, category: 'other' },
      'usr_owner',
    );
    expect(result.plugin_id).toMatch(/^plg_/);
    expect(mockInsert).toHaveBeenCalledWith(
      env.DB,
      'plugins',
      expect.objectContaining({
        creator_user_id: 'usr_owner',
        category: 'ai',
        status: 'pending',
      }),
    );
  });

  it('rejects when component already published', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...baseComponent, published_to_marketplace: 1 });
    const env = makeEnv();
    await expect(
      publishComponent(env, { component_id: 'aic_1', price_cents: 0, category: 'other' }, 'usr_owner'),
    ).rejects.toThrow('ALREADY_PUBLISHED');
  });

  it('rejects when caller is not the creator', async () => {
    mockQueryOne.mockResolvedValueOnce(baseComponent);
    const env = makeEnv();
    await expect(
      publishComponent(env, { component_id: 'aic_1', price_cents: 0, category: 'other' }, 'usr_intruder'),
    ).rejects.toThrow('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// archiveComponent
// ---------------------------------------------------------------------------
describe('archiveComponent', () => {
  it('archives an existing component owned by caller', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'aic_1',
      site_id: 'site_x',
      org_id: 'org_x',
      created_by: 'usr_owner',
      name: 'Widget',
      description: 'A widget',
      component_code: 'export default function Widget(){return null}// padding padding padding padding',
      brand_tokens_snapshot: '{}',
      ai_model: AI_MODEL,
      ai_tokens: 0,
      status: 'draft',
      published_to_marketplace: 0,
      marketplace_plugin_id: null,
      generation_count: 1,
      created_at: '2026-05-27T00:00:00Z',
    });
    const env = makeEnv();
    const result = await archiveComponent(env, 'aic_1', 'usr_owner');
    expect(result.ok).toBe(true);
  });

  it('rejects when caller is not the creator', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'aic_1',
      site_id: 'site_x',
      org_id: 'org_x',
      created_by: 'usr_owner',
      name: 'Widget',
      description: 'A widget',
      component_code: 'export default function Widget(){return null}// padding padding padding padding',
      brand_tokens_snapshot: '{}',
      ai_model: AI_MODEL,
      ai_tokens: 0,
      status: 'draft',
      published_to_marketplace: 0,
      marketplace_plugin_id: null,
      generation_count: 1,
      created_at: '2026-05-27T00:00:00Z',
    });
    const env = makeEnv();
    await expect(archiveComponent(env, 'aic_1', 'usr_intruder')).rejects.toThrow('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
describe('schemas', () => {
  it('GenerateComponentInputSchema rejects too-short description', () => {
    const result = GenerateComponentInputSchema.safeParse({
      site_id: 'site_x',
      description: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('GenerateComponentInputSchema rejects non-PascalCase name', () => {
    const result = GenerateComponentInputSchema.safeParse({
      site_id: 'site_x',
      description: 'A multi-step quote calculator widget with three pricing tiers.',
      name: 'lowercase',
    });
    expect(result.success).toBe(false);
  });

  it('PublishComponentInputSchema defaults price_cents=0 and category=other', () => {
    const result = PublishComponentInputSchema.parse({ component_id: 'aic_1' });
    expect(result.price_cents).toBe(0);
    expect(result.category).toBe('other');
  });

  it('GeneratedComponentSchema rejects too-short component_code', () => {
    const result = GeneratedComponentSchema.safeParse({
      name: 'Widget',
      description: 'A short widget description',
      component_code: 'short',
    });
    expect(result.success).toBe(false);
  });
});
