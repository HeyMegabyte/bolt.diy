import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

/**
 * Regression guard for the admin-wide empty-state primitive. Locks its
 * rendering contract (conditional icon/message/CTA) and the a11y contract
 * (host role=status + aria-live=polite) so a future refactor can't silently
 * regress the "no results → first-result action" UX or screen-reader behavior.
 */
describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyStateComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(EmptyStateComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function q(sel: string): HTMLElement | null {
    return host.querySelector(sel);
  }

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exposes the a11y contract on the host (role=status, aria-live=polite)', () => {
    // Host bindings are static, present before any change detection.
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-live')).toBe('polite');
  });

  it('renders the required title', () => {
    fixture.componentRef.setInput('title', 'No sites yet');
    fixture.detectChanges();
    const title = q('[data-testid="empty-title"]');
    expect(title?.textContent?.trim()).toBe('No sites yet');
  });

  it('renders the message only when provided', () => {
    fixture.componentRef.setInput('title', 'No sites yet');
    fixture.detectChanges();
    expect(q('.es-msg')).toBeNull();

    fixture.componentRef.setInput('message', 'Spin up your first site.');
    fixture.detectChanges();
    expect(q('.es-msg')?.textContent?.trim()).toBe('Spin up your first site.');
  });

  it('renders the decorative icon (aria-hidden) only when provided', () => {
    fixture.componentRef.setInput('title', 'No sites yet');
    fixture.detectChanges();
    expect(q('.es-icon')).toBeNull();

    fixture.componentRef.setInput('icon', '🌐');
    fixture.detectChanges();
    const icon = q('.es-icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('maps a colorful emoji icon to a monochrome cyan SVG (cockpit standard), not the raw emoji', () => {
    fixture.componentRef.setInput('title', 'No review links yet');
    fixture.componentRef.setInput('icon', '🔗');
    fixture.detectChanges();
    const icon = q('.es-icon');
    expect(icon?.querySelector('svg')).withContext('emoji → SVG').not.toBeNull();
    expect(icon?.textContent?.trim()).withContext('the raw emoji is replaced by the SVG').toBe('');
    // SVG uses stroke=currentColor; .es-icon sets color:var(--ps-accent) → cyan (CSS-enforced).
    expect(icon?.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('falls through to the text glyph for an unmapped on-brand mono symbol (⌬)', () => {
    fixture.componentRef.setInput('title', 'No endpoints yet');
    fixture.componentRef.setInput('icon', '⌬');
    fixture.detectChanges();
    const icon = q('.es-icon');
    expect(icon?.querySelector('svg')).withContext('mono symbol stays text, no SVG').toBeNull();
    expect(icon?.textContent?.trim()).toBe('⌬');
  });

  it('renders the CTA only when ctaLabel is set and emits ctaClick on activation', () => {
    fixture.componentRef.setInput('title', 'No sites yet');
    fixture.detectChanges();
    expect(q('[data-testid="empty-cta"]')).toBeNull();

    fixture.componentRef.setInput('ctaLabel', 'Create your first site');
    fixture.detectChanges();

    const cta = q('[data-testid="empty-cta"]') as HTMLButtonElement | null;
    expect(cta).not.toBeNull();
    expect(cta?.textContent?.trim()).toBe('Create your first site');
    expect(cta?.tagName).toBe('BUTTON');

    let emitted = 0;
    fixture.componentInstance.ctaClick.subscribe(() => (emitted += 1));
    cta?.click();
    expect(emitted).toBe(1);
  });
});
