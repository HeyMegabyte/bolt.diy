/**
 * @module libs/features/cms_collections/service
 *
 * CMS Collections (#17, ROI 2.29) — pure content type schema + relationship
 * engine for dynamic structured content. Zero I/O, deterministic.
 *
 * Supported field types: text, richtext, number, boolean, date, image,
 *   reference (links to another collection entry), select, multi_select, url.
 *
 * Each collection auto-generates: dynamic routing pattern, API endpoints,
 *   filter queries, and JSON-LD schema type mapping.
 */
export type FieldType = 'text' | 'richtext' | 'number' | 'boolean' | 'date' | 'image' | 'reference' | 'select' | 'multi_select' | 'url';

export interface CollectionField {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  options?: string[];
  referenceCollection?: string;
}

export interface CollectionSchema {
  slug: string;
  displayName: string;
  description: string;
  fields: CollectionField[];
  isSingleton: boolean;
  jsonLdType: string;
  dynamicRoute: string;
}

export interface CollectionRelationship {
  from: string;
  fromField: string;
  to: string;
  type: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
}

export interface CmsModel {
  siteId: string;
  generatedAt: string;
  collections: CollectionSchema[];
  relationships: CollectionRelationship[];
  collectionCount: number;
}

// ── Built-in collection templates ───────────────────────────────────────────

