import { createEnvelope, EVENT_PRODUCERS, EVENT_TYPES } from '../services/event_bus_types.js';
describe('event_bus_types', () => {
  it('PRODUCERS has >=8 entries', () => {
    expect(EVENT_PRODUCERS.length).toBeGreaterThanOrEqual(8);
  });
  it('TYPES has >=8 entries', () => {
    expect(EVENT_TYPES.length).toBeGreaterThanOrEqual(8);
  });
  it('creates envelope with all required fields', () => {
    const e = createEnvelope('projectsites', 'site.published', { slug: 'test' });
    expect(e.id).toBeTruthy();
    expect(e.producer).toBe('projectsites');
    expect(e.type).toBe('site.published');
    expect(e.payload.slug).toBe('test');
    expect(e.timestamp).toBeTruthy();
    expect(e.traceId).toBe('unknown');
  });
  it('uses provided traceId', () => {
    expect(createEnvelope('billing', 'payment.succeeded', {}, 't1').traceId).toBe('t1');
  });
});
