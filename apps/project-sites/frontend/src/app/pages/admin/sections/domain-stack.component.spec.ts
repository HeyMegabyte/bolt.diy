import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { of, throwError, NEVER } from 'rxjs';
import { provideRouter } from '@angular/router';
import { AdminDomainStackComponent } from './domain-stack.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Locks the convergence-r13 cohesion contract for the Domain Stack wizard:
 *  - completionPct derives 0-100 from done/total tiles (drives the cyan meter)
 *  - liveStatus names the running step for the aria-live region
 *  - statusLabel humanizes 'in_progress' for per-tile aria-labels
 *  - the rendered board exposes role=progressbar + role=list + the sr-only
 *    live region (WCAG 2.2 AA structure the audit asserts)
 *  - feature_disabled 404 flips to the honest disabled state, not a toast
 */
type Site = { id: string; primary_hostname: string | null } | null;

interface Tile {
  step: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'error';
  error: string | null;
  data: unknown;
}

function statusResp(tiles: Tile[], state = 'in_progress') {
  return of({
    data: {
      run_id: 'run-1', hostname: 'acme.dev', state,
      tiles, done_at: null, last_error: null, retries: 0,
    },
  });
}

describe('AdminDomainStackComponent (r13 cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminDomainStackComponent>;
  let component: AdminDomainStackComponent;
  let selectedSite: WritableSignal<Site>;
  let getSpy: jasmine.Spy;
  let toastError: jasmine.Spy;

  const tiles: Tile[] = [
    { step: 'dns', label: 'DNS', status: 'done', error: null, data: null },
    { step: 'ssl', label: 'SSL', status: 'done', error: null, data: null },
    { step: 'email', label: 'Email Auth', status: 'in_progress', error: null, data: null },
    { step: 'gsc', label: 'Search Console', status: 'pending', error: null, data: null },
  ];

  function build(site: Site, getReturn = statusResp(tiles)): void {
    selectedSite = signal<Site>(site);
    getSpy = jasmine.createSpy('get').and.returnValue(getReturn);
    toastError = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminDomainStackComponent],
      providers: [
        { provide: ApiService, useValue: { get: getSpy, post: jasmine.createSpy('post').and.returnValue(of({ data: {} })) } },
        { provide: ToastService, useValue: { error: toastError, success: jasmine.createSpy('success') } },
        { provide: AdminStateService, useValue: { selectedSite } },
        provideRouter([]), // RouterLink in the component needs ActivatedRoute
      ],
    });
    fixture = TestBed.createComponent(AdminDomainStackComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('derives completionPct from done/total tiles', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    // 2 done of 4 → 50%
    expect(component.completionPct()).toBe(50);
    expect(component.doneCount()).toBe(2);
    expect(component.pendingCount()).toBe(1);
  });

  it('completionPct is 0 with no tiles (no divide-by-zero)', () => {
    build(null, statusResp([]));
    expect(component.completionPct()).toBe(0);
  });

  // Cockpit cohesion: the no-site guard should use the shared cyan
  // <app-empty-state> (matching domains/voice/analytics), not a bespoke card.
  it('renders the no-site guard via the shared cyan app-empty-state (cyan SVG glyph)', () => {
    build(null, statusResp([]));
    const host = fixture.nativeElement as HTMLElement;
    const es = host.querySelector('app-empty-state');
    expect(es).withContext('uses the cockpit cyan empty-state primitive').toBeTruthy();
    expect(es!.textContent).toContain('No site selected');
    expect(es!.querySelector('svg')).withContext('icon maps to a monochrome cyan SVG').toBeTruthy();
  });

  it('liveStatus names the in-progress step for assistive tech', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    expect(component.liveStatus()).toBe('Configuring Email Auth…');
  });

  it('statusLabel humanizes in_progress', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    expect(component.statusLabel('in_progress')).toBe('in progress');
    expect(component.statusLabel('done')).toBe('done');
  });

  it('renders the progressbar meter + step list + sr-only live region', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    const el: HTMLElement = fixture.nativeElement;
    const meter = el.querySelector('[role="progressbar"]');
    expect(meter).toBeTruthy();
    expect(meter?.getAttribute('aria-valuenow')).toBe('2');
    expect(meter?.getAttribute('aria-valuemax')).toBe('4');
    expect(el.querySelector('[role="list"]')).toBeTruthy();
    expect(el.querySelectorAll('[role="listitem"]').length).toBe(4);
    expect(el.querySelector('.sr-only[aria-live="polite"]')).toBeTruthy();
  });

  it('shows the cyan mini-empty + Start Wizard when no stack run exists yet', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' }, statusResp([]));
    const el: HTMLElement = fixture.nativeElement;
    const mini = el.querySelector('.mini-empty[role="status"]');
    expect(mini).withContext('cyan mini-empty for the no-run state (not bare gray text)').toBeTruthy();
    expect(mini!.textContent).toContain('No stack run yet for acme.dev');
    expect(el.querySelector('[aria-label="Start the domain stack wizard"]'))
      .withContext('Start Wizard stays a sibling action below the mini-empty').toBeTruthy();
  });

  it('flips to feature-disabled state on a feature_disabled 404 (no toast)', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' },
      throwError(() => ({ status: 404, error: { error: { code: 'feature_disabled' } } })));
    expect(component.featureDisabled()).toBeTrue();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('advance() posts {silent:true} so a failure shows ONLY its own toast (no generic double-toast)', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    const post = (TestBed.inject(ApiService) as unknown as { post: jasmine.Spy }).post;
    component.advance();
    const args = post.calls.mostRecent().args;
    expect(args[0]).toBe('/domains/acme.dev/stack');
    expect(args[2]).toEqual({ silent: true });
  });

  // refresh() owns its OWN error UX: 404 / feature_disabled stay silent (early
  // return → no toast), a 500 shows its own 'Failed to load stack status'. So the
  // GET must be {silent:true} — otherwise ApiService's generic toast double-fires
  // over the component's (500) or wrongly toasts 'not found' on the silent 404.
  it('refresh() GETs {silent:true} so the component owns the error UX (no generic double-toast)', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    component.refresh();
    const args = getSpy.calls.mostRecent().args;
    expect(args[0]).toBe('/domains/acme.dev/stack-status');
    expect(args[2]).toEqual({ silent: true });
  });

  it('a non-404 refresh failure surfaces exactly one (its own) toast', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' }, throwError(() => ({ status: 500 })));
    // build()'s detectChanges already ran refresh() once via mount; call again to be explicit.
    component.refresh();
    expect(toastError).toHaveBeenCalledWith('Failed to load stack status');
  });

  it('shows an announced loading card (not a blank board) while the first fetch is in flight', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    component.loading.set(true);
    component.tiles.set([]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const loadingCard = host.querySelector('[data-testid="domain-stack-loading"]');
    expect(loadingCard).withContext('loading feedback during initial fetch').not.toBeNull();
    expect(loadingCard?.getAttribute('aria-busy')).toBe('true');
    expect(loadingCard?.getAttribute('role')).toBe('status');
  });

  // Double-submit guard: advance() is the async mutation behind BOTH the
  // "Advance" button (button-level [disabled]) AND the "Start Wizard" button
  // (which has NO [disabled] in the no-run empty state). A rapid double-click on
  // Start, or any re-entry while a run is mid-flight, must fire ONE POST — not
  // two stack runs. Guard lives in advance() itself so every caller is covered.
  it('advance() is a no-op when already advancing (no duplicate POST)', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    const post = (TestBed.inject(ApiService) as unknown as { post: jasmine.Spy }).post;
    post.calls.reset();
    component.advancing.set(true); // simulate an in-flight run
    component.advance();
    expect(post).not.toHaveBeenCalled();
  });

  it('start() double-click fires advance() once (re-entry guarded)', () => {
    // post never completes → advancing stays true after the first call, so the
    // second start() must short-circuit instead of POSTing again.
    build({ id: 's1', primary_hostname: 'acme.dev' });
    const post = (TestBed.inject(ApiService) as unknown as { post: jasmine.Spy }).post;
    post.and.returnValue(NEVER);
    post.calls.reset();
    component.start();
    component.start();
    expect(post).toHaveBeenCalledTimes(1);
  });

  // a11y parity with the sibling Refresh button: the async Advance button must
  // expose aria-busy while a run advances so AT announces the busy state, not
  // just the static label (WCAG 4.1.3 status messages).
  it('Advance button exposes aria-busy while advancing', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' });
    component.currentState.set('in_progress'); // canAdvance() → renders the button
    component.advancing.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const advanceBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => (b.getAttribute('aria-label') ?? '').includes('domain stack wizard'),
    );
    expect(advanceBtn).withContext('Advance button rendered').toBeTruthy();
    expect(advanceBtn?.getAttribute('aria-busy')).toBe('true');
  });

  // The Start Wizard button (no-run empty state) must disable + announce busy
  // while a run kicks off, so it can't be re-clicked before advancing() flips.
  it('Start Wizard button disables + sets aria-busy while advancing', () => {
    build({ id: 's1', primary_hostname: 'acme.dev' }, statusResp([]));
    component.advancing.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const startBtn = el.querySelector<HTMLButtonElement>(
      '[aria-label="Start the domain stack wizard"]',
    );
    expect(startBtn).withContext('Start Wizard button rendered').toBeTruthy();
    expect(startBtn?.disabled).withContext('disabled while a run kicks off').toBeTrue();
    expect(startBtn?.getAttribute('aria-busy')).toBe('true');
  });
});
