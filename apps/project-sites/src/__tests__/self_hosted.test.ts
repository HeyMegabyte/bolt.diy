import {
  resolveSelfHostedLlm,
  resolveSelfHostedImage,
  hasSelfHostedInference,
} from '../services/self_hosted';

/**
 * Self-hosted inference adapter (#1 vLLM + #2 ComfyUI on the Coolify GPU box).
 * Pure resolvers — env-gated, never throw, return null when unconfigured so the
 * provider/image layers fall back to the paid API. No network here.
 */
const E = (o: Record<string, string | undefined>) => o as never;

describe('resolveSelfHostedLlm', () => {
  it('returns null when SELFHOST_LLM_URL is unset (fall back to paid provider)', () => {
    expect(resolveSelfHostedLlm(E({}))).toBeNull();
  });

  it('returns null for a malformed URL (never trusts junk)', () => {
    expect(resolveSelfHostedLlm(E({ SELFHOST_LLM_URL: 'not a url' }))).toBeNull();
  });

  it('resolves a configured endpoint with defaults', () => {
    const sh = resolveSelfHostedLlm(E({ SELFHOST_LLM_URL: 'https://llm.projectsites.dev/' }));
    expect(sh).not.toBeNull();
    expect(sh?.baseUrl).toBe('https://llm.projectsites.dev'); // trailing slash trimmed
    expect(sh?.chatPath).toBe('/v1/chat/completions');
    expect(sh?.model).toBe('qwen2.5-32b-instruct');
    expect(sh?.apiKey).toBe('');
  });

  it('honors an explicit model + api key', () => {
    const sh = resolveSelfHostedLlm(
      E({
        SELFHOST_LLM_URL: 'https://llm.projectsites.dev',
        SELFHOST_LLM_MODEL: 'llama-3.3-70b',
        SELFHOST_LLM_API_KEY: 'sk-local-abc',
      }),
    );
    expect(sh?.model).toBe('llama-3.3-70b');
    expect(sh?.apiKey).toBe('sk-local-abc');
  });
});

describe('resolveSelfHostedImage', () => {
  it('returns null when unconfigured', () => {
    expect(resolveSelfHostedImage(E({}))).toBeNull();
  });

  it('resolves with the sdxl default + trims the trailing slash', () => {
    const sh = resolveSelfHostedImage(E({ SELFHOST_IMAGE_URL: 'https://img.projectsites.dev//' }));
    expect(sh?.baseUrl).toBe('https://img.projectsites.dev');
    expect(sh?.model).toBe('sdxl');
  });

  it('honors an explicit workflow/checkpoint model', () => {
    const sh = resolveSelfHostedImage(
      E({ SELFHOST_IMAGE_URL: 'https://img.projectsites.dev', SELFHOST_IMAGE_MODEL: 'flux.1-dev' }),
    );
    expect(sh?.model).toBe('flux.1-dev');
  });
});

describe('hasSelfHostedInference', () => {
  it('false when neither backend configured', () => {
    expect(hasSelfHostedInference(E({}))).toBe(false);
  });

  it('true when only the LLM is configured', () => {
    expect(hasSelfHostedInference(E({ SELFHOST_LLM_URL: 'https://llm.projectsites.dev' }))).toBe(
      true,
    );
  });

  it('true when only the image backend is configured', () => {
    expect(hasSelfHostedInference(E({ SELFHOST_IMAGE_URL: 'https://img.projectsites.dev' }))).toBe(
      true,
    );
  });
});
