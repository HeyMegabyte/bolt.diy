/**
 * @module services/anthropic_skills
 * @description Bundled Anthropic-style "Skills" registry.
 *
 * A Skill is a Markdown file with YAML frontmatter (`name`, `description`,
 * `when_to_use`) plus directive body content the model loads on demand.
 * Unlike Memory (mutable state) or Files (binary payloads), Skills are
 * VERSIONED CONTENT shipped with the worker — they live in
 * `apps/project-sites/skills/*.md` and are bundled into the worker bundle
 * at build time so loads are zero-network.
 *
 * The model invokes a skill via a `tool_use` block named `load_skill`
 * with `input.name`. The execution layer returns the skill body as a
 * `tool_result` string the model can then follow.
 *
 * ## Bundling
 *
 * Skills are inlined into the worker via the `SKILL_FILES` constant
 * (registered by the build step that walks `apps/project-sites/skills/`).
 * Adding a new skill requires:
 *
 * 1. Drop `my-skill.md` into `apps/project-sites/skills/`
 * 2. Add the file path + raw contents to `SKILL_FILES` below
 * 3. Redeploy
 *
 * @packageDocumentation
 */

// ─── Bundled skill files ─────────────────────────────────────────
// Skill bodies are inlined as template strings so the worker bundle has
// zero runtime file I/O and zero build-tool dependency on text imports
// (`?raw`, `[[rules]] type = "Text"`). Mirrors of these strings live in
// `apps/project-sites/skills/*.md` — keep them in sync when editing.
// A future refactor can swap to a wrangler text rule + `import` syntax
// without touching downstream callers (`listSkills`, `loadSkill`).

const RESTAURANT_SITE = `---
name: restaurant-site
description: Directive playbook for restaurant, cafe, bar, food truck, ghost kitchen websites.
when_to_use: When the business profile is food-service (NAICS 722) — restaurants, cafes, bars, food trucks, bakeries, breweries, dessert shops.
---

# Restaurant Site Skill

## Goal
Deliver a website that drives reservations, online orders, and walk-ins. Visitors should know what's being served, when, where, and how to order — within 5 seconds of landing.

## Above the fold (mandatory)
- One-sentence value prop
- Two primary CTAs: \`Reserve a Table\` and \`Order Online\`
- Tonight's hours + status pill (\`OPEN NOW\` / \`CLOSES IN 47 MIN\` / \`OPENS AT 5PM\`)
- Hero photo: the SIGNATURE dish, shot under warm lighting, NEVER a stock photo of "generic food"

## Required sections
1. Menu — every section the kitchen actually serves. Real prices. Allergen icons.
2. Reservations — embed OpenTable / Resy / SevenRooms when available; fall back to a simple form
3. Order online — link to existing Toast / Square Online / DoorDash / Uber Eats / Grubhub
4. Hours & location — Google Maps embed + driving-directions link + weekly hours grid
5. About — 2-paragraph story of the chef/owner, opening year, sourcing philosophy
6. Gallery — minimum 12 plated-dish photos (real, not stock) in a lightbox
7. Reviews — pull from Yelp / Google; never fabricate

## Conversion rules
- Sticky "Reserve" button on mobile
- Every dish on the menu links to its photo in the gallery
- Phone number is \`tel:\` linked in header, footer, and contact section
- Address is \`https://www.google.com/maps/dir/?api=1&destination=…\` linked everywhere

## Schema (JSON-LD per route)
- \`Restaurant\` on home with \`servesCuisine\`, \`priceRange\`, \`menu\`, \`acceptsReservations\`
- \`Menu\` + \`MenuSection\` + \`MenuItem\` per dish
- \`OpeningHoursSpecification\` for every day
- \`LocalBusiness\` (parent) with full NAP + \`geo\` + \`paymentAccepted\`
- \`Review\` + \`AggregateRating\` when real reviews exist

## Anti-patterns
- Never use stock photos for hero — every food image must be from this kitchen
- Never list "happy hour" or "weekend brunch" unless the kitchen actually serves it
- Never hide the menu behind a PDF — render as HTML so search indexes every dish
- Never use the words "exquisite", "culinary journey", "elevated", "curated"`;

