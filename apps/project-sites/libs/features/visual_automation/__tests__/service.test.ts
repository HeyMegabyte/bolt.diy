import { validateJourney, estimateDuration } from '../service.js';
import type { Journey } from '../service.js';

const j: Journey = { id: 'j1', name: 'Welcome', trigger: 'form_submitted', triggerConfig: { formId: 'contact' }, enabled: true, steps: [
  { id: 's1', type: 'send_email', config: { to: '{{email}}', subject: 'Welcome!' }, delayMinutes: 0 },
  { id: 's2', type: 'add_tag', config: { tag: 'new_lead' }, delayMinutes: 60 },
]};

describe('validateJourney', () => {
  test('valid journey passes', () => { expect(validateJourney(j).valid).toBe(true); });
  test('no name fails', () => { expect(validateJourney({ ...j, name: '' }).valid).toBe(false); });
  test('no steps fails', () => { expect(validateJourney({ ...j, steps: [] }).valid).toBe(false); });
  test('negative delay fails', () => {
    const bad = { ...j, steps: [{ ...j.steps[0], delayMinutes: -1 }] };
    expect(validateJourney(bad).valid).toBe(false);
  });
});
describe('estimateDuration', () => { test('sums step delays', () => { expect(estimateDuration(j)).toBe(60); }); });
