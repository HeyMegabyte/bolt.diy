import { TestBed } from '@angular/core/testing';
import { UtmBuilderComponent, buildUtmUrl, utmSlug } from './utm-builder.component';

describe('utmSlug', () => {
  it('lowercases + dashes + trims', () => {
    expect(utmSlug('  Spring Menu! ')).toBe('spring-menu');
    expect(utmSlug('Instagram')).toBe('instagram');
    expect(utmSlug('')).toBe('');
  });
});

describe('buildUtmUrl', () => {
  it('builds a tagged URL with source + medium + campaign', () => {
    expect(buildUtmUrl('https://acme.com/menu', 'Instagram', 'social', 'Spring Menu')).toBe(
      'https://acme.com/menu?utm_source=instagram&utm_medium=social&utm_campaign=spring-menu',
    );
  });
  it('omits medium/campaign when blank, keeps required source', () => {
    expect(buildUtmUrl('https://acme.com', 'flyer', '', '')).toBe(
      'https://acme.com/?utm_source=flyer',
    );
  });
  it('returns empty for an invalid/non-http destination or missing source', () => {
    expect(buildUtmUrl('not a url', 'instagram', 'social', '')).toBe('');
    expect(buildUtmUrl('javascript:alert(1)', 'instagram', 'social', '')).toBe('');
    expect(buildUtmUrl('https://acme.com', '', 'social', '')).toBe('');
  });
  it('merges with an existing query string (URL API handles it)', () => {
    expect(buildUtmUrl('https://acme.com/p?ref=x', 'google', 'paid', '')).toContain('ref=x');
  });
});

describe('UtmBuilderComponent', () => {
  function make() {
    TestBed.configureTestingModule({ imports: [UtmBuilderComponent] });
    const f = TestBed.createComponent(UtmBuilderComponent);
    f.detectChanges();
    return f;
  }

  it('shows a hint until destination + source are set, then the output + copy', () => {
    const f = make();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="utm-hint"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="utm-output"]')).toBeNull();

    f.componentInstance.dest.set('https://acme.com/menu');
    f.componentInstance.applyPreset({ label: 'Instagram', source: 'instagram', medium: 'social' });
    f.detectChanges();

    const out = el.querySelector('[data-testid="utm-output"]');
    expect(out).toBeTruthy();
    expect(out?.textContent).toContain('utm_source=instagram');
    expect(out?.textContent).toContain('utm_medium=social');
  });

  it('a preset fills source + medium', () => {
    const f = make();
    f.componentInstance.applyPreset({ label: 'Email', source: 'newsletter', medium: 'email' });
    expect(f.componentInstance.source()).toBe('newsletter');
    expect(f.componentInstance.medium()).toBe('email');
  });

  it('copy() flips the copied label when a URL is built (clipboard is best-effort)', () => {
    const f = make();
    f.componentInstance.dest.set('https://acme.com');
    f.componentInstance.source.set('flyer');
    f.detectChanges();
    expect(f.componentInstance.built()).toBe('https://acme.com/?utm_source=flyer');
    f.componentInstance.copy(); // must not throw regardless of clipboard availability
    expect(f.componentInstance.copied()).toBeTrue();
  });

  it('copy() is a no-op (no label flip) when no URL is built yet', () => {
    const f = make();
    f.componentInstance.copy();
    expect(f.componentInstance.copied()).toBeFalse();
  });
});