const NONPROFIT_SITE = `---
name: nonprofit-site
description: Directive playbook for 501(c)(3) nonprofits, soup kitchens, shelters, churches, mission orgs.
when_to_use: When the business is a 501(c)(3), religious institution, NGO, community service org, or any tax-exempt mission-driven entity.
---

# Nonprofit Site Skill

## Goal
Drive recurring donations, volunteer sign-ups, and program awareness. Trust + transparency are load-bearing — every dollar claim must be cited; every photo must be real.

## Above the fold (mandatory)
- Mission statement in ONE sentence
- Primary CTA: \`Donate\` (largest, accent color)
- Secondary CTAs: \`Volunteer\` + \`Get Help\`
- Live impact counter via \`<app-rolling-counter>\` per cinematic-ui-patterns rule
- Photo: real people the org serves, from the org's own archives — never AI, never stock

## Required pages (24-route nonprofit floor)
- \`/\` home
- \`/about\`, \`/mission\`, \`/history\`, \`/team\`, \`/board\`
- \`/services\` (programs the org runs)
- \`/donate\` + \`/donate/{campaign}\` + \`/ways-to-give\` + \`/planned-giving\`
- \`/volunteer\` + \`/volunteer/{role}\`
- \`/financials\` + \`/annual-report\` + \`/transparency\`
- \`/news\` + \`/press\` + \`/blog\`
- \`/partners\` + \`/sponsors\`
- \`/contact\` + \`/locations\`
- \`/parish-toolkit\` (church-affiliated only)
- \`/get-help\` + \`/eligibility\` + \`/intake\`

## Donation rules
- Square Web Payments SDK (NOT Stripe) per payments-routing rule
- Preset tiers: $10/$25/$50/$100/$250/$1000 + custom
- Toggles: \`Make this monthly\`, \`In honor of\` / \`In memory of\`, \`Anonymous\`
- Show "Your $25 covers <concrete-outcome>" next to each tier
- After donation: auto-email tax receipt + Resend drip (week 1 thank-you; week 4 impact; month 6 next campaign)

## Trust scaffolding (mandatory)
- IRS Form 990 link — real PDF, not "coming soon"
- Charity Navigator / GuideStar / Candid badges with link-back
- Board roster with photos + bios (real people only)
- Annual report PDF with audited financials
- YoY program impact numbers, each APA-cited per citations rule

## Schema (JSON-LD per route)
- \`NGO\` on home with \`taxID\` (EIN), \`nonprofitStatus: Nonprofit501c3\`
- \`LocalBusiness\` (parent) with full NAP
- \`Organization\` with \`founder\`, \`foundingDate\`, \`numberOfEmployees\`
- \`Person\` per board member with \`jobTitle\`, \`sameAs\` (LinkedIn)
- \`DonateAction\` on every donate route
- \`Event\` for every fundraiser

## Demographic i18n (auto-fire per i18n-by-demographics rule)
- Pull ACS B16001 against the service area
- Every language ≥10% community share gets a full \`/{locale}/*\` mirror
- Newark NJ → en+es+pt (36% Hispanic + 4th-largest Brazilian-American pop)

## Anti-patterns
- Never fabricate impact numbers without a 990 backup
- Never AI-generate historical timeline photos
- Never use stock "generic volunteer hands" — use the org's real volunteers
- Never gate donate behind a wall of text — MUST be 1 click from home
- Never list "tax-deductible" without showing the EIN`;

