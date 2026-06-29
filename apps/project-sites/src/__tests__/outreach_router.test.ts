import { chooseChannel, nextDripStep } from '../services/outreach_router.js';

describe('chooseChannel (Lead Scanner #96 — channel by confidence)', () => {
  it('both when email AND address clear their bars', () => {
    expect(chooseChannel({ emailConfidence: 0.9, addressConfidence: 0.9 })).toBe('both');
  });
  it('email-only / postcard-only when just one clears', () => {
    expect(chooseChannel({ emailConfidence: 0.9, addressConfidence: 0.1 })).toBe('email');
    expect(chooseChannel({ emailConfidence: 0.1, addressConfidence: 0.9 })).toBe('postcard');
  });
  it('none when neither is reachable (no spend on an unreachable lead)', () => {
    expect(chooseChannel({ emailConfidence: 0.2, addressConfidence: 0.2 })).toBe('none');
  });
});

describe('nextDripStep (Lead Scanner #96 — drip ladder)', () => {
  const both = { emailConfidence: 0.9, addressConfidence: 0.9 };

  it('walks email → nudge → postcard → final → done for a both-channel lead', () => {
    expect(nextDripStep({ ...both, sentSteps: [] })).toBe('email');
    expect(nextDripStep({ ...both, sentSteps: ['email'] })).toBe('nudge');
    expect(nextDripStep({ ...both, sentSteps: ['email', 'nudge'] })).toBe('postcard');
    expect(nextDripStep({ ...both, sentSteps: ['email', 'nudge', 'postcard'] })).toBe('final');
    expect(nextDripStep({ ...both, sentSteps: ['email', 'nudge', 'postcard', 'final'] })).toBe('done');
  });

  it('STOPS on reply regardless of ladder position', () => {
    expect(nextDripStep({ ...both, sentSteps: ['email'], replied: true })).toBe('done');
  });

  it('skips postcard steps when the address is undeliverable (email-only lead)', () => {
    const email = { emailConfidence: 0.9, addressConfidence: 0.1 };
    expect(nextDripStep({ ...email, sentSteps: ['email', 'nudge'] })).toBe('done');
  });

  it('skips email steps for a postcard-only lead', () => {
    const post = { emailConfidence: 0.1, addressConfidence: 0.9 };
    expect(nextDripStep({ ...post, sentSteps: [] })).toBe('postcard');
    expect(nextDripStep({ ...post, sentSteps: ['postcard'] })).toBe('final');
  });

  it('returns done for an unreachable lead', () => {
    expect(nextDripStep({ emailConfidence: 0.1, addressConfidence: 0.1 })).toBe('done');
  });
});
