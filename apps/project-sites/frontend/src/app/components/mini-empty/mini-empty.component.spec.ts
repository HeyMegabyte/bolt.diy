import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MiniEmptyComponent } from './mini-empty.component';

@Component({
  standalone: true,
  imports: [MiniEmptyComponent],
  template: `
    <app-mini-empty text="No logs match your filters.">
      <svg data-testid="proj-icon"></svg>
    </app-mini-empty>
  `,
})
class HostComponent {}

describe('MiniEmptyComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): HTMLElement {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fx = TestBed.createComponent(HostComponent);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('renders the text in a role=status live region', () => {
    const host = render();
    const region = host.querySelector('.mini-empty');
    expect(region).withContext('mini-empty rendered').not.toBeNull();
    expect(region!.getAttribute('role')).withContext('announced once to SR').toBe('status');
    expect(host.querySelector('.mini-empty-tx')?.textContent?.trim()).toBe('No logs match your filters.');
  });

  it('projects the caller icon into the cyan glyph disc, decorative (aria-hidden)', () => {
    const host = render();
    const glyph = host.querySelector('.mini-empty-glyph');
    expect(glyph).not.toBeNull();
    expect(glyph!.getAttribute('aria-hidden')).withContext('icon is decorative — text carries meaning').toBe('true');
    expect(glyph!.querySelector('[data-testid="proj-icon"]')).withContext('projected SVG lands inside the disc').not.toBeNull();
  });
});