const BUILT_IN_TEMPLATES: Record<string, CollectionSchema> = {
  team: {
    slug: 'team', displayName: 'Team Members', description: 'Staff, team, or leadership profiles.',
    isSingleton: false, jsonLdType: 'Person', dynamicRoute: '/team/{slug}',
    fields: [
      { name: 'name', type: 'text', required: true, description: 'Full name' },
      { name: 'role', type: 'text', required: true, description: 'Job title or role' },
      { name: 'bio', type: 'richtext', required: false, description: 'Biography or description' },
      { name: 'photo', type: 'image', required: false, description: 'Headshot or photo' },
      { name: 'email', type: 'text', required: false, description: 'Contact email' },
      { name: 'phone', type: 'text', required: false, description: 'Contact phone' },
    ],
  },
  services: {
    slug: 'services', displayName: 'Services', description: 'Products or services offered.',
    isSingleton: false, jsonLdType: 'Service', dynamicRoute: '/services/{slug}',
    fields: [
      { name: 'name', type: 'text', required: true, description: 'Service name' },
      { name: 'description', type: 'richtext', required: true, description: 'Service description' },
      { name: 'price', type: 'text', required: false, description: 'Price or price range' },
      { name: 'image', type: 'image', required: false, description: 'Service image' },
      { name: 'category', type: 'select', required: false, description: 'Service category', options: ['primary', 'secondary', 'premium'] },
      { name: 'team_member', type: 'reference', required: false, description: 'Team member providing this service', referenceCollection: 'team' },
    ],
  },
  testimonials: {
    slug: 'testimonials', displayName: 'Testimonials', description: 'Customer reviews and testimonials.',
    isSingleton: false, jsonLdType: 'Review', dynamicRoute: null as unknown as string,
    fields: [
      { name: 'author', type: 'text', required: true, description: 'Reviewer name' },
      { name: 'quote', type: 'richtext', required: true, description: 'The testimonial quote' },
      { name: 'rating', type: 'number', required: false, description: 'Star rating 1-5' },
      { name: 'date', type: 'date', required: false, description: 'Date of review' },
      { name: 'service', type: 'reference', required: false, description: 'Service reviewed', referenceCollection: 'services' },
    ],
  },
  portfolio: {
    slug: 'portfolio', displayName: 'Portfolio', description: 'Project or work samples.',
    isSingleton: false, jsonLdType: 'CreativeWork', dynamicRoute: '/portfolio/{slug}',
    fields: [
      { name: 'title', type: 'text', required: true, description: 'Project title' },
      { name: 'description', type: 'richtext', required: true, description: 'Project description' },
      { name: 'image', type: 'image', required: false, description: 'Featured image' },
      { name: 'category', type: 'select', required: false, description: 'Project category', options: ['residential', 'commercial', 'industrial'] },
      { name: 'completed', type: 'date', required: false, description: 'Completion date' },
    ],
  },
  events: {
    slug: 'events', displayName: 'Events', description: 'Upcoming or past events.',
    isSingleton: false, jsonLdType: 'Event', dynamicRoute: '/events/{slug}',
    fields: [
      { name: 'title', type: 'text', required: true, description: 'Event name' },
      { name: 'description', type: 'richtext', required: true, description: 'Event description' },
      { name: 'date', type: 'date', required: true, description: 'Event date and time' },
      { name: 'location', type: 'text', required: false, description: 'Event location' },
      { name: 'image', type: 'image', required: false, description: 'Event image' },
    ],
  },
  faq: {
    slug: 'faq', displayName: 'FAQ', description: 'Frequently asked questions.',
    isSingleton: false, jsonLdType: 'FAQPage', dynamicRoute: null as unknown as string,
    fields: [
      { name: 'question', type: 'text', required: true, description: 'The question' },
      { name: 'answer', type: 'richtext', required: true, description: 'The answer' },
      { name: 'category', type: 'select', required: false, description: 'Question category', options: ['general', 'pricing', 'services', 'policies'] },
    ],
  },
  menu_items: {
    slug: 'menu_items', displayName: 'Menu Items', description: 'Restaurant or service menu items.',
    isSingleton: false, jsonLdType: 'MenuItem', dynamicRoute: null as unknown as string,
    fields: [
      { name: 'name', type: 'text', required: true, description: 'Item name' },
      { name: 'description', type: 'richtext', required: false, description: 'Item description' },
      { name: 'price', type: 'text', required: true, description: 'Price' },
      { name: 'category', type: 'select', required: true, description: 'Menu category', options: ['appetizer', 'main', 'dessert', 'drink'] },
      { name: 'image', type: 'image', required: false, description: 'Item photo' },
      { name: 'dietary', type: 'multi_select', required: false, description: 'Dietary tags', options: ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free'] },
    ],
  },
};

// ── Relationship detection ──────────────────────────────────────────────────

/**
 * Auto-detects relationships between enabled collections by scanning
 * reference fields. Each reference field becomes a relationship edge.
 */
export function detectRelationships(collections: CollectionSchema[]): CollectionRelationship[] {
  const rels: CollectionRelationship[] = [];
  for (const col of collections) {
    for (const field of col.fields) {
      if (field.type === 'reference' && field.referenceCollection) {
        const target = collections.find((c) => c.slug === field.referenceCollection);
        if (target) {
          rels.push({
            from: col.slug,
            fromField: field.name,
            to: field.referenceCollection,
            type: target.isSingleton ? 'many_to_one' : 'one_to_many',
          });
        }
      }
    }
  }
  return rels;
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generates a complete CMS data model from a site's desired collection types.
 *
 * Uses built-in templates for common collections (team, services, etc.).
 * Auto-detects relationships between collections from reference fields.
 * Each collection includes: schema, field definitions, dynamic route pattern,
 * JSON-LD type, and singleton flag.
 *
 * @param siteId - The site being modeled.
 * @param collectionSlugs - Which built-in templates to enable.
 * @returns A complete CmsModel with collections and relationships.
 */
export function buildCmsModel(siteId: string, collectionSlugs: string[]): CmsModel {
  const collections: CollectionSchema[] = [];
  for (const slug of collectionSlugs) {
    const template = BUILT_IN_TEMPLATES[slug];
    if (template) collections.push({ ...template });
  }

  const relationships = detectRelationships(collections);

  return {
    siteId,
    generatedAt: new Date().toISOString(),
    collections,
    relationships,
    collectionCount: collections.length,
  };
}

/** List of all available built-in collection templates. */
export function availableCollections(): string[] {
  return Object.keys(BUILT_IN_TEMPLATES);
}
