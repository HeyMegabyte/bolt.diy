/**
 * @module services/concierge_knowledge
 *
 * @description
 * Per-vertical concierge knowledge — a compact, accurate summary of the services
 * and common FAQ facts each generated site actually presents. The deterministic
 * build renders a per-vertical CONTENT PACK (examples/_content.<vertical>.json), so
 * the SITE's real offerings are known from its vertical even when the per-site
 * research profile is thin. This map mirrors those pack facts and is fed into the
 * `/api/chat` RAG context so the concierge answers "what do you offer?" /
 * "do you offer free consultations?" grounded in the site's real content — instead
 * of deferring on everything the site itself answers.
 *
 * NOTE: intentionally generic-per-vertical (matches what the pack renders). For a
 * business whose orchestrator customized its services, the exact per-site content
 * lives in the build's `_content.json`; surfacing that to the chat is a follow-up
 * (it is an underscore file not yet uploaded to R2). Until then this map is the
 * accurate floor for every deterministic build.
 */

export interface VerticalKnowledge {
  /** One-sentence services summary the site presents. */
  readonly services: string;
  /** Common FAQ facts: pricing posture, first visit, insurance/booking. */
  readonly faqs: string;
}

/** Canonical vertical keys — must match the content-pack + preset verticals. */
export const VERTICAL_KNOWLEDGE: Readonly<Record<string, VerticalKnowledge>> = {
  medical: {
    services:
      'Annual physicals, preventive screenings, chronic disease management, same-day sick visits, vaccinations, and wellness care for all ages.',
    faqs: 'A free initial consultation is available, new patients are welcome, and most major insurance plans are accepted. Same-day appointments are often available for urgent needs.',
  },
  dental: {
    services:
      'Routine cleanings and exams, fillings, teeth whitening, crowns and implants, and gentle care for the whole family.',
    faqs: 'New patients are welcome, most dental insurance is accepted, and flexible payment options are available. Emergency visits can often be seen the same day.',
  },
  wellness: {
    services:
      'Group and private classes, massage and bodywork, and guided programs for strength, mobility, and calm.',
    faqs: 'A free intro class or consultation is available, memberships are flexible and month-to-month, and every experience level is welcome.',
  },
  legal: {
    services:
      'Family law, estate planning, personal injury, business law, real estate, and probate representation.',
    faqs: 'The initial consultation is free and confidential, fees are explained clearly up front (many matters are flat-fee or contingency), and a senior attorney handles your case directly.',
  },
  restaurant: {
    services:
      'Dine-in service, takeout, catering, and private events, with a seasonal, made-from-scratch menu.',
    faqs: 'Reservations are recommended for larger parties, walk-ins are welcome, and dietary needs can usually be accommodated with advance notice.',
  },
  'local-service': {
    services:
      'Installation, repair, and maintenance handled by licensed, insured pros, with free upfront quotes.',
    faqs: 'Estimates are free, the work is guaranteed, and same-day or emergency service is often available. Financing may be offered on larger jobs.',
  },
  nonprofit: {
    services:
      'Community programs, volunteer opportunities, and ways to give that create real local impact.',
    faqs: 'Donations of any size help and are tax-deductible, volunteers of all backgrounds are welcome, and every gift goes directly toward the mission.',
  },
  'real-estate': {
    services:
      'Buyer and seller representation, home valuations, and local market guidance from first tour to closing.',
    faqs: 'A no-obligation consultation and home valuation are free, and an agent guides you through every step, whether you are buying or selling.',
  },
  fitness: {
    services:
      'Personal training, group classes, and structured programs for strength, conditioning, and lasting results.',
    faqs: 'A free intro session or trial is available, memberships are month-to-month with no long contracts, and every fitness level is coached from where they are.',
  },
  saas: {
    services:
      'Workflow automation, team collaboration, analytics and reporting, integrations, access controls, and a developer API.',
    faqs: 'A free 14-day trial is available with no credit card required, setup takes minutes, security is built in, and you can cancel anytime.',
  },
  retail: {
    services:
      'A curated selection of quality goods with fast shipping, easy returns, and helpful service.',
    faqs: 'Shipping is fast, returns are easy, and the team is happy to help you find the right item.',
  },
  agency: {
    services:
      'Brand, design, and marketing work — strategy, creative, and production delivered as one team.',
    faqs: 'Engagements start with a free discovery call, scopes are tailored to your goals, and you work directly with senior talent.',
  },
  portfolio: {
    services: 'Commissioned and collaborative creative work across a focused, high-craft practice.',
    faqs: 'A free intro conversation is available to discuss your project, timeline, and budget.',
  },
};

/**
 * Ordered vertical matchers. First match wins, so the MORE-SPECIFIC patterns
 * (dental before medical, real-estate before generic) come first. Mirrors the
 * container's `pickVerticalPreset` intent without importing it.
 */
const VERTICAL_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/dent(al|ist)|orthodont|endodont/i, 'dental'],
  [/doctor|clinic|medical|family medicine|primary care|physician|pediatr|urgent care/i, 'medical'],
  [/yoga|pilates|\bspa\b|massage|meditation|wellness/i, 'wellness'],
  [/\blaw\b|attorney|legal|counsel|advocate|\bcpa\b|accountant/i, 'legal'],
  [
    /restaurant|cafe|bakery|\bbar\b|brewery|catering|grill|kitchen|dining|bistro|eatery/i,
    'restaurant',
  ],
  [
    /plumb|electric|hvac|roof|landscap|cleaning|contractor|handyman|heating|auto repair/i,
    'local-service',
  ],
  [
    /nonprofit|\bngo\b|charity|foundation|church|501c3|outreach|food bank|soup kitchen/i,
    'nonprofit',
  ],
  [/real estate|realty|realtor|homes for sale|properties|brokerage/i, 'real-estate'],
  [/fitness|\bgym\b|crossfit|strength|conditioning|personal training/i, 'fitness'],
  [/software|\bsaas\b|\bapp\b|platform|analytics|startup|dev tool|\bapi\b/i, 'saas'],
  [/retail|store|boutique|\bshop\b|goods|outfitter|mercantile/i, 'retail'],
  [/agency|studio|marketing|design|branding|production house/i, 'agency'],
  [/portfolio|freelance|photographer|\bartist\b/i, 'portfolio'],
];

/**
 * Resolve the best-matching vertical knowledge for a site from any signals
 * (business_type / category / name). Returns null when nothing matches, so the
 * concierge falls back to the site-specific research context alone.
 *
 * @param signals - free-form strings (business_type, category, name); undefined ok.
 * @returns the matched {@link VerticalKnowledge}, or null.
 *
 * @example
 * knowledgeForVertical('family medicine clinic', 'medical', 'Summit Primary Care')
 * // → { services: 'Annual physicals, …', faqs: 'A free initial consultation …' }
 */
export function knowledgeForVertical(
  ...signals: ReadonlyArray<string | undefined>
): VerticalKnowledge | null {
  const hay = signals.filter(Boolean).join(' ').toLowerCase();
  if (!hay) return null;
  for (const [re, key] of VERTICAL_MATCHERS) {
    if (re.test(hay)) return VERTICAL_KNOWLEDGE[key] ?? null;
  }
  return null;
}
