import { assembleLabeledContext } from '../services/labeled_context';

/**
 * AI context-quality axis (item #2) — assemble retrieved context into LABELED
 * blocks (SYSTEM / RETRIEVED_FACTS / BRAND / CONSTRAINTS / EXAMPLES) so the model
 * treats retrieved content as DATA, not instructions (a prompt-injection defense
 * per `ai-agent-security`). Pure + total; empty sections are omitted.
 */

describe('assembleLabeledContext', () => {
  it('emits only the sections provided, each under its labeled header', () => {
    const out = assembleLabeledContext({
      system: 'You build websites.',
      retrievedFacts: ['Open 9-5', 'Located in Newark'],
    });
    expect(out).toContain('=== SYSTEM ===');
    expect(out).toContain('You build websites.');
    expect(out).toContain('=== RETRIEVED_FACTS ===');
    expect(out).toContain('- Open 9-5');
    expect(out).toContain('- Located in Newark');
    expect(out).not.toContain('=== BRAND ===');
    expect(out).not.toContain('=== EXAMPLES ===');
  });

  it('orders blocks deterministically: SYSTEM, RETRIEVED_FACTS, BRAND, CONSTRAINTS, EXAMPLES', () => {
    const out = assembleLabeledContext({
      examples: ['ex1'],
      constraints: ['no slop'],
      brand: 'cyan/black',
      retrievedFacts: ['fact'],
      system: 'sys',
    });
    const order = ['SYSTEM', 'RETRIEVED_FACTS', 'BRAND', 'CONSTRAINTS', 'EXAMPLES'].map((h) =>
      out.indexOf(`=== ${h} ===`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('drops empty strings and empty arrays (no empty headers)', () => {
    const out = assembleLabeledContext({
      system: '   ',
      retrievedFacts: [],
      brand: '',
      constraints: ['real constraint'],
    });
    expect(out).not.toContain('=== SYSTEM ===');
    expect(out).not.toContain('=== RETRIEVED_FACTS ===');
    expect(out).not.toContain('=== BRAND ===');
    expect(out).toContain('=== CONSTRAINTS ===');
    expect(out).toContain('- real constraint');
  });

  it('returns an empty string when nothing is provided (never throws)', () => {
    expect(assembleLabeledContext({})).toBe('');
    expect(assembleLabeledContext(undefined as unknown as never)).toBe('');
  });

  it('trims array items and skips blank ones', () => {
    const out = assembleLabeledContext({ retrievedFacts: ['  kept  ', '', '   '] });
    expect(out).toContain('- kept');
    expect(out.match(/- /g)?.length).toBe(1);
  });
});
