import {
  LEAD_STAGES,
  isTerminal,
  canTransition,
  applyLeadEvent,
} from '../services/lead_pipeline.js';

describe('lead_pipeline (Lead Scanner #94 — CRM stage machine)', () => {
  it('isTerminal only for claimed + lost', () => {
    expect(isTerminal('claimed')).toBe(true);
    expect(isTerminal('lost')).toBe(true);
    for (const s of LEAD_STAGES.filter((x) => x !== 'claimed' && x !== 'lost')) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('allows exactly one forward step along the funnel', () => {
    expect(canTransition('discovered', 'enriched')).toBe(true);
    expect(canTransition('enriched', 'contacted')).toBe(true);
    expect(canTransition('contacted', 'build_triggered')).toBe(true);
    expect(canTransition('build_triggered', 'preview_sent')).toBe(true);
  });

  it('rejects skips and backward moves', () => {
    expect(canTransition('discovered', 'contacted')).toBe(false); // skip
    expect(canTransition('contacted', 'enriched')).toBe(false); // backward
    expect(canTransition('discovered', 'claimed')).toBe(false); // can't claim un-previewed
  });

  it('only claims from preview_sent', () => {
    expect(canTransition('preview_sent', 'claimed')).toBe(true);
    expect(canTransition('build_triggered', 'claimed')).toBe(false);
  });

  it('allows lose from any non-terminal, never off a terminal', () => {
    expect(canTransition('discovered', 'lost')).toBe(true);
    expect(canTransition('preview_sent', 'lost')).toBe(true);
    expect(canTransition('claimed', 'lost')).toBe(false);
    expect(canTransition('lost', 'discovered')).toBe(false);
  });

  it('applyLeadEvent advances on valid events + returns null on illegal ones', () => {
    expect(applyLeadEvent('discovered', 'enrich')).toBe('enriched');
    expect(applyLeadEvent('preview_sent', 'claim')).toBe('claimed');
    expect(applyLeadEvent('contacted', 'lose')).toBe('lost');
    expect(applyLeadEvent('discovered', 'claim')).toBeNull(); // skip rejected
    expect(applyLeadEvent('claimed', 'lose')).toBeNull(); // off-terminal rejected
  });

  it('drives a full happy-path lifecycle to claimed', () => {
    let stage: ReturnType<typeof applyLeadEvent> = 'discovered';
    for (const ev of ['enrich', 'contact', 'trigger_build', 'send_preview', 'claim'] as const) {
      stage = applyLeadEvent(stage as Exclude<typeof stage, null>, ev);
      expect(stage).not.toBeNull();
    }
    expect(stage).toBe('claimed');
  });
});
