/**
 * @module libs/features/geo_toolkit/service
 *
 * Pure GEO analysis engine — analyzes page content for AI answer engine
 * discoverability. Zero I/O, deterministic.
 *
 * What it checks:
 * - Factual claim density + citation rate (AI engines cite well-sourced content)
 * - Answer-targeting structure (concise Q&A, definitions, stats)
 * - Schema markup presence (JSON-LD → AI engine parsing)
 * - Traditional SEO fundamentals (keywords, headings, meta)
 * - Readability (AI engines prefer clear, scannable content)
 *
 * The dual scoring (SEO + AI) means a page can rank well in Google AND be
 * cited by ChatGPT/Perplexity/Gemini — the GEO sweet spot.
 */
import type { FactualClaim, GeoAnalysis, GeoScore } from './schemas.js';

// ── Factual claim detection ─────────────────────────────────────────────────

const CLAIM_PATTERNS: Array<{ regex: RegExp; category: FactualClaim['category'] }> = [
  { regex: /\d{1,3}(?:,\d{3})*(?:\.\d+)?%\s+(?:of|increase|decrease|growth|rate)/gi, category: 'statistic' },
  { regex: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g, category: 'price' },
  { regex: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi, category: 'date' },
  { regex: /\b(?:since|established|founded|launched)\s+\d{4}\b/gi, category: 'date' },
  { regex: /\b(?:best|#1|top.rated|award.winning|leading|premier|only)\b/gi, category: 'claim' },
  { regex: /\b(?:vs\.?|versus|compared to|unlike|better than)\b/gi, category: 'comparison' },
  { regex: /\b(?:guarantee|warranty|100%|satisfaction|money.back|risk.free)\b/gi, category: 'guarantee' },
];

const CITATION_PATTERNS = [
  /\[[\d,]+\]/g,           // [1], [1,2,3]
  /\(\w+\s+\d{4}\)/g,       // (Author 2024)
  /\b(?:according to|per|as reported by|source:|cited in)\b/gi,
];

function extractClaims(content: string): FactualClaim[] {
  const claims: FactualClaim[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        // Check if this claim is near a citation (within 150 chars)
        const idx = content.indexOf(match);
        const context = content.slice(Math.max(0, idx - 150), idx + match.length + 150);
        const cited = CITATION_PATTERNS.some((cp) => cp.test(context));
        claims.push({
          text: match,
          category: pattern.category,
          cited,
          sourceHint: cited ? 'Citation detected nearby' : undefined,
        });
      }
    }
  }
  // Deduplicate by text
  const seen = new Set<string>();
  return claims.filter((c) => {
    const key = `${c.text}:${c.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── SEO fundamentals scoring ────────────────────────────────────────────────

function scoreSeoFundamentals(content: string): number {
  let score = 0;

  // Word count (target 800+)
  const words = content.split(/\s+/).length;
  if (words >= 1200) score += 15;
  else if (words >= 800) score += 10;
  else if (words >= 400) score += 5;

  // Heading structure (H1, H2, H3)
  const h1Count = (content.match(/<h1[>\s]/gi) || []).length + (content.match(/^#\s/gm) || []).length;
  const h2Count = (content.match(/<h2[>\s]/gi) || []).length + (content.match(/^##\s/gm) || []).length;
  if (h1Count >= 1) score += 5;
  if (h2Count >= 3) score += 10;
  else if (h2Count >= 1) score += 5;

  // Keyword density (simple heuristic: repeated key phrases)
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 20) score += 5;

  // Internal links
  const internalLinks = (content.match(/href=["']\/(?!\/)/gi) || []).length;
  if (internalLinks >= 5) score += 10;
  else if (internalLinks >= 2) score += 5;

  // Image alt text
  const altTexts = (content.match(/alt=["'][^"']+["']/gi) || []).length;
  if (altTexts >= 5) score += 5;
  else if (altTexts >= 1) score += 3;

  // Meta description hints
  if (content.match(/<meta\s+name=["']description["']/gi)) score += 5;

  return Math.min(score, 50);
}

// ── AI answer engine scoring ────────────────────────────────────────────────

function scoreAiEngine(content: string, claims: FactualClaim[]): { score: number; formatted: number } {
  let score = 0;

  // Factual claim density (AI engines love data-rich content)
  const words = content.split(/\s+/).length;
  const claimDensity = words > 0 ? claims.length / (words / 100) : 0; // claims per 100 words
  if (claimDensity >= 2.0) score += 15;
  else if (claimDensity >= 1.0) score += 10;
  else if (claimDensity >= 0.5) score += 5;

  // Citation rate (cited claims / total claims)
  const citedCount = claims.filter((c) => c.cited).length;
  const citationRate = claims.length > 0 ? citedCount / claims.length : 0;
  if (citationRate >= 0.5) score += 15;
  else if (citationRate >= 0.25) score += 8;
  else if (citedCount > 0) score += 3;

  // Answer-targeting structure (FAQ patterns, Q&A, definitions)
  const qaCount = (content.match(/^(?:Q:|A:|What|How|Why|When|Where|Who)\s/gi) || []).length;
  if (qaCount >= 5) score += 10;
  else if (qaCount >= 2) score += 5;

  // Definition patterns (AI engines extract definitions)
  const defCount = (content.match(/\b(?:is defined as|refers to|means|is a)\b/gi) || []).length;
  if (defCount >= 3) score += 5;

  // AI formatting score — how well-structured the content is for AI parsing
  let aiFormatting = 0;
  // Lists (AI engines parse lists well)
  const listItems = (content.match(/<li[>\s]/gi) || []).length + (content.match(/^[\s]*[-*+]\s/gm) || []).length;
  if (listItems >= 10) aiFormatting += 30;
  else if (listItems >= 5) aiFormatting += 20;
  else if (listItems >= 2) aiFormatting += 10;

  // Tables (structured data extraction)
  const tables = (content.match(/<table/gi) || []).length;
  if (tables >= 2) aiFormatting += 20;
  else if (tables >= 1) aiFormatting += 10;

  // Short paragraphs (AI engines prefer scannable content)
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const avgParaLen = paragraphs.length > 0
    ? paragraphs.reduce((s, p) => s + p.split(/\s+/).length, 0) / paragraphs.length
    : 0;
  if (avgParaLen > 0 && avgParaLen <= 60) aiFormatting += 25;
  else if (avgParaLen > 0 && avgParaLen <= 100) aiFormatting += 15;
  else if (avgParaLen > 0 && avgParaLen <= 150) aiFormatting += 5;

  // Bold/highlighted key phrases
  const boldCount = (content.match(/<strong>|<b>|\*\*/g) || []).length;
  if (boldCount >= 8) aiFormatting += 15;
  else if (boldCount >= 4) aiFormatting += 8;

  aiFormatting = Math.min(aiFormatting, 100);

  return { score: Math.min(score, 50), formatted: aiFormatting };
}

// ── Grade mapping ───────────────────────────────────────────────────────────

function computeGeoGrade(overall: number): GeoScore['grade'] {
  if (overall >= 90) return 'A+';
  if (overall >= 75) return 'A';
  if (overall >= 60) return 'B';
  if (overall >= 40) return 'C';
  if (overall >= 20) return 'D';
  return 'F';
}

// ── Suggestion generation ───────────────────────────────────────────────────

interface Suggestion {
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: 'ai_visibility' | 'trust' | 'seo' | 'completeness';
}

function generateSuggestions(
  content: string,
  claims: FactualClaim[],
  seoScore: number,
  aiScore: number,
  hasStructuredData: boolean,
  hasFaqSchema: boolean,
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Uncited claims = trust problem for AI engines
  const uncitedCount = claims.filter((c) => !c.cited).length;
  if (uncitedCount > 5) {
    suggestions.push({
      priority: 'critical',
      title: `${uncitedCount} factual claims lack citations`,
      description: 'AI answer engines deprioritize uncited content. Add inline citations or source links for key claims.',
      impact: 'ai_visibility',
    });
  }

  if (!hasStructuredData) {
    suggestions.push({
      priority: 'critical',
      title: 'No JSON-LD structured data detected',
      description: 'AI engines use schema.org markup to understand your content. Add at minimum WebSite + Organization + WebPage + BreadcrumbList JSON-LD.',
      impact: 'ai_visibility',
    });
  }

  if (!hasFaqSchema) {
    suggestions.push({
      priority: 'high',
      title: 'No FAQPage schema detected',
      description: 'FAQ structured data enables rich results in Google and structured answers in AI overviews. Add FAQPage JSON-LD for Q&A sections.',
      impact: 'ai_visibility',
    });
  }

  if (seoScore < 25) {
    suggestions.push({
      priority: 'high',
      title: 'SEO fundamentals need improvement',
      description: 'Add more internal links, image alt text, and a meta description. Target 800+ words with clear H1/H2 hierarchy.',
      impact: 'seo',
    });
  }

  if (aiScore < 25) {
    suggestions.push({
      priority: 'high',
      title: 'Low AI answer engine optimization',
      description: 'Add statistics, Q&A sections, and list-formatted content. AI engines extract from well-structured, data-rich pages.',
      impact: 'ai_visibility',
    });
  }

  const words = content.split(/\s+/).length;
  if (words < 400) {
    suggestions.push({
      priority: 'medium',
      title: `Content length (${words} words) is below the 800-word target`,
      description: 'Longer, comprehensive content ranks better in both traditional search and AI answer engines.',
      impact: 'completeness',
    });
  }

  const citationRate = claims.length > 0
    ? claims.filter((c) => c.cited).length / claims.length
    : 0;
  if (claims.length > 3 && citationRate < 0.3) {
    suggestions.push({
      priority: 'medium',
      title: `Citation rate is ${Math.round(citationRate * 100)}% — target 50%+`,
      description: 'Add source links for statistics, dates, and claims. AI engines preferentially cite well-sourced content.',
      impact: 'trust',
    });
  }

  return suggestions;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Analyzes page content for AI answer engine discoverability.
 *
 * Returns a dual-score GeoAnalysis: traditional SEO score (0-100) + AI answer
 * engine visibility score (0-100) → combined GEO score + letter grade.
 *
 * @param url - The page URL being analyzed.
 * @param content - Raw HTML or markdown content.
 * @param existingJsonLd - Any existing JSON-LD blocks on the page.
 * @returns A complete GeoAnalysis with scores, claims, and suggestions.
 */
export function analyzeGeo(
  url: string,
  content: string,
  existingJsonLd: string[] = [],
): GeoAnalysis {
  // Extract factual claims
  const factualClaims = extractClaims(content);

  // Score SEO fundamentals
  const seoScore = scoreSeoFundamentals(content);

  // Score AI answer engine visibility
  const aiResult = scoreAiEngine(content, factualClaims);
  const aiScore = aiResult.score;

  // Combined GEO score (weighted: 40% SEO + 60% AI)
  const overall = Math.round(seoScore * 0.4 + aiScore * 0.6);

  // Structured data detection
  const hasStructuredData = existingJsonLd.length > 0;
  const hasFaqSchema = existingJsonLd.some((ld) =>
    ld.includes('"FAQPage"') || ld.includes('"@type":"FAQPage"'),
  );

  // Generate suggestions
  const suggestions = generateSuggestions(
    content,
    factualClaims,
    seoScore,
    aiScore,
    hasStructuredData,
    hasFaqSchema,
  );

  const citedCount = factualClaims.filter((c) => c.cited).length;

  return {
    url,
    analyzedAt: new Date().toISOString(),
    geoScore: {
      overall,
      seoScore,
      aiScore,
      grade: computeGeoGrade(overall),
    },
    factualClaims,
    citedClaims: citedCount,
    uncitedClaims: factualClaims.length - citedCount,
    suggestions,
    aiFormattingScore: aiResult.formatted,
    structuredDataPresent: hasStructuredData,
    faqSchemaPresent: hasFaqSchema,
  };
}
