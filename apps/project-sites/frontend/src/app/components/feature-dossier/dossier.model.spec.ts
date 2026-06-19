import {
  buildDossierMarkdown,
  coverageSignal,
  englishSmoke,
  readMinutes,
  tableOfContents,
  wordCount,
  type DossierModel,
} from './dossier.model';

const flagModel: DossierModel = {
  kind: 'Feature Flag',
  key: 'site_video_gen',
  name: 'site_video_gen',
  summary: 'Per-site narrative video generator.',
  explanation: 'Storyboards the business then assembles a brand film in the build Workflow.',
  checklist: ['Storyboard → Veo clips', 'Assembled ~56s film', 'Device-adaptive delivery'],
  smokeTest: ['POST /api/sites/:id/video/generate', 'GET /api/sites/:id/video'],
  e2eTests: ['e2e/_fortress/site_video_gen/happy-path.spec.ts'],
  references: ['https://developers.cloudflare.com/stream/transform-videos/'],
  stage: 'experimental',
  rolloutPercent: 0,
  owner: 'brian@megabyte.space',
  enabled: false,
};

const featureModel: DossierModel = {
  kind: 'Feature',
  key: 'storefront_ecommerce',
  name: 'Online Store',
  summary: 'Sell products from your site.',
  checklist: ['Product catalog', 'Secure checkout', 'Inventory tracking'],
  requiredPlan: 'business',
  category: 'Sell',
  enabled: false,
};

describe('dossier.model', () => {
  describe('buildDossierMarkdown', () => {
    it('emits every documented section for a flag', () => {
      const md = buildDossierMarkdown(flagModel);
      for (const h of ['## Overview', '## How it works', '## At a glance', '## What it does', '## Lifecycle & rollout', '## Smoke test', '## Automated coverage', '## Integration guide', '## Sources & references']) {
        expect(md).withContext(h).toContain(h);
      }
    });

    it('renders checklist items as GFM task list checkboxes', () => {
      const md = buildDossierMarkdown(flagModel);
      expect(md).toContain('- [x] Storyboard → Veo clips');
    });

    it('flag integration guide carries the exact server + UI guard snippets keyed to the flag', () => {
      const md = buildDossierMarkdown(flagModel);
      expect(md).toContain("isFlagOn(env, 'site_video_gen'");
      expect(md).toContain("useFeatureFlag('site_video_gen')");
      expect(md).toContain('return c.notFound();');
    });

    it('feature integration guide is owner-facing (catalog + entitlement), not a flag guard', () => {
      const md = buildDossierMarkdown(featureModel);
      expect(md).toContain('SITE_FEATURE_CATALOG');
      expect(md).toContain("FEATURE_CAPABILITIES['storefront_ecommerce']");
      expect(md).toContain('/api/site-features/storefront_ecommerce');
    });

    it('omits Sources when there are no references', () => {
      expect(buildDossierMarkdown(featureModel)).not.toContain('## Sources & references');
    });

    it('notes the missing-E2E gate when no specs are linked', () => {
      expect(buildDossierMarkdown(featureModel)).toContain('No E2E specs linked yet');
    });

    it('renders a Preview section carrying the preview note when present', () => {
      const md = buildDossierMarkdown({ ...featureModel, previewNote: 'Storefront goes live the moment you flip it on.' });
      expect(md).toContain('## Preview');
      expect(md).toContain('Storefront goes live the moment you flip it on.');
    });

    it('omits the Preview section when no preview note is set', () => {
      expect(buildDossierMarkdown(featureModel)).not.toContain('## Preview');
    });
  });

  describe('englishSmoke', () => {
    it('drops HTTP/curl request lines, keeps human steps', () => {
      const out = englishSmoke(
        ['GET /api/x → 200', 'POST /api/y', 'UI: open the editor and click Save', 'Confirm the chip appears'],
        'Token Meter', 'Feature Flag',
      );
      expect(out).toEqual(['open the editor and click Save', 'Confirm the chip appears']);
      expect(out.join(' ')).not.toMatch(/\b(GET|POST)\b|curl|\/api\//);
    });

    it('falls back to a generic English recipe when every step is a request line', () => {
      const out = englishSmoke(['GET /api/x', 'POST /api/y'], 'Online Store', 'Feature');
      expect(out.length).toBeGreaterThanOrEqual(3);
      expect(out.join(' ')).toContain('Online Store');
      expect(out.join(' ')).not.toMatch(/\b(GET|POST)\b|curl|\/api\//);
    });
  });

  it('the assembled smoke-test section never contains GET/POST/curl', () => {
    const md = buildDossierMarkdown(flagModel); // flagModel.smokeTest is all request lines
    const smoke = md.slice(md.indexOf('## Smoke test'), md.indexOf('## Automated coverage'));
    expect(smoke).not.toMatch(/\b(GET|POST|PUT|DELETE|PATCH)\b|curl|\/api\//);
  });

  describe('coverageSignal', () => {
    it('a well-documented stable flag scores high', () => {
      const r = coverageSignal({ ...flagModel, stage: 'stable', e2eTests: ['a.spec.ts', 'b.spec.ts'] });
      expect(r.score).toBeGreaterThanOrEqual(85);
      expect(r.label).toBe('Well covered');
    });

    it('a bare experimental flag scores low + is clamped 0-100', () => {
      const r = coverageSignal({ kind: 'Feature Flag', key: 'x', name: 'x', summary: 's', stage: 'experimental' });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThan(35);
      expect(r.label).toBe('Lightly covered');
    });

    it('killswitch is the lowest base', () => {
      expect(coverageSignal({ kind: 'Feature Flag', key: 'x', name: 'x', summary: 's', stage: 'killswitch' }).score)
        .toBeLessThan(coverageSignal({ kind: 'Feature Flag', key: 'x', name: 'x', summary: 's', stage: 'experimental' }).score);
    });
  });

  describe('tableOfContents', () => {
    it('extracts ## headings with slug anchors', () => {
      const toc = tableOfContents(buildDossierMarkdown(flagModel));
      const slugs = toc.map((t) => t.slug);
      expect(slugs).toContain('overview');
      expect(slugs).toContain('integration-guide');
      expect(toc.every((t) => /^[a-z0-9-]+$/.test(t.slug))).toBeTrue();
    });
  });

  describe('readMinutes / wordCount', () => {
    it('reading time is at least 1 minute', () => {
      expect(readMinutes(0)).toBe(1);
      expect(readMinutes(2200)).toBe(10);
    });

    it('counts words in the assembled dossier', () => {
      expect(wordCount(buildDossierMarkdown(flagModel))).toBeGreaterThan(40);
    });
  });
});
