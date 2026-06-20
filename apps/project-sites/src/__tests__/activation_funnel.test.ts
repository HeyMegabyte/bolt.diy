/**
 * Revenue-funnel SSOT (§9). Locks the ordered milestones + the event→stage map
 * that the Tinybird activation_funnel pipe queries. Drift here = the analytics
 * surface counts a different funnel than the product claims.
 */
import {
  ACTIVATION_STAGES,
  ACTIVATION_EVENTS,
  funnelStage,
  isActivationEvent,
} from '../services/activation_funnel.js';
import { EVENT_TYPES } from '../services/event_bus.js';

describe('activation funnel', () => {
  it('is four ordered milestones, top → bottom', () => {
    expect(ACTIVATION_STAGES.map((s) => s.event)).toEqual([
      'lead.discovered',
      'site.claim.started',
      'site.published',
      'subscription.active',
    ]);
    // ordinals are 0..3, strictly increasing
    expect(ACTIVATION_STAGES.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it('every stage event is a real bus event type (no drift)', () => {
    for (const ev of ACTIVATION_EVENTS) {
      expect(EVENT_TYPES).toContain(ev);
    }
  });

  it('funnelStage places a funnel event and returns its label + ordinal', () => {
    expect(funnelStage('site.published')).toEqual({
      event: 'site.published',
      label: 'Delivered',
      ordinal: 2,
    });
    expect(funnelStage('subscription.active')?.ordinal).toBe(3);
  });

  it('funnelStage returns null for a non-funnel event', () => {
    expect(funnelStage('site.created')).toBeNull();
    expect(funnelStage('invoice.failed')).toBeNull();
    expect(funnelStage('not.an.event')).toBeNull();
  });

  it('isActivationEvent discriminates funnel vs non-funnel events', () => {
    expect(isActivationEvent('lead.discovered')).toBe(true);
    expect(isActivationEvent('site.publish.failed')).toBe(false);
  });
});
