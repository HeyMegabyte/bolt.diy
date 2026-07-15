/**
 * @module libs/features/code_export/__tests__/service.test
 *
 * Unit tests for the CF project generator. All pure — zero I/O, zero mocks.
 */
import { generateCfProject } from '../service.js';
import type { SiteBindings } from '../schemas.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function minimalBindings(overrides: Partial<SiteBindings> = {}): SiteBindings {
  return {
    slug: 'test-site',
    pages: [{ path: '/', title: 'Home', content: '<h1>Hello World</h1>' }],
    ...overrides,
  };
}

function findFile(files: { path: string; content: string }[], path: string): string {
  const f = files.find((f) => f.path === path);
  if (!f) throw new Error(`File not found: ${path}`);
  return f.content;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('generateCfProject', () => {
  // ── Baseline output ─────────────────────────────────────────────────────

  test('produces at least 6 core files', () => {
    const project = generateCfProject(minimalBindings());
    expect(project.fileCount).toBeGreaterThanOrEqual(6);
    expect(project.projectName).toBe('test-site-site');
  });

  test('every file has valid content and size', () => {
    const project = generateCfProject(minimalBindings());
    for (const file of project.files) {
      expect(file.path).toBeTruthy();
      expect(file.content).toEqual(expect.any(String));
      expect(file.sizeBytes).toBeGreaterThan(0);
      expect(file.sizeBytes).toBe(new TextEncoder().encode(file.content).length);
    }
  });

  test('totalSize matches sum of file sizes', () => {
    const project = generateCfProject(minimalBindings());
    const sum = project.files.reduce((s, f) => s + f.sizeBytes, 0);
    expect(project.totalSize).toBe(sum);
  });

  // ── wrangler.toml ────────────────────────────────────────────────────────

  test('wrangler.toml includes project name and compat date', () => {
    const content = findFile(generateCfProject(minimalBindings()).files, 'wrangler.toml');
    expect(content).toContain('name = "test-site-site"');
    expect(content).toContain('compatibility_date = "2026-07-15"');
    expect(content).toContain('main = "src/index.ts"');
  });

  test('wrangler.toml includes D1 binding when configured', () => {
    const project = generateCfProject(
      minimalBindings({ d1DatabaseName: 'my-db', d1DatabaseId: 'abc-123' }),
    );
    const content = findFile(project.files, 'wrangler.toml');
    expect(content).toContain('binding = "DB"');
    expect(content).toContain('database_name = "my-db"');
    expect(content).toContain('database_id = "abc-123"');
  });

  test('wrangler.toml omits D1 when not configured', () => {
    const content = findFile(generateCfProject(minimalBindings()).files, 'wrangler.toml');
    expect(content).not.toContain('[[d1_databases]]');
  });

  test('wrangler.toml includes R2 binding when configured', () => {
    const project = generateCfProject(minimalBindings({ r2BucketName: 'my-bucket' }));
    const content = findFile(project.files, 'wrangler.toml');
    expect(content).toContain('binding = "ASSETS"');
    expect(content).toContain('bucket_name = "my-bucket"');
  });

  test('wrangler.toml includes KV binding when configured', () => {
    const project = generateCfProject(
      minimalBindings({ kvNamespaceName: 'my-kv', kvNamespaceId: 'kv-456' }),
    );
    const content = findFile(project.files, 'wrangler.toml');
    expect(content).toContain('binding = "CACHE"');
    expect(content).toContain('id = "kv-456"');
  });

  test('wrangler.toml includes custom domain route when hostname set', () => {
    const project = generateCfProject(
      minimalBindings({ primaryHostname: 'example.com' }),
    );
    const content = findFile(project.files, 'wrangler.toml');
    expect(content).toContain('pattern = "example.com"');
    expect(content).toContain('custom_domain = true');
  });

  // ── Worker source ────────────────────────────────────────────────────────

  test('src/index.ts includes Hono app and health endpoint', () => {
    const content = findFile(generateCfProject(minimalBindings()).files, 'src/index.ts');
    expect(content).toContain("import { Hono } from 'hono'");
    expect(content).toContain("app.get('/health'");
    expect(content).toContain("export default app");
  });

  test('src/index.ts includes sitemap routes from pages', () => {
    const project = generateCfProject(
      minimalBindings({
        pages: [
          { path: '/', title: 'Home', content: '<h1>Home</h1>' },
          { path: '/about', title: 'About', content: '<h1>About</h1>' },
        ],
      }),
    );
    const content = findFile(project.files, 'src/index.ts');
    expect(content).toContain('"/"');
    expect(content).toContain('"/about"');
  });

  // ── package.json ─────────────────────────────────────────────────────────

  test('package.json is valid JSON with required fields', () => {
    const content = findFile(generateCfProject(minimalBindings()).files, 'package.json');
    const pkg = JSON.parse(content);
    expect(pkg.name).toBe('test-site-site');
    expect(pkg.type).toBe('module');
    expect(pkg.dependencies).toHaveProperty('hono');
  });

  // ── tsconfig.json ────────────────────────────────────────────────────────

  test('tsconfig.json is valid JSON with strict mode', () => {
    const content = findFile(generateCfProject(minimalBindings()).files, 'tsconfig.json');
    const cfg = JSON.parse(content);
    expect(cfg.compilerOptions.strict).toBe(true);
    expect(cfg.compilerOptions.target).toBe('ES2022');
  });

  // ── README.md ────────────────────────────────────────────────────────────

  test('README.md includes deploy instructions and project structure', () => {
    const content = findFile(generateCfProject(minimalBindings()).files, 'README.md');
    expect(content).toContain('npx wrangler deploy');
    expect(content).toContain('npm install');
    expect(content).toContain('ProjectSites.dev');
  });

  test('README.md mentions custom domain when configured', () => {
    const project = generateCfProject(
      minimalBindings({ primaryHostname: 'example.com' }),
    );
    const content = findFile(project.files, 'README.md');
    expect(content).toContain('example.com');
  });

  // ── D1 migrations ────────────────────────────────────────────────────────

  test('generates D1 schema migration when schema provided', () => {
    const project = generateCfProject(
      minimalBindings({
        d1Schema: ['CREATE TABLE users (id TEXT PRIMARY KEY)'],
      }),
    );
    const content = findFile(project.files, 'migrations/0001_schema.sql');
    expect(content).toContain('CREATE TABLE users');
  });

  test('does not generate D1 migration when no schema', () => {
    const project = generateCfProject(minimalBindings());
    const hasMigration = project.files.some(
      (f) => f.path === 'migrations/0001_schema.sql',
    );
    expect(hasMigration).toBe(false);
  });

  test('generates seed migration when data provided', () => {
    const project = generateCfProject(
      minimalBindings({
        d1Data: ["INSERT INTO users VALUES ('1')"],
      }),
    );
    const content = findFile(project.files, 'migrations/0002_seed.sql');
    expect(content).toContain("INSERT INTO users VALUES ('1')");
  });

  // ── Static assets ────────────────────────────────────────────────────────

  test('includes static assets under public/', () => {
    const project = generateCfProject(
      minimalBindings({
        staticAssets: [
          { path: 'style.css', content: 'body { color: red; }' },
        ],
      }),
    );
    const content = findFile(project.files, 'public/style.css');
    expect(content).toContain('body { color: red; }');
  });

  // ── Upload script ────────────────────────────────────────────────────────

  test('generates upload-assets.sh helper script', () => {
    const project = generateCfProject(
      minimalBindings({ r2BucketName: 'my-bucket' }),
    );
    const content = findFile(project.files, 'scripts/upload-assets.sh');
    expect(content).toContain('my-bucket');
    expect(content).toContain('wrangler r2 object put');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  test('handles empty pages gracefully', () => {
    const project = generateCfProject(minimalBindings({ pages: [] }));
    const content = findFile(project.files, 'src/index.ts');
    expect(content).toContain('SITEMAP_ROUTES');
  });

  test('handles very long slugs', () => {
    const longSlug = 'a'.repeat(63);
    const project = generateCfProject(minimalBindings({ slug: longSlug }));
    expect(project.projectName).toContain(longSlug);
  });

  test('metadata fields are correct', () => {
    const project = generateCfProject(minimalBindings());
    expect(project.d1Binding).toBe('DB');
    expect(project.r2Binding).toBe('ASSETS');
    expect(project.generatedAt).toEqual(expect.any(String));
    expect(new Date(project.generatedAt).getTime()).not.toBeNaN();
  });
});
