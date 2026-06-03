import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SiteBranchesComponent } from './site-branches.component';
import { ToastService } from '../../../services/toast.service';

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

  const SITE_ID = 'site-branches-1';

  function build(): void {
    TestBed.configureTestingModule({
      imports: [SiteBranchesComponent, RouterModule.forRoot([])],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
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
    // Flush the ngOnInit load
    const req = httpMock.expectOne(`/api/sites/${SITE_ID}/branches`);
    req.flush({ branches: [] });
    fixture.detectChanges();
  }

  afterEach(() => {
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
});