const LOCAL_BUSINESS_SITE = `---
name: local-business-site
description: Directive playbook for service-area local businesses — plumbers, HVAC, salons, dentists, attorneys, accountants, contractors.
when_to_use: When the business has a defined local service area (city/county) and ≤5 fixed locations — trades, professional services, personal services, repair, legal, medical, retail.
---

# Local Business Site Skill

## Goal
Convert local searchers into bookings and calls. The site competes against Yelp, Google Maps, and a dozen mediocre competitors — it must rank, answer fast, and make booking a 1-tap action.

## Above the fold (mandatory)
- Headline: \`{service} in {city}\` exactly (load-bearing for SEO)
- Subhead: one differentiator (years in business, license number, response-time guarantee)
- Primary CTA: \`Book Now\` OR \`Call Now\` (whichever the trade closes on)
- Status pill: \`Available today\` / \`Booked through Friday\` / \`Open until 8pm\`
- Hero: photo of the actual owner / shop / signage, NEVER stock

## Required pages
- \`/\` home
- \`/services\` index + \`/services/{slug}\` (one per service, minimum 8)
- \`/about\` + \`/team\` (real headshots — never AI-generated)
- \`/service-area\` with shaded map + \`/c/{city}\` per city served
- \`/pricing\` (transparent ranges when possible; "free estimate" otherwise)
- \`/gallery\` (before/after for trades, portfolio for visual services)
- \`/reviews\` (pulled from Google + Yelp + Facebook)
- \`/booking\` + provider embed (Square / Calendly / Schedulista / Vagaro)
- \`/faq\` with 20+ real People-Also-Ask Q&A
- \`/contact\` with \`tel:\` + \`mailto:\` + Google Maps directions
- \`/insurance\` + \`/financing\` when applicable
- \`/blog/{post}\` — 5+ evergreen posts
- \`/emergency\` for trades that handle emergencies — hero is just the phone number, big

## Trust scaffolding (mandatory)
- State license number + link to licensing board lookup tool
- Insurance carrier + COI available on request
- Years in business + state-registration confirmation
- BBB rating + link when A or better
- Real owner bio + headshot
- Equipment + brand names (\`We use Milwaukee tools, Rheem water heaters\`)
- Trade-association memberships
- "What we can't fix" disclosure — paradoxically builds trust

## Local SEO (mandatory)
- \`LocalBusiness\` JSON-LD with full NAP + \`geo\` + \`openingHoursSpecification\`
- One block per location if multi-location
- \`Service\` schema for every service; \`OfferCatalog\` for the menu
- \`FAQPage\` with real Q&A
- \`Review\` + \`AggregateRating\` (real reviews only)
- \`BreadcrumbList\` on every nested route
- City × service pSEO matrix: every {city} × every {service} = a route (cap 200/axis)

## Conversion rules
- \`data-bcl-phone-click\` on every \`tel:\` link
- \`data-bcl-booking-click\` on every booking CTA
- \`data-bcl-direction-click\` on every map link
- Sticky \`Call\` button on mobile
- Web forms post to \`/api/contact-form/{slug}\` with Turnstile invisible widget

## Anti-patterns
- Never invent customer testimonials — show "Reviews coming" + Google link until real ones exist
- Never use AI-generated team headshots
- Never claim credentials without state-board verification
- Never list 24/7 emergency without an actual on-call rotation
- Never use the words "premier", "trusted", "leading", "best-in-class"`;

const SKILL_FILES: Record<string, string> = {
  'restaurant-site': RESTAURANT_SITE,
  'nonprofit-site': NONPROFIT_SITE,
  'local-business-site': LOCAL_BUSINESS_SITE,
};

/** Parsed-out frontmatter + body for a single skill. */
export interface SkillManifest {
  name: string;
  description: string;
  when_to_use: string;
  body: string;
}

const skillCache = new Map<string, SkillManifest>();

