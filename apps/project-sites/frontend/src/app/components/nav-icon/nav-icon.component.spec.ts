/**
 * @module components/nav-icon/nav-icon.component.spec
 *
 * The inline-SVG registry that every nav presentation shares. Guards that each
 * model icon key renders a real glyph at the requested size — a blank icon in
 * the 72px rail (where the icon is the ONLY affordance) would be unusable.
 */
import { TestBed } from '@angular/core/testing';
import { NavIconComponent } from './nav-icon.component';
import type { NavIconName } from '../../pages/admin/navigation/admin-nav.model';

function render(name: NavIconName, size?: number): SVGSVGElement {
  const fixture = TestBed.createComponent(NavIconComponent);
  fixture.componentRef.setInput('name', name);
  if (size !== undefined) fixture.componentRef.setInput('size', size);
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('svg') as SVGSVGElement;
}

describe('NavIconComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a non-empty SVG for every model icon key', () => {
    const names: NavIconName[] = [
      'dashboard',
      'editor',
      'snapshots',
      'analytics',
      'forms',
      'apps',
      'features',
      'social',
      'voice',
      'logs',
      'feature-flags',
      'leads',
      'system-services',
      'docs',
      'settings',
      'super-admin',
    ];
    for (const n of names) {
      const svg = render(n);
      expect(svg).withContext(`${n} has an <svg>`).toBeTruthy();
      expect(svg.querySelectorAll('path, rect, circle, line, polyline, polygon').length)
        .withContext(`${n} draws at least one shape`)
        .toBeGreaterThan(0);
    }
  });

  it('defaults to the 18px sidebar optical weight', () => {
    const svg = render('dashboard');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('height')).toBe('18');
  });

  it('honours a custom size', () => {
    const svg = render('settings', 24);
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('inherits colour via currentColor (so nav-item states tint it)', () => {
    const svg = render('voice');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
  });

  it('is aria-hidden (decorative — the link text/label is the accessible name)', () => {
    const fixture = TestBed.createComponent(NavIconComponent);
    fixture.componentRef.setInput('name', 'apps');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });
});
