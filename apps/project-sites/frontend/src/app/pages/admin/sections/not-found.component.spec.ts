import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Meta, By } from '@angular/platform-browser';
import { AdminNotFoundComponent, suggestRoute, levenshtein } from './not-found.component';
import { RevealDirective } from '../../../directives/reveal.directive';

/**
 * The admin-scoped 404 keeps unknown `/admin/*` paths inside the cockpit shell.
 * Lock: it renders, links back to the dashboard, and sets a soft-404 noindex
 * (the SPA serves HTTP 200 for unknown routes) that it restores on nav-away.
 */
describe('AdminNotFoundComponent', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [AdminNotFoundComponent],
      providers: [provideRouter([])],
    });
    const fx = TestBed.createComponent(AdminNotFoundComponent);
    fx.detectChanges();
    return fx;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the admin-scoped 404 card with the heading', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="admin-not-found"]')).toBeTruthy();
    expect(el.textContent).toContain("This admin page doesn't exist");
  });

  it('links "Back to dashboard" to /admin (stays in the cockpit, SPA nav)', () => {
    const el = render().nativeElement as HTMLElement;
    const home = el.querySelector('[data-testid="admin-not-found-home"]') as HTMLAnchorElement;
    expect(home).toBeTruthy();
    // routerLink renders the resolved href.
    expect(home.getAttribute('href')).toBe('/admin');
  });

  it('exposes keyboard-reachable section quick-links (all real admin routes)', () => {
    const el = render().nativeElement as HTMLElement;
    const hrefs = Array.from(el.querySelectorAll('.anf-link')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/admin/analytics', '/admin/feature-flags', '/admin/snapshots']);
  });

  it('reveals the 404 card on first paint via appReveal (cockpit cohesion)', () => {
    const fx = render();
    const host = fx.nativeElement as HTMLElement;
    expect(fx.debugElement.queryAll(By.directive(RevealDirective)).length)
      .withContext('the 404 card stagger-reveals like every other admin surface').toBeGreaterThanOrEqual(1);
    expect(host.querySelector('.anf-card')?.hasAttribute('appReveal'))
      .withContext('the card carries appReveal').toBe(true);
  });

  // "Did you mean …" recovery — turn a stale/typo'd /admin/* path into a one-click
  // jump to the closest real route (extra-mile 404 → Levenshtein suggestion).
  describe('suggestRoute()', () => {
    it('suggests the closest route for a mistyped segment', () => {
      expect(suggestRoute('analitics')?.path).toBe('analytics');
      expect(suggestRoute('sitez')).toBeNull();
      expect(suggestRoute('feature-flag')?.path).toBe('feature-flags'); // missing trailing s
    });

    it('maps a known renamed route (stale bookmark) to its current path', () => {
      expect(suggestRoute('ai-logs')?.path).toBe('traces'); // ai-logs → traces
      expect(suggestRoute('github')?.path).toBe('snapshots'); // github → snapshots
    });

    it('returns null for an empty or far-off garbage segment (no misleading guess)', () => {
      expect(suggestRoute('')).toBeNull();
      expect(suggestRoute('zzzzzzzzqqq')).toBeNull();
    });

    it('levenshtein computes a correct edit distance', () => {
      expect(levenshtein('sites', 'sitez')).toBe(1);
      expect(levenshtein('', 'abc')).toBe(3);
      expect(levenshtein('same', 'same')).toBe(0);
    });
  });

  it('renders the "Did you mean" suggestion link when a close match exists', () => {
    const fx = render();
    fx.componentInstance.suggestion = { path: 'analytics', label: 'Analytics' };
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    const link = el.querySelector('[data-testid="admin-not-found-suggest"]') as HTMLAnchorElement;
    expect(link).withContext('suggestion link renders').toBeTruthy();
    expect(link.getAttribute('href')).toBe('/admin/analytics');
    expect(link.textContent).toContain('Analytics');
  });

  it('sets a soft-404 noindex while mounted and restores the prior robots on destroy', () => {
    TestBed.configureTestingModule({
      imports: [AdminNotFoundComponent],
      providers: [provideRouter([])],
    });
    const meta = TestBed.inject(Meta);
    // Production index.html ships a default robots tag — seed it so the restore
    // path is exercised (a bare TestBed has none → previousRobots stays null).
    meta.updateTag({ name: 'robots', content: 'index, follow' });
    const fx = TestBed.createComponent(AdminNotFoundComponent);
    fx.detectChanges(); // ngOnInit captures 'index, follow' then sets noindex
    expect(meta.getTag('name="robots"')?.content).toBe('noindex, follow');
    fx.destroy();
    // Restored → other routes stay indexable after the soft-404 unmounts.
    expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
  });
});
