/**
 * Pick: schemas.ts — 10 Zod schema pairs not covered by prompt_schemas.test.ts:
 *   SiteCopyOutput, ResearchProfileInput/Output, ResearchSocialInput/Output,
 *   ResearchBrandInput/Output, ResearchSellingPointsInput/Output,
 *   ResearchImagesInput/Output, GenerateWebsiteInput/Output,
 *   GenerateLegalPageInput/Output, ScoreWebsiteInput/Output,
 *   SiteStructurePlanInput/Output, MultiPageSiteInput/Output
 *
 * observability.ts is already fully tested by prompt_observability.test.ts (15 tests).
 */

import { describe, it, expect } from '@jest/globals';
import { ZodError } from 'zod';

import {
  SiteCopyOutput,
  ResearchProfileInput,
  ResearchProfileOutput,
  ResearchSocialInput,
  ResearchSocialOutput,
  ResearchBrandInput,
  ResearchBrandOutput,
  ResearchSellingPointsInput,
  ResearchSellingPointsOutput,
  ResearchImagesInput,
  ResearchImagesOutput,
  GenerateWebsiteInput,
  GenerateWebsiteOutput,
  GenerateLegalPageInput,
  GenerateLegalPageOutput,
  ScoreWebsiteInput,
  ScoreWebsiteOutput,
  SiteStructurePlanInput,
  SiteStructurePlanOutput,
  MultiPageSiteInput,
  MultiPageSiteOutput,
} from '../prompts/schemas.js';

// ── SiteCopyOutput ────────────────────────────────────────────────────────────

describe('SiteCopyOutput', () => {
  it('accepts a string containing a Markdown heading', () => {
    const result = SiteCopyOutput.parse('# Hello\n\nSome copy here.');
    expect(result).toBe('# Hello\n\nSome copy here.');
  });

  it('rejects a string with no Markdown heading', () => {
    expect(() => SiteCopyOutput.parse('No heading here')).toThrow(ZodError);
  });

  it('accepts a string with ## heading', () => {
    expect(SiteCopyOutput.parse('## Sub-heading\n\nBody.')).toBe('## Sub-heading\n\nBody.');
  });
});

// ── ResearchProfileInput ──────────────────────────────────────────────────────

describe('ResearchProfileInput', () => {
  it('accepts minimal valid input', () => {
    const result = ResearchProfileInput.parse({ business_name: 'Acme Corp' });
    expect(result.business_name).toBe('Acme Corp');
    expect(result.business_address).toBe('');
    expect(result.business_phone).toBe('');
  });

  it('rejects empty business_name', () => {
    expect(() => ResearchProfileInput.parse({ business_name: '' })).toThrow(ZodError);
  });

  it('fills in optional field defaults', () => {
    const result = ResearchProfileInput.parse({ business_name: 'Test' });
    expect(result.google_place_id).toBe('');
    expect(result.additional_context).toBe('');
    expect(result.google_places_data).toBe('');
  });

  it('accepts all optional fields', () => {
    const result = ResearchProfileInput.parse({
      business_name: 'Test',
      business_address: '123 Main St',
      business_phone: '555-0100',
      google_place_id: 'ChIJ...',
      additional_context: 'family-owned',
      google_places_data: '{}',
    });
    expect(result.business_phone).toBe('555-0100');
    expect(result.google_place_id).toBe('ChIJ...');
  });
});

// ── ResearchProfileOutput ─────────────────────────────────────────────────────

describe('ResearchProfileOutput', () => {
  it('accepts an object with only business_name', () => {
    const result = ResearchProfileOutput.parse({ business_name: 'Acme Corp' });
    expect(result.business_name).toBe('Acme Corp');
    expect(result.tagline).toBe('');
    expect(result.categories).toEqual([]);
  });

  it('rejects an object missing business_name', () => {
    expect(() => ResearchProfileOutput.parse({ tagline: 'hello' })).toThrow(ZodError);
  });

  it('applies defaults for optional fields', () => {
    const result = ResearchProfileOutput.parse({ business_name: 'Test' });
    expect(result.hours).toEqual([]);
    expect(result.services).toEqual([]);
  });

  it('accepts a service in the services array', () => {
    const result = ResearchProfileOutput.parse({
      business_name: 'Salon',
      services: [{ name: 'Haircut', description: 'Basic haircut', price_from: 25 }],
    });
    expect(result.services).toHaveLength(1);
    expect(result.services![0].name).toBe('Haircut');
  });

  it('accepts passthrough extra fields', () => {
    const result = ResearchProfileOutput.parse({
      business_name: 'Acme',
      extra_field: 'should pass through',
    });
    expect((result as Record<string, unknown>).extra_field).toBe('should pass through');
  });
});

