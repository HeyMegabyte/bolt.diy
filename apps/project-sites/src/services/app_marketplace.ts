/** @module services/app_marketplace — A18 public app listings. Pure, never throws. */
export interface AppListing {
  slug: string;
  name: string;
  description: string;
  url: string;
  category: string;
  tags: readonly string[];
  status: 'live' | 'beta' | 'coming_soon';
}
export const APP_LISTINGS: readonly AppListing[] = [
  {
    slug: 'plane',
    name: 'Plane',
    description: 'Open-source project management',
    url: 'https://pm.projectsites.dev',
    category: 'pm',
    tags: ['project-management', 'kanban', 'cycles'],
    status: 'live',
  },
  {
    slug: 'twenty',
    name: 'Twenty CRM',
    description: 'Modern open-source CRM',
    url: 'https://crm.projectsites.dev',
    category: 'crm',
    tags: ['crm', 'sales', 'contacts'],
    status: 'live',
  },
  {
    slug: 'listmonk',
    name: 'Listmonk',
    description: 'Self-hosted newsletter & mailing list',
    url: 'https://mail.projectsites.dev',
    category: 'email',
    tags: ['email', 'newsletter', 'campaigns'],
    status: 'live',
  },
  {
    slug: 'unkey',
    name: 'Unkey',
    description: 'API key management & rate limiting',
    url: 'https://api.projectsites.dev',
    category: 'auth',
    tags: ['api-keys', 'rate-limiting', 'security'],
    status: 'live',
  },
  {
    slug: 'social_native',
    name: 'Native Social',
    description: 'Social media publishing — CF-native (Workflows v2 + Upstash + D1)',
    url: 'https://social.projectsites.dev',
    category: 'social',
    tags: ['social-media', 'scheduling', 'analytics', 'cf-native'],
    status: 'live',
  },
  {
    slug: 'payload',
    name: 'Payload CMS',
    description: 'Headless CMS for content teams',
    url: 'https://cms.projectsites.dev',
    category: 'media',
    tags: ['cms', 'content', 'headless'],
    status: 'beta',
  },
];
export function appsByCategory(category: string): readonly AppListing[] {
  const c = category.trim().toLowerCase();
  return APP_LISTINGS.filter((a) => a.category === c);
}
export function searchApps(query: string): readonly AppListing[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return APP_LISTINGS.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some((t) => t.includes(q)),
  );
}
export function generateJsonLd(app: AppListing): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `${app.name} — ProjectSites`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: app.url,
    description: app.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}
