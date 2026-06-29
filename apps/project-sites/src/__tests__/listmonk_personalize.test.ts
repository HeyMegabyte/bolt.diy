import {
  toSubscriberAttribs,
  renderPersonalized,
  extractVars,
  missingVars,
} from '../services/listmonk_personalize.js';

describe('toSubscriberAttribs (LM17)', () => {
  it('maps signals to a flat attribs bag, dropping empties', () => {
    expect(toSubscriberAttribs({ firstName: 'Vito', plan: 'pro', siteCount: 3 })).toEqual({
      first_name: 'Vito',
      plan: 'pro',
      site_count: 3,
    });
  });

  it('drops null/blank/non-finite fields', () => {
    expect(
      toSubscriberAttribs({ firstName: '  ', plan: null, siteCount: NaN, cohort: 'active' }),
    ).toEqual({ cohort: 'active' });
  });
});

describe('renderPersonalized (LM17)', () => {
  it('substitutes a present variable', () => {
    expect(renderPersonalized('Hi {{ first_name }}!', { first_name: 'Vito' })).toBe('Hi Vito!');
  });

  it('uses the inline default for a missing variable', () => {
    expect(renderPersonalized('Hi {{ first_name | there }}!', {})).toBe('Hi there!');
  });

  it('uses the global fallback when no inline default + missing', () => {
    expect(renderPersonalized('Hi {{ first_name }}!', {}, { fallback: 'friend' })).toBe(
      'Hi friend!',
    );
  });

  it('never leaves a raw token (empty string when no fallback)', () => {
    expect(renderPersonalized('Hi {{ first_name }}!', {})).toBe('Hi !');
  });

  it('renders numbers and booleans', () => {
    expect(renderPersonalized('You have {{ site_count }} sites', { site_count: 3 })).toBe(
      'You have 3 sites',
    );
    expect(renderPersonalized('Pro: {{ is_pro }}', { is_pro: true })).toBe('Pro: yes');
  });

  it('inline default wins over global fallback', () => {
    expect(renderPersonalized('{{ x | inline }}', {}, { fallback: 'global' })).toBe('inline');
  });

  it('returns empty string for a non-string template', () => {
    expect(renderPersonalized(undefined as unknown as string, {})).toBe('');
  });

  it('round-trips a realistic campaign line', () => {
    const attribs = toSubscriberAttribs({ firstName: 'Sam', plan: 'free', siteCount: 1 });
    const out = renderPersonalized(
      'Hi {{ first_name | there }}, you are on the {{ plan }} plan with {{ site_count }} site(s).',
      attribs,
    );
    expect(out).toBe('Hi Sam, you are on the free plan with 1 site(s).');
  });
});

describe('extractVars / missingVars (LM17)', () => {
  it('extracts unique sorted keys (ignoring inline defaults)', () => {
    expect(extractVars('{{ a }} {{ b | x }} {{ a }}')).toEqual(['a', 'b']);
  });

  it('reports only keys with no value AND no inline default', () => {
    expect(missingVars('{{ a }} {{ b | def }} {{ c }}', { a: 'set' })).toEqual(['c']);
  });

  it('treats blank-valued keys as missing', () => {
    expect(missingVars('{{ a }}', { a: '' })).toEqual(['a']);
  });
});
