// Regression guard for the site-gen vertical classifier (`pickVerticalPreset` in
// scripts/container-server.mjs). Parses the LIVE `['_brand.X.json', /regex/]` rules
// out of the source (drift-free — never hardcodes a second copy) and asserts that
// common real business-category strings first-match to the correct vertical, mirroring
// the `_category.txt` authoritative short-circuit (first-match-by-rule-ORDER). fire-85.
//
// Why parse instead of import: container-server.mjs is a side-effect-heavy HTTP server
// entrypoint — importing it boots a server. Reading + regex-extracting the rule table
// gives the exact runtime behaviour with zero side effects and stays honest to the
// source (edit a regex → this test re-parses it, no manual sync).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '../../scripts/container-server.mjs'), 'utf-8');

interface Rule {
  vertical: string;
  re: RegExp;
}

const rules: Rule[] = [];
for (const m of SRC.matchAll(/\['_brand\.([a-z-]+)\.json',\s*\/(.+?)\/\],/g)) {
  rules.push({ vertical: m[1], re: new RegExp(m[2], 'i') });
}

/** First-match over rules in source order — mirrors the `_category.txt` short-circuit. */
function classify(category: string): string {
  return rules.find((r) => r.re.test(category.toLowerCase()))?.vertical ?? '(none)';
}

// Common declared-category strings (Google Places type / explicit business_type) →
// the vertical whose LIGHT/DARK pack + copy they should render.
const EXPECT: Record<string, string> = {
  // medical
  'urgent care': 'medical',
  pediatrician: 'medical',
  'dermatology clinic': 'medical',
  'family medicine': 'medical',
  'veterinary clinic': 'medical',
  chiropractor: 'medical',
  optometrist: 'medical',
  'physical therapy': 'medical',
  'primary care': 'medical',
  // dental
  dentist: 'dental',
  'family dentistry': 'dental',
  orthodontist: 'dental',
  'pediatric dentist': 'dental',
  'oral surgeon': 'dental',
  // wellness
  'day spa': 'wellness',
  'massage therapy': 'wellness',
  'yoga studio': 'wellness',
  'nail salon': 'wellness',
  acupuncture: 'wellness',
  // legal + professional-services (per orchestrator CLAUDE.md — fire-85)
  'law firm': 'legal',
  attorney: 'legal',
  'personal injury law': 'legal',
  'estate planning': 'legal',
  accountant: 'legal',
  'cpa firm': 'legal',
  'tax preparation': 'legal',
  bookkeeping: 'legal',
  'financial advisor': 'legal',
  'insurance agency': 'legal',
  // restaurant
  restaurant: 'restaurant',
  cafe: 'restaurant',
  'coffee shop': 'restaurant',
  bakery: 'restaurant',
  pizzeria: 'restaurant',
  'food truck': 'restaurant',
  steakhouse: 'restaurant',
  brewery: 'restaurant',
  'ice cream shop': 'restaurant',
  // local-service
  plumber: 'local-service',
  electrician: 'local-service',
  hvac: 'local-service',
  roofing: 'local-service',
  landscaping: 'local-service',
  'auto repair': 'local-service',
  'pest control': 'local-service',
  'tree service': 'local-service',
  'appliance repair': 'local-service',
  'pool service': 'local-service',
  // nonprofit (incl. the soup-kitchen order-bug guard — must beat restaurant's "kitchen")
  'food pantry': 'nonprofit',
  'food bank': 'nonprofit',
  'animal rescue': 'nonprofit',
  'humane society': 'nonprofit',
  'community center': 'nonprofit',
  'homeless shelter': 'nonprofit',
  church: 'nonprofit',
  'soup kitchen': 'nonprofit',
  // retail
  boutique: 'retail',
  'clothing store': 'retail',
  'jewelry store': 'retail',
  bookstore: 'retail',
  'furniture store': 'retail',
  // saas
  software: 'saas',
  'saas platform': 'saas',
  'mobile app': 'saas',
  'fintech startup': 'saas',
  // real-estate
  realtor: 'real-estate',
  'real estate agency': 'real-estate',
  'property management': 'real-estate',
  'mortgage broker': 'real-estate',
  // fitness
  gym: 'fitness',
  crossfit: 'fitness',
  'personal trainer': 'fitness',
  'martial arts': 'fitness',
  // agency
  'marketing agency': 'agency',
  'design studio': 'agency',
  'consulting firm': 'agency',
  'pr firm': 'agency',
  // portfolio
  photographer: 'portfolio',
  'freelance designer': 'portfolio',
  architect: 'portfolio',
  artist: 'portfolio',
};

describe('vertical classifier coverage (pickVerticalPreset)', () => {
  it('parses all 13 brand rules from container-server.mjs', () => {
    expect(rules.length).toBe(13);
  });

  it.each(Object.entries(EXPECT))('classifies "%s" → %s', (category, want) => {
    expect(classify(category)).toBe(want);
  });
});
