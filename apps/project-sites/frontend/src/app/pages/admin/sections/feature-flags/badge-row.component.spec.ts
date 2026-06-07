import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FlagBadgeRowComponent, type FlagBadge } from './badge-row.component';

/**
 * First coverage for the shared status/scope/risk badge row (rendered by BOTH
 * control-plane layers so badge styling stays identical). Locks: one chip per
 * badge, the tone data-attr drives the cockpit color, and the title→aria-label
 * fallback for accessible names.
 */
describe('FlagBadgeRowComponent', () => {
  let fixture: ComponentFixture<FlagBadgeRowComponent>;

  function build(badges: FlagBadge[]): void {
    TestBed.configureTestingModule({ imports: [FlagBadgeRowComponent] });
    fixture = TestBed.createComponent(FlagBadgeRowComponent);
    fixture.componentRef.setInput('badges', badges);
    fixture.detectChanges();
  }
  function chips(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.br-chip'));
  }
  afterEach(() => TestBed.resetTestingModule());

  it('renders one chip per badge with its label + tone data-attr', () => {
    build([
      { label: 'ON', tone: 'on', title: 'flag is on' },
      { label: 'beta', tone: 'stage' },
      { label: 'killswitch', tone: 'risk', title: 'Hard kill switch active' },
    ]);
    const cs = chips();
    expect(cs.length).toBe(3);
    expect(cs[0].textContent?.trim()).toBe('ON');
    expect(cs[0].getAttribute('data-tone')).toBe('on');
    expect(cs[1].getAttribute('data-tone')).toBe('stage');
    expect(cs[2].getAttribute('data-tone')).toBe('risk');
  });

  it('uses the title as the accessible name when present, else the label', () => {
    build([
      { label: 'high risk', tone: 'risk', title: 'Experimental — rollout-gated' },
      { label: 'platform', tone: 'scope' },
    ]);
    const cs = chips();
    expect(cs[0].getAttribute('aria-label')).withContext('title wins for the SR name').toBe('Experimental — rollout-gated');
    expect(cs[0].getAttribute('title')).toBe('Experimental — rollout-gated');
    expect(cs[1].getAttribute('aria-label')).withContext('falls back to the label').toBe('platform');
    expect(cs[1].getAttribute('title')).withContext('no title attr when none given').toBeNull();
  });

  it('renders nothing for an empty badge list', () => {
    build([]);
    expect(chips().length).toBe(0);
  });

  it('re-renders reactively when the badges signal input changes', () => {
    build([{ label: 'OFF', tone: 'off' }]);
    expect(chips().length).toBe(1);
    fixture.componentRef.setInput('badges', [
      { label: 'ON', tone: 'on' },
      { label: '25%', tone: 'neutral' },
    ] as FlagBadge[]);
    fixture.detectChanges();
    expect(chips().length).toBe(2);
    expect(chips()[1].textContent?.trim()).toBe('25%');
  });
});
