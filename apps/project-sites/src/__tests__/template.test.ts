/**
 * Unit tests for the Mustache-lite template resolver used by the form
 * router. Locks in the behaviour customers depend on when authoring
 * `{{form.X}}` / `{{query.X}}` / `{{meta.X}}` placeholders in their
 * routing prompt.
 */
import { resolveTemplate, TEMPLATE_VARIABLES } from '../services/template';

describe('resolveTemplate', () => {
  it('replaces top-level shortcuts', () => {
    expect(resolveTemplate('Hi {{business}}', { business: 'Acme' })).toBe('Hi Acme');
  });

  it('walks dot-paths into nested objects', () => {
    const out = resolveTemplate('email={{form.email}} name={{form.fields.name}}', {
      form: { email: 'a@b.co', fields: { name: 'Ada' } },
    });
    expect(out).toBe('email=a@b.co name=Ada');
  });

  it('renders objects + arrays as compact JSON', () => {
    const out = resolveTemplate('fields={{form.fields}}', {
      form: { fields: { name: 'Ada', tier: 'gold' } },
    });
    expect(out).toBe('fields={"name":"Ada","tier":"gold"}');
  });

  it('treats unknown paths as empty strings (never leaks the raw token)', () => {
    const out = resolveTemplate('hello {{form.nope}}!', { form: {} });
    expect(out).toBe('hello !');
  });

  it('tolerates whitespace inside braces', () => {
    expect(resolveTemplate('{{  business  }}', { business: 'Acme' })).toBe('Acme');
  });

  it('renders booleans + numbers via String()', () => {
    const out = resolveTemplate('paid={{form.paid}} count={{form.count}}', {
      form: { paid: true, count: 42 },
    });
    expect(out).toBe('paid=true count=42');
  });

  it('leaves non-matching brace patterns alone', () => {
    expect(resolveTemplate('curly { not a token }', {})).toBe('curly { not a token }');
    expect(resolveTemplate('{{ 9bad }}', {})).toBe('{{ 9bad }}'); // identifiers must start with letter/_
  });

  it('handles query + meta namespaces', () => {
    const out = resolveTemplate('src={{query.utm_source}} ip={{meta.ip}}', {
      query: { utm_source: 'twitter' },
      meta: { ip: '203.0.113.5' },
    });
    expect(out).toBe('src=twitter ip=203.0.113.5');
  });

  it('does not escape or quote values — LLM sees raw characters', () => {
    const out = resolveTemplate('msg={{form.fields.message}}', {
      form: { fields: { message: 'hello\nworld <script>' } },
    });
    expect(out).toBe('msg=hello\nworld <script>');
  });
});

describe('TEMPLATE_VARIABLES', () => {
  it('exposes a non-empty, well-formed catalogue', () => {
    expect(TEMPLATE_VARIABLES.length).toBeGreaterThan(0);
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.token).toMatch(/^\{\{.*\}\}$/);
      expect(v.description.length).toBeGreaterThan(8);
    }
  });
});
