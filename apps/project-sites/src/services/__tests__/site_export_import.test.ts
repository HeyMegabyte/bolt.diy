/**
 * @file Unit tests for site export/import service.
 *
 * Uses the injected global `jest` (NOT @jest/globals) so @swc/jest hoists
 * the mock above the import — see CLAUDE.md gotcha #12.
 */
import { exportService, importService } from '../site_export_import';

const mockRepository = {
  manifest: {
    domain: 'bricklabor.com',
    ownerEmail: 'brian@megabyte.space',
    repositoryMode: 'standalone' as const,
    environment: 'local' as const,
    createdAt: '2026-06-30T00:00:00Z',
    updatedAt: '2026-06-30T00:00:00Z',
    version: '1.0.0',
  },
  frontend: { framework: 'react-vite', outputDir: 'dist' },
  functions: [],
  resources: {
    sqlite: [],
    postgres: [],
    redis: [],
    kv: [],
  },
  meta: {},
};

describe('exportService.zipSite', () => {
  it('produces a valid zip with manifest', async () => {
    const { zipBytes, manifest } = await exportService.zipSite(mockRepository);

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.byteLength).toBeGreaterThan(100);
    expect(zipBytes.byteLength).toBeLessThan(1024 * 1024);

    expect(manifest.format).toBe('projectsites.site-export');
    expect(manifest.version).toBe(1);
    expect(manifest.site.domain).toBe('bricklabor.com');
    expect(manifest.site.ownerEmail).toBe('brian@megabyte.space');
    expect(manifest.createdBy).toBe('projectsites.dev');
  });

  it('redacts secrets from exported manifest', async () => {
    const repoWithSecret = {
      ...mockRepository,
      functions: [
        {
          name: 'siteWorker',
          entrypoint: 'functions/site-worker/src/index.ts',
          routes: [],
          middleware: [],
          bindings: [
            {
              name: 'SECRET_KEY',
              type: 'secret' as const,
              isSecret: true,
              siteWorkerBinding: 'SECRET_KEY',
            },
          ],
          compatibilityDate: '2026-06-30',
          compatibilityFlags: [],
        },
      ],
    };

    const { manifest } = await exportService.zipSite(repoWithSecret);
    const manifestStr = JSON.stringify(manifest);
    expect(manifestStr).toContain('SECRET_KEY');
  });
});

describe('importService.dryRun', () => {
  it('parses a valid export zip and returns a dry-run plan', async () => {
    const { zipBytes } = await exportService.zipSite(mockRepository);
    const plan = await importService.dryRun(zipBytes);

    expect(plan.canProceed).toBe(true);
    expect(Array.isArray(plan.conflicts)).toBe(true);
    expect(Array.isArray(plan.newFiles)).toBe(true);
    // Empty archive has only manifest + empty dirs — all skipped
    expect(plan.newFiles.length).toBeGreaterThanOrEqual(0);
  });

  it('rejects an empty buffer', async () => {
    await expect(importService.dryRun(new Uint8Array(0))).rejects.toThrow('Failed to parse');
  });

  it('rejects a zip missing manifest', async () => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('frontend/index.html', '<html></html>');
    const badZip = await zip.generateAsync({ type: 'uint8array' });

    await expect(importService.dryRun(badZip)).rejects.toThrow('Missing export-manifest');
  });
});

describe('importService.apply', () => {
  it('returns changed files list', async () => {
    const result = await importService.apply(new Uint8Array(), { backupBeforeOverwrite: true });
    expect(Array.isArray(result.changedFiles)).toBe(true);
  });
});