// ── ResearchSocialInput ───────────────────────────────────────────────────────

describe('ResearchSocialInput', () => {
  it('accepts minimal valid input', () => {
    const result = ResearchSocialInput.parse({ business_name: 'Acme' });
    expect(result.business_name).toBe('Acme');
    expect(result.business_address).toBe('');
    expect(result.business_type).toBe('');
  });

  it('rejects empty business_name', () => {
    expect(() => ResearchSocialInput.parse({ business_name: '' })).toThrow(ZodError);
  });

  it('accepts optional fields', () => {
    const result = ResearchSocialInput.parse({
      business_name: 'Acme',
      business_address: '123 Main St',
      business_type: 'retail',
    });
    expect(result.business_type).toBe('retail');
  });
});

// ── ResearchSocialOutput ──────────────────────────────────────────────────────

describe('ResearchSocialOutput', () => {
  it('accepts empty object with passthrough and applies defaults', () => {
    const result = ResearchSocialOutput.parse({});
    expect(result.social_links).toEqual([]);
    expect(result.review_platforms).toEqual([]);
    expect(result.google_business_photos).toEqual([]);
  });

  it('accepts a valid social_link entry', () => {
    const result = ResearchSocialOutput.parse({
      social_links: [{ platform: 'instagram', url: 'https://instagram.com/acme' }],
    });
    expect(result.social_links![0].platform).toBe('instagram');
    expect(result.social_links![0].confidence).toBe(0.5);
  });

  it('rejects a social_link with confidence above 1', () => {
    expect(() =>
      ResearchSocialOutput.parse({
        social_links: [{ platform: 'x', url: null, confidence: 1.5 }],
      }),
    ).toThrow(ZodError);
  });
});

// ── ResearchBrandInput ────────────────────────────────────────────────────────

describe('ResearchBrandInput', () => {
  it('accepts valid input with all required fields', () => {
    const result = ResearchBrandInput.parse({
      business_name: 'Acme',
      business_type: 'restaurant',
    });
    expect(result.business_name).toBe('Acme');
    expect(result.business_type).toBe('restaurant');
    expect(result.website_url).toBe('');
  });

  it('rejects empty business_type', () => {
    expect(() => ResearchBrandInput.parse({ business_name: 'Acme', business_type: '' })).toThrow(
      ZodError,
    );
  });

  it('rejects missing business_name', () => {
    expect(() => ResearchBrandInput.parse({ business_type: 'salon' })).toThrow(ZodError);
  });
});

// ── ResearchBrandOutput ───────────────────────────────────────────────────────

describe('ResearchBrandOutput', () => {
  it('accepts an empty object and fills in defaults', () => {
    const result = ResearchBrandOutput.parse({});
    expect(result.fonts?.heading).toBe('Inter');
    expect(result.colors?.primary).toBe('#2563eb');
    expect(result.brand_personality).toBe('');
  });

  it('accepts overridden color values', () => {
    const result = ResearchBrandOutput.parse({
      colors: { primary: '#ff0000' },
    });
    expect(result.colors?.primary).toBe('#ff0000');
    expect(result.colors?.secondary).toBe('#7c3aed');
  });
});

// ── ResearchSellingPointsInput ────────────────────────────────────────────────

describe('ResearchSellingPointsInput', () => {
  it('accepts minimal valid input', () => {
    const result = ResearchSellingPointsInput.parse({
      business_name: 'Acme',
      business_type: 'salon',
    });
    expect(result.business_name).toBe('Acme');
    expect(result.services_json).toBe('');
  });

  it('rejects empty business_name', () => {
    expect(() =>
      ResearchSellingPointsInput.parse({ business_name: '', business_type: 'salon' }),
    ).toThrow(ZodError);
  });
});

