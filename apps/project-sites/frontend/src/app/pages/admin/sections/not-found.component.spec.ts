import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { AdminNotFoundComponent } from './not-found.component';

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
    expect(hrefs).toEqual(['/admin/sites', '/admin/analytics', '/admin/feature-flags', '/admin/snapshots']);
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
