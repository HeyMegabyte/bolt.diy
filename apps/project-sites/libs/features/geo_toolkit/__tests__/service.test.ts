/**
 * @module libs/features/geo_toolkit/__tests__/service.test
 *
 * Unit tests for analyzeGeo — pure, deterministic, zero I/O.
 */
import { analyzeGeo } from '../service.js';

const WELL_OPTIMIZED = `
<html>
<head><meta name="description" content="Best pizza in Brooklyn since 2010. Award-winning brick oven pizza."></head>
<body>
<h1>Brooklyn's Best Brick Oven Pizza</h1>
<h2>Our Story</h2>
<p>Founded in 2010, we have served over 500,000 pizzas (Source: internal sales data, 2025). Voted #1 Pizza in Brooklyn by the Daily News (2024).</p>
<h2>Menu</h2>
<p>Margherita - $14. Pepperoni - $16. According to our head chef, the dough takes 48 hours to prepare.</p>
<h2>FAQ</h2>
<p><strong>Q: What are your hours?</strong> Open daily 11am-10pm.</p>
<p><strong>Q: Do you deliver?</strong> Yes, within a 3-mile radius. Delivery time: 25-40 minutes per industry data.</p>
<h2>Reviews</h2>
<p>"Best pizza I've ever had" — Jane D. (Google, Dec 2024). 4.8 stars across 1,200+ reviews.</p>
<ul>
<li>Brick oven pizza since 2010</li>
<li>Over 500,000 pizzas served</li>
<li>Voted #1 in Brooklyn (2024)</li>
</ul>
<p><a href="/menu">Full Menu</a> | <a href="/catering">Catering</a> | <a href="/order">Order Online</a></p>
<img src="/hero.jpg" alt="Brick oven pizza with fresh mozzarella and basil">
</body>
</html>`;

const THIN_CONTENT = `
<html><body>
<h1>Welcome</h1>
<p>We are the best restaurant. Our food is great.</p>
</body></html>`;

const WITH_JSONLD = ['{"@type":"WebSite"}', '{"@type":"FAQPage","mainEntity":[{"name":"hours"}]}'];

describe('analyzeGeo', () => {
  test('returns a complete GeoAnalysis with all required fields', () => {
    const result = analyzeGeo('https://example.com', WELL_OPTIMIZED);
    expect(result.url).toBe('https://example.com');
    expect(result.geoScore.overall).toBeGreaterThan(0);
    expect(result.geoScore.overall).toBeLessThanOrEqual(100);
    expect(result.geoScore.seoScore).toBeGreaterThanOrEqual(0);
    expect(result.geoScore.aiScore).toBeGreaterThanOrEqual(0);
    expect(result.geoScore.grade).toEqual(expect.any(String));
    expect(result.factualClaims.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
    expect(result.analyzedAt).toEqual(expect.any(String));
  });

  test('well-optimized content scores higher than thin content', () => {
    const good = analyzeGeo('https://a.com', WELL_OPTIMIZED);
    const thin = analyzeGeo('https://b.com', THIN_CONTENT);
    expect(good.geoScore.overall).toBeGreaterThan(thin.geoScore.overall);
  });

  test('extracts factual claims from content', () => {
    const result = analyzeGeo('https://c.com', WELL_OPTIMIZED);
    expect(result.factualClaims.length).toBeGreaterThan(0);
    // Should detect the "500,000" statistic, "$14" price, "2010" date
    const stats = result.factualClaims.filter((c) => c.category === 'statistic');
    const prices = result.factualClaims.filter((c) => c.category === 'price');
    expect(stats.length + prices.length).toBeGreaterThan(0);
  });

  test('detects cited vs uncited claims', () => {
    const result = analyzeGeo('https://d.com', WELL_OPTIMIZED);
    // "500,000 pizzas (Source: internal sales data, 2025)" should be cited
    const cited = result.factualClaims.filter((c) => c.cited);
    expect(cited.length).toBeGreaterThan(0);
    expect(result.citedClaims).toBe(cited.length);
  });

  test('detects structured data presence', () => {
    const withSd = analyzeGeo('https://e.com', WELL_OPTIMIZED, WITH_JSONLD);
    expect(withSd.structuredDataPresent).toBe(true);
    expect(withSd.faqSchemaPresent).toBe(true);

    const withoutSd = analyzeGeo('https://f.com', WELL_OPTIMIZED);
    expect(withoutSd.structuredDataPresent).toBe(false);
    expect(withoutSd.faqSchemaPresent).toBe(false);
  });

  test('generates suggestions for missing structured data', () => {
    const result = analyzeGeo('https://g.com', WELL_OPTIMIZED);
    const sdSuggestion = result.suggestions.find((s) =>
      s.title.includes('JSON-LD'),
    );
    expect(sdSuggestion).toBeDefined();
    expect(sdSuggestion?.priority).toBe('critical');
  });

  test('generates suggestions for uncited claims', () => {
    // Content with many claims but no citations — should trigger uncited warning
    const uncited = [
      '<p>We have 99% satisfaction rate. Best prices guaranteed. #1 in the city.</p>',
      '<p>Founded in 2015. Top-rated by Local Magazine. Compared to competitors, we offer the lowest prices.</p>',
      '<p>We guarantee 100% satisfaction. Our growth rate is unmatched. Award-winning service since 2016.</p>',
      '<p>$10 specials every Tuesday. The only restaurant with a 5-star rating in the neighborhood.</p>',
      '<p>Leading provider of home services. Premier quality since 2018. Risk-free estimates available.</p>',
      '<p>Established 1999. Over 10,000 happy customers. The best decision you will make.</p>',
    ].join('\n');
    const result = analyzeGeo('https://h.com', uncited);
    const citeSuggestion = result.suggestions.find((s) =>
      s.title.includes('citations'),
    );
    expect(citeSuggestion).toBeDefined();
  });

  test('thin content gets low SEO score', () => {
    const result = analyzeGeo('https://i.com', THIN_CONTENT);
    expect(result.geoScore.seoScore).toBeLessThan(25);
    expect(['C', 'D', 'F']).toContain(result.geoScore.grade);
  });

  test('detects AI formatting quality', () => {
    const result = analyzeGeo('https://j.com', WELL_OPTIMIZED);
    expect(result.aiFormattingScore).toBeGreaterThan(0);
    expect(result.aiFormattingScore).toBeLessThanOrEqual(100);
    // Well-optimized content with lists should score well
    expect(result.aiFormattingScore).toBeGreaterThanOrEqual(10);
  });

  test('handles empty content gracefully', () => {
    const result = analyzeGeo('https://k.com', '');
    expect(result.factualClaims).toHaveLength(0);
    expect(result.citedClaims).toBe(0);
    expect(result.uncitedClaims).toBe(0);
    expect(result.geoScore.grade).toBe('F');
  });

  test('handles content with no HTML tags', () => {
    const plain = 'We sell the best coffee in New York. Over 10,000 cups served since 2019. Prices start at $3.50.';
    const result = analyzeGeo('https://l.com', plain);
    expect(result.factualClaims.length).toBeGreaterThan(0);
  });

  test('suggestions include impact classification', () => {
    const result = analyzeGeo('https://m.com', THIN_CONTENT);
    for (const s of result.suggestions) {
      expect(['ai_visibility', 'trust', 'seo', 'completeness']).toContain(s.impact);
    }
  });
});
