/**
 * Unit tests for the preview_share_card feature-module service layer.
 *
 * The card builder is pure (no env, no I/O), so these exercise it directly via
 * dynamic import (the site_doctor pattern). The underlying core has its own
 * coverage in src/__tests__/preview_share_card.test.ts.
 */

import { describe, it, expect } from '@jest/globals';

describe('preview_share_card/service — buildShareCardForSite', () => {
  it('derives the canonical preview URL from the slug', async () => {
    const { buildShareCardForSite } = await import('../service.js');
    const card = buildShareCardForSite({ slug: 'vitos', businessName: "Vito's Mens Salon" });
    expect(card.links.copy).toBe('https://vitos.projectsites.dev');
    expect(card.og.url).toBe('vitos.projectsites.dev');
    expect(card.messages.generic).toContain("Vito's Mens Salon");
  });

  it('honors a custom base domain', async () => {
    const { buildShareCardForSite } = await import('../service.js');
    const card = buildShareCardForSite({ slug: 'acme', businessName: 'Acme' }, 'example.com');
    expect(card.links.copy).toBe('https://acme.example.com');
  });

  it('passes the tagline through as the OG subtitle', async () => {
    const { buildShareCardForSite } = await import('../service.js');
    const card = buildShareCardForSite({
      slug: 'acme',
      businessName: 'Acme',
      tagline: 'Quality since 1999',
    });
    expect(card.og.subtitle).toBe('Quality since 1999');
  });

  it('degrades gracefully when the slug is empty (no throw, empty url)', async () => {
    const { buildShareCardForSite } = await import('../service.js');
    const card = buildShareCardForSite({ slug: '', businessName: 'Acme' });
    expect(card.links.copy).toBe('');
    expect(card.og.title).toBe('Acme');
  });
});

describe('preview_share_card/service — FLAG_KEY', () => {
  it('FLAG_KEY equals the module slug', async () => {
    const { FLAG_KEY } = await import('../service.js');
    expect(FLAG_KEY).toBe('preview_share_card');
  });
});

describe('preview_share_card/schemas — response shape', () => {
  it('a built card is schema-valid', async () => {
    const { buildShareCardForSite } = await import('../service.js');
    const { ShareCardResponseSchema } = await import('../schemas.js');
    const card = buildShareCardForSite({ slug: 'vitos', businessName: "Vito's" });
    expect(ShareCardResponseSchema.safeParse(card).success).toBe(true);
  });
});
