import { resolveCliSandboxConfig } from '../services/cli_sandbox_config';

/**
 * CLI tab (Sandbox SDK) — the PURE config resolver. Decides the per-site sandbox
 * id + which LLM provider the embedded Claude Code authenticates against, mirroring
 * the container build path (DeepSeek-primary via the Anthropic-compatible endpoint;
 * Anthropic fallback; BUILD_LLM_PROVIDER=anthropic forces Claude). Pure, no I/O.
 */

describe('resolveCliSandboxConfig', () => {
  it('derives a deterministic per-site sandbox id', () => {
    const c = resolveCliSandboxConfig('site-abc', { ANTHROPIC_API_KEY: 'sk-ant' });
    expect(c.sandboxId).toBe('site-site-abc');
  });

  it('routes to DeepSeek when DEEPSEEK_API_KEY is set and provider not forced', () => {
    const c = resolveCliSandboxConfig('s1', {
      DEEPSEEK_API_KEY: 'sk-ds',
      ANTHROPIC_API_KEY: 'sk-ant',
    });
    expect(c.provider).toBe('deepseek');
    expect(c.baseUrl).toBe('https://api.deepseek.com/anthropic');
    expect(c.authToken).toBe('sk-ds');
    expect(c.model).toBe('deepseek-chat');
  });

  it('falls back to Anthropic when DEEPSEEK_API_KEY is absent', () => {
    const c = resolveCliSandboxConfig('s1', { ANTHROPIC_API_KEY: 'sk-ant' });
    expect(c.provider).toBe('anthropic');
    expect(c.baseUrl).toBeUndefined();
    expect(c.authToken).toBe('sk-ant');
    expect(c.model).toBe('claude-sonnet-4-6');
  });

  it('forces Anthropic when BUILD_LLM_PROVIDER=anthropic even if DeepSeek key is present', () => {
    const c = resolveCliSandboxConfig('s1', {
      DEEPSEEK_API_KEY: 'sk-ds',
      ANTHROPIC_API_KEY: 'sk-ant',
      BUILD_LLM_PROVIDER: 'anthropic',
    });
    expect(c.provider).toBe('anthropic');
    expect(c.authToken).toBe('sk-ant');
  });

  it('reports configured=false when no provider key is available (caller surfaces a clear error)', () => {
    const c = resolveCliSandboxConfig('s1', {});
    expect(c.configured).toBe(false);
    expect(c.authToken).toBe('');
  });

  it('reports configured=true on a resolved provider', () => {
    expect(resolveCliSandboxConfig('s1', { DEEPSEEK_API_KEY: 'x' }).configured).toBe(true);
    expect(resolveCliSandboxConfig('s1', { ANTHROPIC_API_KEY: 'x' }).configured).toBe(true);
  });

  it('throws on an empty siteId (a required routing param)', () => {
    expect(() => resolveCliSandboxConfig('', { ANTHROPIC_API_KEY: 'x' })).toThrow();
    expect(() => resolveCliSandboxConfig('   ', { ANTHROPIC_API_KEY: 'x' })).toThrow();
  });
});