// ── ResearchSellingPointsOutput ───────────────────────────────────────────────

describe('ResearchSellingPointsOutput', () => {
  const validSP = {
    selling_points: [{ headline: 'Fast', description: 'We are fast' }],
  };

  it('accepts valid selling_points array', () => {
    const result = ResearchSellingPointsOutput.parse(validSP);
    expect(result.selling_points).toHaveLength(1);
    expect(result.selling_points[0].icon).toBe('star');
  });

  it('rejects empty selling_points (min 1)', () => {
    expect(() => ResearchSellingPointsOutput.parse({ selling_points: [] })).toThrow(ZodError);
  });

  it('rejects selling_points with more than 6 items (max 6)', () => {
    const pts = Array.from({ length: 7 }, (_, i) => ({
      headline: `Point ${i}`,
      description: 'desc',
    }));
    expect(() => ResearchSellingPointsOutput.parse({ selling_points: pts })).toThrow(ZodError);
  });

  it('fills in benefit_bullets default', () => {
    const result = ResearchSellingPointsOutput.parse(validSP);
    expect(result.benefit_bullets).toEqual([]);
  });
});

// ── ResearchImagesInput ───────────────────────────────────────────────────────

describe('ResearchImagesInput', () => {
  it('accepts minimal valid input', () => {
    const result = ResearchImagesInput.parse({
      business_name: 'Acme',
      business_type: 'cafe',
    });
    expect(result.business_name).toBe('Acme');
    expect(result.business_address).toBe('');
  });

  it('rejects missing business_type', () => {
    expect(() => ResearchImagesInput.parse({ business_name: 'Acme' })).toThrow(ZodError);
  });
});

// ── ResearchImagesOutput ──────────────────────────────────────────────────────

describe('ResearchImagesOutput', () => {
  it('accepts empty object and fills in defaults', () => {
    const result = ResearchImagesOutput.parse({});
    expect(result.hero_images).toEqual([]);
    expect(result.service_images).toEqual([]);
    expect(result.placeholder_strategy).toBe('stock');
  });

  it('accepts a hero image with optional fields', () => {
    const result = ResearchImagesOutput.parse({
      hero_images: [
        {
          concept: 'Coffee shop interior',
          confidence_score: 0.9,
        },
      ],
    });
    expect(result.hero_images![0].concept).toBe('Coffee shop interior');
    expect(result.hero_images![0].confidence_score).toBe(0.9);
    expect(result.hero_images![0].source).toBe('stock');
  });
});

// ── GenerateWebsiteInput ──────────────────────────────────────────────────────

describe('GenerateWebsiteInput', () => {
  it('accepts all required fields', () => {
    const result = GenerateWebsiteInput.parse({
      profile_json: '{"business_name":"Acme"}',
      brand_json: '{"colors":{}}',
      selling_points_json: '{"selling_points":[]}',
      social_json: '{}',
    });
    expect(result.profile_json).toBe('{"business_name":"Acme"}');
    expect(result.images_json).toBe('');
  });

  it('rejects empty profile_json', () => {
    expect(() =>
      GenerateWebsiteInput.parse({
        profile_json: '',
        brand_json: '{}',
        selling_points_json: '{}',
        social_json: '{}',
      }),
    ).toThrow(ZodError);
  });

  it('rejects missing required fields', () => {
    expect(() => GenerateWebsiteInput.parse({ profile_json: '{}' })).toThrow(ZodError);
  });
});

// ── GenerateWebsiteOutput ─────────────────────────────────────────────────────

describe('GenerateWebsiteOutput', () => {
  it('accepts a string with <!DOCTYPE html>', () => {
    const html = '<!DOCTYPE html><html><head></head><body></body></html>';
    expect(GenerateWebsiteOutput.parse(html)).toBe(html);
  });

  it('accepts a string with <!doctype html> (lowercase)', () => {
    const html = '<!doctype html><html></html>';
    expect(GenerateWebsiteOutput.parse(html)).toBe(html);
  });

  it('rejects a string without a DOCTYPE declaration', () => {
    expect(() => GenerateWebsiteOutput.parse('<html><body>hello</body></html>')).toThrow(ZodError);
  });

  it('rejects a non-HTML string', () => {
    expect(() => GenerateWebsiteOutput.parse('plain text')).toThrow(ZodError);
  });
});

