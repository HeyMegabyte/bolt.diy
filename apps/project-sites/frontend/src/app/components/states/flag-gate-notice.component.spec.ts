import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter } from '@angular/router';
import { FlagGateNoticeComponent } from './flag-gate-notice.component';

@Component({
  standalone: true,
  imports: [FlagGateNoticeComponent],
  template: `<app-flag-gate-notice [feature]="feature" [flag]="flag" [testid]="testid" [plural]="plural" [margin]="margin" [heading]="heading" [suffix]="suffix" />`,
})
class HostComponent {
  feature = 'The Section Marketplace';
  flag = 'section_marketplace';
  testid = 'marketplace-flag-gate';
  plural = false;
  margin = 'mb-5';
  heading = '';
  suffix = '';
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

  it('omits the heading + suffix by default', () => {
    const el = build();
    expect(el.querySelector('.flag-gate__heading')).withContext('no heading unless provided').toBeNull();
    const body = el.querySelector('.flag-gate__body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(body.endsWith('System Admin.')).withContext('sentence ends at "System Admin." with no suffix').toBeTrue();
  });

  it('renders an optional bold heading + a trailing suffix clause when provided', () => {
    fixture = undefined as unknown as ComponentFixture<HostComponent>;
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideRouter([])] });
    const fx = TestBed.createComponent(HostComponent);
    fx.componentInstance.feature = 'Log Explorer';
    fx.componentInstance.flag = 'log_explorer';
    fx.componentInstance.heading = "Log Explorer isn't enabled";
    fx.componentInstance.suffix = 'to search Worker tail logs and view cost-by-route';
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('.flag-gate__heading')?.textContent?.trim()).toBe("Log Explorer isn't enabled");
    const body = el.querySelector('.flag-gate__body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(body).toContain('Enable it in System Admin to search Worker tail logs and view cost-by-route.');
  });
});
