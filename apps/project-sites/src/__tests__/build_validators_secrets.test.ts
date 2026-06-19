import { validateNoClientSecrets, type BuildFile } from '../services/build_validators';

const f = (path: string, text: string): BuildFile => ({ path, text, size: text.length });

describe('validateNoClientSecrets', () => {
  it('flags a Stripe secret key embedded in a JS bundle (error, masked)', () => {
    const out = validateNoClientSecrets([f('assets/index-abc.js', 'const k="sk_live_51HxYzABCDEFGHIJKLMNOP";')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: 'security.client_secret_exposed', severity: 'error', file: 'assets/index-abc.js' });
    // detail is masked — never the full secret
    expect(out[0]?.detail).not.toContain('51HxYzABCDEFGHIJKLMNOP');
    expect(out[0]?.detail).toContain('…');
  });

  it.each([
    ['OpenAI', 'app.js', 'sk-proj-' + 'a'.repeat(48)],
    ['AWS', 'app.js', 'AKIAIOSFODNN7EXAMPLE'],
    ['GitHub', 'index.html', 'ghp_' + 'b'.repeat(36)],
    ['Anthropic', 'app.js', 'sk-ant-' + 'c'.repeat(24)],
    ['private key', 'app.js', '-----BEGIN RSA PRIVATE KEY-----'],
  ])('flags a %s secret in %s', (_name, path, secret) => {
    expect(validateNoClientSecrets([f(path, `x=${secret}`)])).toHaveLength(1);
  });

  it('does NOT flag client-safe publishable / browser keys', () => {
    const safe = [
      f('app.js', 'const pub="pk_live_51HxYzABCDEFGHIJKLMNOP";'), // Stripe publishable — client-safe
      f('app.js', 'const maps="AIzaSyA' + 'd'.repeat(33) + '";'), // Google Maps browser key — referrer-restricted
    ];
    for (const file of safe) expect(validateNoClientSecrets([file])).toHaveLength(0);
  });

  it('only scans client-served HTML/JS — ignores other file types', () => {
    expect(validateNoClientSecrets([f('config.json', 'sk_live_51HxYzABCDEFGHIJKLMNOP')])).toHaveLength(0);
    expect(validateNoClientSecrets([f('styles.css', 'sk_live_51HxYzABCDEFGHIJKLMNOP')])).toHaveLength(0);
  });

  it('emits at most one violation per file + nothing for a clean bundle', () => {
    expect(validateNoClientSecrets([f('app.js', 'const greeting = "hello world";')])).toHaveLength(0);
    const two = validateNoClientSecrets([f('app.js', 'sk_live_AAAAAAAAAAAAAAAA and AKIAIOSFODNN7EXAMPLE')]);
    expect(two).toHaveLength(1);
  });
});