// ── GenerateLegalPageInput ────────────────────────────────────────────────────

describe('GenerateLegalPageInput', () => {
  it('accepts valid privacy page input', () => {
    const result = GenerateLegalPageInput.parse({
      business_name: 'Acme Corp',
      brand_json: '{"colors":{}}',
      page_type: 'privacy',
    });
    expect(result.page_type).toBe('privacy');
    expect(result.business_address).toBe('');
  });

  it('accepts valid terms page input', () => {
    const result = GenerateLegalPageInput.parse({
      business_name: 'Acme',
      brand_json: '{}',
      page_type: 'terms',
    });
    expect(result.page_type).toBe('terms');
  });

  it('rejects an invalid page_type', () => {
    expect(() =>
      GenerateLegalPageInput.parse({
        business_name: 'Acme',
        brand_json: '{}',
        page_type: 'cookie',
      }),
    ).toThrow(ZodError);
  });

  it('rejects empty business_name', () => {
    expect(() =>
      GenerateLegalPageInput.parse({
        business_name: '',
        brand_json: '{}',
        page_type: 'privacy',
      }),
    ).toThrow(ZodError);
  });
});

// ── GenerateLegalPageOutput ───────────────────────────────────────────────────

describe('GenerateLegalPageOutput', () => {
  it('accepts a valid HTML document', () => {
    const html = '<!DOCTYPE html><html><body><h1>Privacy</h1></body></html>';
    expect(GenerateLegalPageOutput.parse(html)).toBe(html);
  });

  it('rejects output without DOCTYPE', () => {
    expect(() => GenerateLegalPageOutput.parse('<div>Privacy Policy</div>')).toThrow(ZodError);
  });
});

// ── ScoreWebsiteInput ─────────────────────────────────────────────────────────

describe('ScoreWebsiteInput', () => {
  it('accepts valid input', () => {
    const result = ScoreWebsiteInput.parse({
      html_content: '<html></html>',
      business_name: 'Acme',
    });
    expect(result.html_content).toBe('<html></html>');
    expect(result.business_name).toBe('Acme');
  });

  it('rejects empty html_content', () => {
    expect(() => ScoreWebsiteInput.parse({ html_content: '', business_name: 'Acme' })).toThrow(
      ZodError,
    );
  });

  it('rejects empty business_name', () => {
    expect(() =>
      ScoreWebsiteInput.parse({ html_content: '<html></html>', business_name: '' }),
    ).toThrow(ZodError);
  });
});

// ── ScoreWebsiteOutput ────────────────────────────────────────────────────────

describe('ScoreWebsiteOutput', () => {
  it('accepts empty object and fills in defaults', () => {
    const result = ScoreWebsiteOutput.parse({});
    expect(result.overall).toBe(0.5);
    expect(result.issues).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.missing_sections).toEqual([]);
  });

  it('accepts explicit score values', () => {
    const result = ScoreWebsiteOutput.parse({
      overall: 0.8,
      scores: { visual_design: 0.9, content_quality: 0.7 },
    });
    expect(result.overall).toBe(0.8);
    expect(result.scores?.visual_design).toBe(0.9);
    expect(result.scores?.seo).toBe(0.5);
  });

  it('rejects a score above 1.0', () => {
    expect(() => ScoreWebsiteOutput.parse({ overall: 1.5 })).toThrow(ZodError);
  });

  it('rejects a score below 0', () => {
    expect(() => ScoreWebsiteOutput.parse({ overall: -0.1 })).toThrow(ZodError);
  });
});

// ── SiteStructurePlanInput ────────────────────────────────────────────────────

