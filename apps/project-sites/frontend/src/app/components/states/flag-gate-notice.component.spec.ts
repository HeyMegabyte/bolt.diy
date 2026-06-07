import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter } from '@angular/router';
import { FlagGateNoticeComponent } from './flag-gate-notice.component';

@Component({
  standalone: true,
  imports: [FlagGateNoticeComponent],
  template: `<app-flag-gate-notice [feature]="feature" [flag]="flag" [testid]="testid" [plural]="plural" [margin]="margin" />`,
})
class HostComponent {
  feature = 'The Section Marketplace';
  flag = 'section_marketplace';
  testid = 'marketplace-flag-gate';
  plural = false;
  margin = 'mb-5';
}

describe('FlagGateNoticeComponent (shared cockpit flag-gate primitive)', () => {
  let fixture: ComponentFixture<HostComponent>;
  function build(): HTMLElement {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideRouter([])] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('renders the section testid + role=status so existing per-section hooks keep working', () => {
    const el = build();
    const gate = el.querySelector('[data-testid="marketplace-flag-gate"]');
    expect(gate).withContext('preserves the host section test hook').not.toBeNull();
    expect(gate!.getAttribute('role')).toBe('status');
    expect(gate!.classList.contains('mb-5')).withContext('applies the margin input').toBeTrue();
  });

  it('surfaces the feature, the flag in <code>, and a SPA link to System Admin', () => {
    const el = build();
    const gate = el.querySelector('[data-testid="marketplace-flag-gate"]')!;
    expect(gate.textContent).toContain('The Section Marketplace');
    expect(gate.querySelector('code')?.textContent).toBe('section_marketplace');
    const link = gate.querySelector('a');
    expect(link?.getAttribute('href')).withContext('SPA routerLink to the platform-flags section').toBe('/admin/feature-flags');
    expect(link?.textContent?.replace(/\s+/g, ' ').trim()).withContext('label matches the renamed section').toBe('System Admin');
  });

  it('carries the "Platform flag" eyebrow (clarity cue, cyan/black)', () => {
    const el = build();
    expect(el.querySelector('.flag-gate__eyebrow')?.textContent?.trim()).toContain('Platform flag');
    expect(el.querySelector('.flag-gate__eyebrow svg')).withContext('lock glyph present').not.toBeNull();
  });

  it('agrees in number — plural subjects read "are", singular "is"', () => {
    const el = build();
    expect(el.querySelector('.flag-gate__body')?.textContent).toContain('Marketplace is behind');
    fixture.componentInstance.feature = 'Webhooks';
    fixture.componentInstance.flag = 'outbound_webhooks';
    fixture.componentInstance.plural = true;
    fixture.detectChanges();
    expect(el.querySelector('.flag-gate__body')?.textContent).toContain('Webhooks are behind');
  });
});
