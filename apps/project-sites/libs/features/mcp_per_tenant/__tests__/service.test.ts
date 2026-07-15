import { generateMcpManifest } from '../service.js';

describe('generateMcpManifest', () => {
  test('returns manifest with all required fields', () => {
    const m = generateMcpManifest('site-1', 'my-bakery');
    expect(m.siteId).toBe('site-1');
    expect(m.siteSlug).toBe('my-bakery');
    expect(m.serverUrl).toContain('my-bakery');
    expect(m.serverUrl).toContain('https://mcp.');
    expect(m.toolCount).toBe(9);
    expect(m.tools).toHaveLength(9);
    expect(m.authMethod).toBe('oauth2_1');
    expect(m.oauthScopes.length).toBeGreaterThanOrEqual(3);
    expect(m.generatedAt).toEqual(expect.any(String));
  });

  test('every tool has name, description, inputSchema, and rateLimitClass', () => {
    const m = generateMcpManifest('s1', 'test');
    for (const tool of m.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');
      expect(['read', 'write', 'destructive']).toContain(tool.rateLimitClass);
    }
  });

  test('read tools have read rate limit class', () => {
    const m = generateMcpManifest('s1', 'test');
    const readers = m.tools.filter((t) => t.rateLimitClass === 'read');
    expect(readers.length).toBeGreaterThanOrEqual(3);
    expect(readers.map((t) => t.name)).toEqual(
      expect.arrayContaining(['read_page', 'list_pages', 'list_media', 'read_analytics']),
    );
  });

  test('write tools have write rate limit class', () => {
    const m = generateMcpManifest('s1', 'test');
    const writers = m.tools.filter((t) => t.rateLimitClass === 'write');
    expect(writers.length).toBeGreaterThanOrEqual(3);
    expect(writers.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_page', 'update_page', 'upload_media', 'manage_seo']),
    );
  });

  test('destructive tools require confirmation', () => {
    const m = generateMcpManifest('s1', 'test');
    const destructive = m.tools.find((t) => t.name === 'delete_page');
    expect(destructive).toBeDefined();
    expect(destructive!.rateLimitClass).toBe('destructive');
    expect(destructive!.inputSchema).toHaveProperty('required');
    const required = destructive!.inputSchema as { required: string[] };
    expect(required.required).toContain('confirm');
  });

  test('serverUrl uses site slug', () => {
    const m = generateMcpManifest('s1', 'cool-cafe');
    expect(m.serverUrl).toBe('https://mcp.cool-cafe.projectsites.dev');
  });

  test('oauthScopes include read, write, media, analytics', () => {
    const m = generateMcpManifest('s1', 'test');
    expect(m.oauthScopes).toContain('site:read');
    expect(m.oauthScopes).toContain('site:write');
    expect(m.oauthScopes).toContain('site:media');
    expect(m.oauthScopes).toContain('site:analytics');
  });

  test('tool names are unique', () => {
    const m = generateMcpManifest('s1', 'test');
    const names = m.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('generatedAt is a valid ISO date', () => {
    const m = generateMcpManifest('s1', 'test');
    expect(new Date(m.generatedAt).getTime()).not.toBeNaN();
  });
});
