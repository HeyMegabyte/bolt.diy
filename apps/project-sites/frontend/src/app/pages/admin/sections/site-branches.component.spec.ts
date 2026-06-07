import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SiteBranchesComponent } from './site-branches.component';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the convergence-r12 cohesion pass for the Site Branches section:
 *   - status maps onto the SHARED global `.status-pill` modifiers (cyan-first),
 *     not ad-hoc amber/green/red tailwind tones
 *   - approvalPct stays a clamped whole-number percent for the cyan track
 *   - merge-readiness + stats math stay correct
 *   - the screen-reader caption + progressbar a11y render
 */
describe('SiteBranchesComponent (cohesion + a11y)', () => {
  let fixture: ComponentFixture<SiteBranchesComponent>;
  let component: SiteBranchesComponent;
  let httpMock: HttpTestingController;
  let confirmSpy: jasmine.Spy;

  const SITE_ID = 'site-branches-1';

  function build(loadFails = false, confirmResult = true): void {
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    // Seed a session so ApiService.headers() attaches the bearer — the regression
    // guard below asserts every /api/branches call carries it (the section used
    // raw HttpClient with NO Authorization → 401; see admin-raw-httpclient-auth-gap).
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: 'tkn_branches_test', identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch { /* private mode */ }
    TestBed.configureTestingModule({
      imports: [SiteBranchesComponent, RouterModule.forRoot([])],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfirmService, useValue: { confirm: confirmSpy } },
        {
          provide: ToastService,
          useValue: {
            error: jasmine.createSpy('error'),
            success: jasmine.createSpy('success'),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            parent: { snapshot: { params: { id: SITE_ID } } },
            snapshot: { params: { id: SITE_ID } },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SiteBranchesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    // Flush the ngOnInit load (success by default, or an error for the masquerade path)
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches`);
    // REGRESSION GUARD: the call MUST carry the auth bearer (routes through
    // ApiService, not raw HttpClient). Raw http.get sent no Authorization → 401.
    expect(req.request.headers.get('Authorization')).toBe('Bearer tkn_branches_test');
    if (loadFails) req.flush('err', { status: 500, statusText: 'Server Error' });
    else req.flush({ branches: [] });
    fixture.detectChanges();
  }

  afterEach(() => {
    try { localStorage.removeItem('ps_session'); } catch { /* private mode */ }
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  function branch(over: Record<string, unknown> = {}): any {
    return {
      id: 'b1',
      branch_name: 'homepage-redesign',
      status: 'review',
      preview_url: null,
      approvals_required: 2,
      approvals_received: 1,
      created_by: 'u1',
      created_at: '2026-06-01T00:00:00Z',
      ...over,
    };
  }

  it('maps every status onto the shared global .status-pill modifiers (cyan-first)', () => {
    build();
    // review is cyan (is-info) — it is the active review-loop state
    expect(component.statusPill('review')).toBe('is-info');
    expect(component.statusPill('draft')).toBe('is-idle');
    expect(component.statusPill('merged')).toBe('is-healthy');
    expect(component.statusPill('closed')).toBe('is-degraded');
    // unknown falls back to neutral, never blank
    expect(component.statusPill('???')).toBe('is-idle');
  });

  it('computes approvalPct as a clamped whole-number percent', () => {
    build();
    expect(component.approvalPct(branch({ approvals_received: 1, approvals_required: 2 }))).toBe(50);
    expect(component.approvalPct(branch({ approvals_received: 3, approvals_required: 2 }))).toBe(100);
    expect(component.approvalPct(branch({ approvals_received: 0, approvals_required: 0 }))).toBe(100);
    expect(component.approvalPct(branch({ approvals_received: 1, approvals_required: 3 }))).toBe(33);
  });

  it('gates merge on approvals_received reaching approvals_required', () => {
    build();
    expect(component.canMerge(branch({ approvals_received: 1, approvals_required: 2 }))).toBe(false);
    expect(component.canMerge(branch({ approvals_received: 2, approvals_required: 2 }))).toBe(true);
  });

  it('derives Total / In Review / Merged stats from the branch list', () => {
    build();
    component.branches.set([
      branch({ id: 'a', status: 'review' }),
      branch({ id: 'b', status: 'review' }),
      branch({ id: 'c', status: 'merged' }),
      branch({ id: 'd', status: 'draft' }),
    ]);
    const stats = component.stats();
    expect(stats.find((s) => s.label === 'Total')?.value).toBe(4);
    expect(stats.find((s) => s.label === 'In Review')?.value).toBe(2);
    expect(stats.find((s) => s.label === 'Merged')?.value).toBe(1);
  });

  it('renders the sr-only caption and a progressbar with mirrored approval values', () => {
    build();
    component.loading.set(false);
    component.branches.set([branch({ approvals_received: 1, approvals_required: 2 })]);
    fixture.detectChanges();
    const caption: HTMLElement | null = fixture.nativeElement.querySelector('table caption');
    expect(caption?.classList.contains('sr-only')).toBe(true);
    const bar: HTMLElement | null = fixture.nativeElement.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('1');
    expect(bar?.getAttribute('aria-valuemax')).toBe('2');
  });

  // ── Load-failure state (no empty-state masquerade) ────────────────────────
  it('shows a distinct error card (not the empty state) when the branches load fails', () => {
    build(true);
    expect(component.loadError()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="branches-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-empty-state')).toBeNull(); // failure ≠ "no branches yet"
  });

  it('Retry re-fetches branches and clears the error on success', () => {
    build(true);
    expect(component.loadError()).toBeTruthy();
    component.loadBranches(); // Retry
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches`);
    req.flush({ branches: [branch()] });
    fixture.detectChanges();
    expect(component.loadError()).toBeNull();
    expect(component.branches().length).toBe(1);
  });

  // ── Stale-route fake-empty / shapeless-200 guard ─────────────────────────
  // ApiService only remaps 2xx→404 when the body FAILS to parse. A STALE worker
  // route that returns a parseable-but-shapeless 200 (SPA/marketing HTML coerced
  // to {}, or a bare {}) flows STRAIGHT THROUGH — without an Array.isArray guard
  // it either fake-empties "No branches yet" (masking a broken route) or crashes
  // the @for/.length on a non-array. The success path must degrade HONESTLY into
  // the error card instead.
  it('treats a shapeless 200 (no branches array) as a load error, not fake-empty', () => {
    build(); // initial succeeds with { branches: [] }
    component.loadBranches();
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches`);
    req.flush({}); // stale route: parseable 200 with NO branches field
    fixture.detectChanges();
    // Honest degrade: error card shown, NOT the "No branches yet" empty state.
    expect(component.loadError()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="branches-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-empty-state')).toBeNull();
    // Branch list stays an array (never undefined) so @for/.length can't crash.
    expect(Array.isArray(component.branches())).toBe(true);
    expect(component.loading()).toBe(false);
  });

  it('treats a 200 whose branches field is not an array as a load error', () => {
    build();
    component.loadBranches();
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches`);
    req.flush({ branches: '<html>marketing</html>' }); // non-array (SPA HTML leaked into field)
    fixture.detectChanges();
    expect(component.loadError()).toBeTruthy();
    expect(Array.isArray(component.branches())).toBe(true);
    expect(component.branches().length).toBe(0);
  });

  it('surfaces the worker request_id on the error card as a copyable support ref', () => {
    build(); // succeed first so we control the failing re-fetch below
    component.loadBranches();
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches`);
    // Worker error envelope: { error: { code, message, request_id } }
    req.flush({ error: { code: 'INTERNAL_ERROR', request_id: 'req_branch_42' } }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(component.loadErrorRef()).toBe('req_branch_42');
    // The shared cockpit error card is what renders (not a hand-rolled banner).
    expect(fixture.nativeElement.querySelector('app-error-card[data-testid="branches-error"]')).not.toBeNull();
  });

  // Merging publishes the branch to the LIVE production site → must be confirmed.
  it('mergeBranch confirms (danger) before POSTing the merge', async () => {
    build(false, true); // confirm → true
    await component.mergeBranch(branch({ id: 'b1', branch_name: 'homepage-redesign' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect((confirmSpy.calls.mostRecent().args[0] as { danger?: boolean }).danger).toBeTrue();
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches/b1/merge`);
    req.flush({ branch: branch({ id: 'b1', status: 'merged' }) });
  });

  it('mergeBranch does NOT POST when the confirm is cancelled', async () => {
    build(false, false); // confirm → false
    await component.mergeBranch(branch({ id: 'b1' }));
    expect(confirmSpy).toHaveBeenCalled();
    httpMock.expectNone(`/api/sites/${SITE_ID}/branches/b1/merge`); // aborted before any request
  });
});
