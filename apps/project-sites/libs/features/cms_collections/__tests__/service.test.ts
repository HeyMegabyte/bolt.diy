import { buildCmsModel, detectRelationships, availableCollections } from '../service.js';

describe('buildCmsModel', () => {
  test('returns complete model with collections and relationships', () => {
    const model = buildCmsModel('site-1', ['team', 'services', 'testimonials']);
    expect(model.siteId).toBe('site-1');
    expect(model.collections).toHaveLength(3);
    expect(model.collectionCount).toBe(3);
    expect(model.relationships.length).toBeGreaterThan(0);
    expect(model.generatedAt).toEqual(expect.any(String));
  });

  test('each collection has required fields', () => {
    const model = buildCmsModel('s1', ['team', 'services']);
    for (const col of model.collections) {
      expect(col.slug).toBeTruthy();
      expect(col.displayName).toBeTruthy();
      expect(col.fields.length).toBeGreaterThan(0);
      expect(col.jsonLdType).toBeTruthy();
    }
  });

  test('every field has name, type, required, and description', () => {
    const model = buildCmsModel('s1', ['team']);
    for (const field of model.collections[0].fields) {
      expect(field.name).toBeTruthy();
      expect(field.type).toBeTruthy();
      expect(typeof field.required).toBe('boolean');
      expect(field.description).toBeTruthy();
    }
  });

  test('select fields have options', () => {
    const model = buildCmsModel('s1', ['menu_items']);
    const dietary = model.collections[0].fields.find((f) => f.name === 'dietary');
    expect(dietary?.type).toBe('multi_select');
    expect(dietary?.options?.length).toBeGreaterThan(0);
  });

  test('reference fields have referenceCollection', () => {
    const model = buildCmsModel('s1', ['services']);
    const ref = model.collections[0].fields.find((f) => f.name === 'team_member');
    expect(ref?.type).toBe('reference');
    expect(ref?.referenceCollection).toBe('team');
  });

  test('detects relationships between enabled collections', () => {
    const model = buildCmsModel('s1', ['team', 'services']);
    const rel = model.relationships.find((r) => r.fromField === 'team_member');
    expect(rel).toBeDefined();
    expect(rel?.from).toBe('services');
    expect(rel?.to).toBe('team');
  });

  test('no relationships when target collection not enabled', () => {
    // services references team, but team is not enabled
    const model = buildCmsModel('s1', ['services']);
    const rel = model.relationships.find((r) => r.fromField === 'team_member');
    expect(rel).toBeUndefined();
  });

  test('dynamic route patterns are correct', () => {
    const model = buildCmsModel('s1', ['team', 'events']);
    const team = model.collections.find((c) => c.slug === 'team');
    expect(team?.dynamicRoute).toBe('/team/{slug}');
    const events = model.collections.find((c) => c.slug === 'events');
    expect(events?.dynamicRoute).toBe('/events/{slug}');
  });

  test('singletons have no dynamic route', () => {
    const model = buildCmsModel('s1', ['testimonials', 'faq']);
    for (const col of model.collections) {
      expect(col.dynamicRoute).toBeNull();
    }
  });

  test('jsonLdType is set per collection', () => {
    const model = buildCmsModel('s1', ['team', 'services', 'events', 'menu_items']);
    expect(model.collections.find((c) => c.slug === 'team')?.jsonLdType).toBe('Person');
    expect(model.collections.find((c) => c.slug === 'services')?.jsonLdType).toBe('Service');
    expect(model.collections.find((c) => c.slug === 'events')?.jsonLdType).toBe('Event');
  });

  test('availableCollections lists all built-in templates', () => {
    const list = availableCollections();
    expect(list).toContain('team');
    expect(list).toContain('services');
    expect(list).toContain('testimonials');
    expect(list).toContain('portfolio');
    expect(list).toContain('events');
    expect(list).toContain('faq');
    expect(list).toContain('menu_items');
    expect(list.length).toBe(7);
  });
});
