/**
 * sdk_codegen — §47 Stainless SDK-generation port.
 *
 * Locks the port (Noop is dark/skipped, Fake records specs) and the adapter
 * (config validation, POST shaping with auth + project header, HTTP-error + thrown
 * fail-soft, factory gate: Stainless when STAINLESS_API_KEY set, Noop when unset).
 * Fetch is injected — no real network. Global `jest`.
 */
import {
  NoopSdkCodegenProvider,
  FakeSdkCodegenProvider,
  SdkCodegenConfigSchema,
} from '../platform/sdk-codegen.js';
import { StainlessSdkCodegenProvider, getSdkCodegenProvider } from '../middleware/sdk-codegen.js';

describe('SdkCodegenConfigSchema', () => {
  it('defaults project + baseUrl, requires apiKey', () => {
    expect(SdkCodegenConfigSchema.safeParse({ apiKey: 'sk' }).success).toBe(true);
    const parsed = SdkCodegenConfigSchema.parse({ apiKey: 'sk' });
    expect(parsed.project).toBe('project-sites');
    expect(parsed.baseUrl).toBe('https://api.stainless.com');
    expect(SdkCodegenConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe('NoopSdkCodegenProvider', () => {
  it('always resolves skipped without network', async () => {
    const r = await new NoopSdkCodegenProvider().generate({ openapi: '3.1.0' });
    expect(r.status).toBe('skipped');
  });
});

describe('FakeSdkCodegenProvider', () => {
  it('records the submitted spec', async () => {
    const p = new FakeSdkCodegenProvider();
    const r = await p.generate({ openapi: '3.1.0' });
    expect(r.status).toBe('submitted');
    expect(p.submitted).toHaveLength(1);
  });
});

describe('StainlessSdkCodegenProvider', () => {
  const cfg = { apiKey: 'sk_test', project: 'project-sites', baseUrl: 'https://stl.example' };

  it('POSTs the spec with auth + project header and returns submitted', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const p = new StainlessSdkCodegenProvider(cfg, fakeFetch);
    const r = await p.generate({ openapi: '3.1.0' });
    expect(r.status).toBe('submitted');
    expect(calls[0].url).toBe('https://stl.example/api/spec');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk_test');
    expect(headers['x-stainless-project']).toBe('project-sites');
  });

  it('returns error on non-2xx', async () => {
    const p = new StainlessSdkCodegenProvider(
      cfg,
      (async () => new Response('nope', { status: 422 })) as unknown as typeof fetch,
    );
    const r = await p.generate({});
    expect(r.status).toBe('error');
    expect(r.message).toContain('422');
  });

  it('fails soft when fetch throws', async () => {
    const p = new StainlessSdkCodegenProvider(cfg, (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch);
    const r = await p.generate({});
    expect(r).toEqual({ status: 'error', project: 'project-sites', message: 'network down' });
  });
});

describe('getSdkCodegenProvider', () => {
  it('returns Stainless adapter when STAINLESS_API_KEY is set', () => {
    const p = getSdkCodegenProvider({ STAINLESS_API_KEY: 'sk', STAINLESS_PROJECT: 'p' } as never);
    expect(p).toBeInstanceOf(StainlessSdkCodegenProvider);
  });
  it('returns Noop (ships dark) when STAINLESS_API_KEY is unset', () => {
    expect(getSdkCodegenProvider({} as never)).toBeInstanceOf(NoopSdkCodegenProvider);
  });
});
