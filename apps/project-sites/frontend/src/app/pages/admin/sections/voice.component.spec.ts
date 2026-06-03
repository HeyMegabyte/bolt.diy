import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { VoiceComponent } from './voice.component';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the Voice section cyan/black cohesion + a11y convergence pass:
 *  - the surface-count stat renders through `<app-rolling-counter>` (brand mandate)
 *  - the shell keeps ≥3 `psReveal` entrance hosts
 *  - tablist / tabpanel / no-site-status ARIA contract holds
 *  - the "Live for X" pill is the cyan/black branded variant (no off-brand green)
 */
describe('VoiceComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<VoiceComponent>;
  let selectedSite: WritableSignal<{ id: string; business_name: string } | null>;

  function build(initial: { id: string; business_name: string } | null): void {
    selectedSite = signal(initial);
    TestBed.configureTestingModule({
      imports: [VoiceComponent],
      providers: [{ provide: AdminStateService, useValue: { selectedSite } }],
    });
    fixture = TestBed.createComponent(VoiceComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the surface count through <app-rolling-counter> (numeric stat mandate)', () => {
    build({ id: 's1', business_name: 'Vito Salon' });
    const el: HTMLElement = fixture.nativeElement;
    const strip = el.querySelector('[data-testid="voice-stat-strip"]');
    expect(strip).toBeTruthy();
    // The numeric stat is NOT a raw text node — it is an <app-rolling-counter>.
    expect(strip!.querySelector('app-rolling-counter')).toBeTruthy();
    expect(el.querySelector('.stat-strip-num app-rolling-counter')).toBeTruthy();
  });

  it('keeps at least 3 psReveal entrance hosts', () => {
    build({ id: 's1', business_name: 'Vito Salon' });
    const el: HTMLElement = fixture.nativeElement;
    // psReveal is the attribute selector RevealOnScrollDirective binds to.
    const revealHosts = el.querySelectorAll('[psReveal]');
    expect(revealHosts.length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the WAI-ARIA tablist contract when a site is selected', () => {
    build({ id: 's1', business_name: 'Vito Salon' });
    const el: HTMLElement = fixture.nativeElement;
    const tablist = el.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('aria-label')).toBe('Voice sections');
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(6);
    // Exactly one tab is selected + tabindex=0 (roving tabindex pattern).
    const selected = Array.from(tabs).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    expect(selected[0].getAttribute('tabindex')).toBe('0');
    expect(el.querySelector('[role="tabpanel"]')).toBeTruthy();
  });

  it('renders the cyan/black branded live pill (no off-brand green class)', () => {
    build({ id: 's1', business_name: 'Vito Salon' });
    const el: HTMLElement = fixture.nativeElement;
    const pill = el.querySelector('[data-testid="voice-live-pill"]');
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain('Vito Salon');
    // The branded pill uses the .header-pill class (themed by --ps-accent tokens).
    expect(pill!.classList.contains('header-pill')).toBe(true);
  });

  it('shows an ARIA status (role=status) guard when no site is selected', () => {
    build(null);
    const el: HTMLElement = fixture.nativeElement;
    const status = el.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status!.textContent).toContain('No site selected');
    // No tablist / live pill when there is no site.
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('[data-testid="voice-live-pill"]')).toBeNull();
  });

  it('arrow-key navigation moves the active tab (WCAG 2.2 tab pattern)', () => {
    build({ id: 's1', business_name: 'Vito Salon' });
    const cmp = fixture.componentInstance;
    expect(cmp.activeTab()).toBe('numbers');
    cmp.onTabKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(cmp.activeTab()).toBe('conversations');
    cmp.onTabKey(new KeyboardEvent('keydown', { key: 'End' }));
    expect(cmp.activeTab()).toBe('share');
    cmp.onTabKey(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(cmp.activeTab()).toBe('numbers');
  });
});