describe('SiteStructurePlanInput', () => {
  it('accepts valid input', () => {
    const result = SiteStructurePlanInput.parse({
      research_json: '{"business_name":"Acme"}',
      template_json: '{"template":"basic"}',
      business_name: 'Acme',
    });
    expect(result.business_name).toBe('Acme');
    expect(result.additional_context).toBe('');
  });

  it('rejects empty research_json', () => {
    expect(() =>
      SiteStructurePlanInput.parse({
        research_json: '',
        template_json: '{}',
        business_name: 'Acme',
      }),
    ).toThrow(ZodError);
  });

  it('rejects empty template_json', () => {
    expect(() =>
      SiteStructurePlanInput.parse({
        research_json: '{}',
        template_json: '',
        business_name: 'Acme',
      }),
    ).toThrow(ZodError);
  });
});

// ── SiteStructurePlanOutput ───────────────────────────────────────────────────

describe('SiteStructurePlanOutput', () => {
  const validPage = {
    path: '/about',
    title: 'About',
    purpose: 'Tell our story',
    sections: ['hero', 'team'],
  };

  it('accepts a valid site structure with at least one page', () => {
    const result = SiteStructurePlanOutput.parse({ pages: [validPage] });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].path).toBe('/about');
    expect(result.design?.primary_color).toBe('#2563eb');
    expect(result.nav_links).toEqual([]);
  });

  it('rejects an empty pages array (min 1)', () => {
    expect(() => SiteStructurePlanOutput.parse({ pages: [] })).toThrow(ZodError);
  });

  it('rejects a page missing required fields', () => {
    expect(() =>
      SiteStructurePlanOutput.parse({
        pages: [{ path: '/about', title: 'About' }],
      }),
    ).toThrow(ZodError);
  });

  it('accepts nav_links', () => {
    const result = SiteStructurePlanOutput.parse({
      pages: [validPage],
      nav_links: [{ label: 'Home', href: '/' }],
    });
    expect(result.nav_links).toHaveLength(1);
  });
});

// ── MultiPageSiteInput ────────────────────────────────────────────────────────

describe('MultiPageSiteInput', () => {
  it('accepts valid input', () => {
    const result = MultiPageSiteInput.parse({
      structure_plan_json: '{"pages":[]}',
      research_json: '{"business_name":"Acme"}',
      business_name: 'Acme',
    });
    expect(result.business_name).toBe('Acme');
    expect(result.asset_urls_json).toBe('');
    expect(result.additional_context).toBe('');
  });

  it('rejects empty structure_plan_json', () => {
    expect(() =>
      MultiPageSiteInput.parse({
        structure_plan_json: '',
        research_json: '{}',
        business_name: 'Acme',
      }),
    ).toThrow(ZodError);
  });

  it('rejects empty business_name', () => {
    expect(() =>
      MultiPageSiteInput.parse({
        structure_plan_json: '{}',
        research_json: '{}',
        business_name: '',
      }),
    ).toThrow(ZodError);
  });
});

// ── MultiPageSiteOutput ───────────────────────────────────────────────────────

describe('MultiPageSiteOutput', () => {
  const validFile = {
    path: 'index.html',
    content: '<!DOCTYPE html><html></html>',
  };

  it('accepts valid output with at least one file', () => {
    const result = MultiPageSiteOutput.parse({ files: [validFile] });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content_type).toBe('text/html');
    expect(result.metadata?.model_used).toBe('unknown');
  });

  it('rejects empty files array (min 1)', () => {
    expect(() => MultiPageSiteOutput.parse({ files: [] })).toThrow(ZodError);
  });

  it('rejects a file missing content', () => {
    expect(() => MultiPageSiteOutput.parse({ files: [{ path: 'index.html' }] })).toThrow(ZodError);
  });

  it('accepts metadata overrides', () => {
    const result = MultiPageSiteOutput.parse({
      files: [validFile],
      metadata: { model_used: 'claude-sonnet-4-6' },
    });
    expect(result.metadata?.model_used).toBe('claude-sonnet-4-6');
  });

  it('fills in default content_type for each file', () => {
    const result = MultiPageSiteOutput.parse({
      files: [{ path: 'style.css', content: 'body {}' }],
    });
    expect(result.files[0].content_type).toBe('text/html');
  });
});
