/**
 * Browser job execution — artifact key + run→store→envelope orchestration
 * (the CF Browser Run drive is integration-level, not unit-tested here).
 */
import {
  browserArtifactKey,
  runArtifactJob,
  type BrowserRunner,
} from '../services/browser_execution.js';
import type { Env } from '../types/env.js';

describe('browserArtifactKey', () => {
  it('is tenant-scoped, time-stamped, and per-purpose; sanitises ids', () => {
    expect(
      browserArtifactKey({ tenantId: 't1', siteId: 's1' }, 'screenshot', '1700000000000'),
    ).toBe('browser-jobs/t1/s1/1700000000000-screenshot.png');
    expect(browserArtifactKey({ tenantId: 't1', siteId: 's1' }, 'pdf', '1700000000000')).toBe(
      'browser-jobs/t1/s1/1700000000000-pdf.pdf',
    );
    expect(browserArtifactKey({ tenantId: 'a/b', siteId: 'c d' }, 'screenshot', '1')).toContain(
      'browser-jobs/a_b/c_d/',
    );
  });
});

describe('runArtifactJob', () => {
  function r2Stub() {
    const puts: { key: string; bytes: number; contentType?: string }[] = [];
    const env = {
      SITES_BUCKET: {
        put: async (
          key: string,
          body: Uint8Array,
          opts?: { httpMetadata?: { contentType?: string } },
        ) => {
          puts.push({ key, bytes: body.byteLength, contentType: opts?.httpMetadata?.contentType });
        },
      },
    } as unknown as Pick<Env, 'SITES_BUCKET'>;
    return { puts, env };
  }

  const runner: BrowserRunner = {
    screenshot: async () => new Uint8Array([1, 2, 3, 4]),
    pdf: async () => new Uint8Array([5, 6, 7, 8, 9]),
  };

  it('runs a screenshot, stores a PNG to R2, returns a completed envelope', async () => {
    const { puts, env } = r2Stub();
    const res = await runArtifactJob(
      env,
      'screenshot',
      { tenantId: 't', siteId: 's', url: 'https://x.dev' },
      runner,
      '42',
    );
    expect(res).toEqual({
      status: 'completed',
      purpose: 'screenshot',
      artifactKey: 'browser-jobs/t/s/42-screenshot.png',
      contentType: 'image/png',
      sizeBytes: 4,
    });
    expect(puts[0]).toMatchObject({
      key: 'browser-jobs/t/s/42-screenshot.png',
      bytes: 4,
      contentType: 'image/png',
    });
  });

  it('runs a pdf, stores application/pdf', async () => {
    const { puts, env } = r2Stub();
    const res = await runArtifactJob(
      env,
      'pdf',
      { tenantId: 't', siteId: 's', url: 'https://x.dev' },
      runner,
      '42',
    );
    expect(res).toMatchObject({ purpose: 'pdf', contentType: 'application/pdf', sizeBytes: 5 });
    expect(puts[0].contentType).toBe('application/pdf');
  });
});