function parseSkill(slug: string, raw: string): SkillManifest {
  // Minimal YAML frontmatter parser — only the three keys we care about.
  // Skills authored by humans, no need for a full YAML dep at runtime.
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(raw);
  const frontmatter = match ? match[1] : '';
  const body = match ? match[2].trim() : raw.trim();

  const read = (key: string): string => {
    const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm');
    const m = re.exec(frontmatter);
    if (!m) return '';
    // Strip optional surrounding quotes
    return m[1].replace(/^['"]|['"]$/g, '').trim();
  };

  return {
    name: read('name') || slug,
    description: read('description') || '',
    when_to_use: read('when_to_use') || '',
    body,
  };
}

/**
 * Enumerate every bundled skill manifest (frontmatter only — body lazy).
 *
 * @remarks
 * Cheap — parses once, then serves from in-memory cache. Use for tool-def
 * generation and admin UI listings.
 *
 * @example
 * ```ts
 * for (const s of listSkills()) console.warn(s.name, '—', s.description);
 * ```
 */
export function listSkills(): SkillManifest[] {
  for (const [slug, raw] of Object.entries(SKILL_FILES)) {
    if (!skillCache.has(slug)) skillCache.set(slug, parseSkill(slug, raw));
  }
  return Array.from(skillCache.values());
}

/**
 * Load a single skill by slug (filename without `.md`).
 *
 * @returns The full manifest including body, or `null` when the slug is
 * unknown. Logs a warn so misnamed skill references surface in logs.
 *
 * @example
 * ```ts
 * const skill = loadSkill('restaurant-site');
 * if (skill) systemPrompt += '\n\n' + skill.body;
 * ```
 */
export function loadSkill(name: string): SkillManifest | null {
  if (skillCache.has(name)) return skillCache.get(name) ?? null;
  const raw = SKILL_FILES[name];
  if (!raw) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'anthropic_skills',
        message: 'unknown_skill',
        requested: name,
      }),
    );
    return null;
  }
  const parsed = parseSkill(name, raw);
  skillCache.set(name, parsed);
  return parsed;
}

/**
 * Build a SINGLE Anthropic tool definition that exposes every bundled skill
 * as choices on the `name` enum.
 *
 * @remarks
 * One tool, many skills — beats one-tool-per-skill (which bloats the tool
 * surface and confuses the model's planning). The dispatch helper
 * {@link executeSkillTool} resolves `tool_use.input.name` against the
 * bundled registry and returns the body.
 *
 * @example
 * ```ts
 * const tools = [buildSkillToolDefs(), buildMemoryToolDef(scope)];
 * ```
 */
export function buildSkillToolDefs(): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  const skills = listSkills();
  const names = skills.map((s) => s.name);
  const catalog = skills
    .map((s) => `- \`${s.name}\` — ${s.description} (when_to_use: ${s.when_to_use})`)
    .join('\n');

  return {
    name: 'load_skill',
    description: [
      'Load one bundled site-build skill on demand. Skills are short',
      'directive playbooks for common business verticals. Load only',
      'the skill whose `when_to_use` matches the current task — never',
      'load all of them up front.',
      '',
      'Available skills:',
      catalog,
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: names.length ? names : ['__none__'],
          description: 'Slug of the skill to load.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  };
}

/**
 * Execute a `load_skill` tool_use block and return the skill body as the
 * `tool_result` content payload.
 *
 * @example
 * ```ts
 * const out = executeSkillTool({ input: block.input });
 * messages.push({ role: 'user', content: [{
 *   type: 'tool_result', tool_use_id: block.id, content: out }] });
 * ```
 */
export function executeSkillTool(toolUse: { input: { name?: string } | Record<string, unknown> }): string {
  const slug = String((toolUse.input as { name?: string })?.name ?? '');
  if (!slug) return JSON.stringify({ ok: false, error: 'missing_name' });
  const skill = loadSkill(slug);
  if (!skill) {
    return JSON.stringify({
      ok: false,
      error: 'unknown_skill',
      requested: slug,
      available: listSkills().map((s) => s.name),
    });
  }
  return JSON.stringify({
    ok: true,
    name: skill.name,
    description: skill.description,
    when_to_use: skill.when_to_use,
    body: skill.body,
  });
}
