import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminBulkOpsComponent } from './bulk-ops.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * Guards the Bulk Site Ops preview surface: the flag fields only show for
 * set_flag, Preview posts dryRun:true with the right body, and the returned
 * plan (eligible + skips) renders. Locks the read-only-preview contract.
 */
describe('AdminBulkOpsComponent', () => {
  let fixture: ComponentFixture<AdminBulkOpsComponent>;
  let host: HTMLElement;
  let post: jasmine.Spy;

  const PLAN = {
    ok: true,
    dryRun: true,
    plan: {
      operation: 'archive',
      eligible: ['s1', 's2', 's3'],
      skipped: [{ id: 's4', reason: 'archived' }],
      cappedAt: null,
    },
  };

  beforeEach(async () => {
    post = jasmine.createSpy('post').and.returnValue(of(PLAN));
    await TestBed.configureTestingModule({
      imports: [AdminBulkOpsComponent],
      providers: [
        { provide: ApiService, useValue: { post } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminBulkOpsComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from(host.querySelectorAll(sel));

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('hides the flag fields unless operation is set_flag', () => {
    expect(q('[data-testid="bulk-ops-setflag-fields"]')).toBeNull();
    fixture.componentInstance.operationModel.set('set_flag');
    fixture.detectChanges();
    expect(q('[data-testid="bulk-ops-setflag-fields"]')).not.toBeNull();
  });

  it('previews with dryRun:true and renders the plan (eligible + skips)', () => {
    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.calls.mostRecent().args;
    expect(path).toBe('/sites/bulk');
    expect((body as { dryRun: boolean }).dryRun).toBe(true);
    expect((body as { operation: string }).operation).toBe('archive');
    expect((body as { allSites: boolean }).allSites).toBe(true);

    expect(q('[data-testid="bulk-ops-result"]')).not.toBeNull();
    expect(all('[data-testid="bulk-ops-skip-row"]').length).toBe(1);
    expect(fixture.componentInstance.plan()?.eligible.length).toBe(3);
  });

  it('includes flagKey + enabled in the body for set_flag', () => {
    fixture.componentInstance.operationModel.set('set_flag');
    fixture.componentInstance.flagKeyModel.set('review_synthesis');
    fixture.componentInstance.enabledModel.set(false);
    fixture.detectChanges();

    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    const [, body] = post.calls.mostRecent().args;
    expect((body as { flagKey: string }).flagKey).toBe('review_synthesis');
    expect((body as { enabled: boolean }).enabled).toBe(false);
  });

  it('surfaces a server error message', () => {
    post.and.returnValue(throwError(() => ({ error: { error: { message: 'No sites to preview' } } })));
    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('[data-testid="bulk-ops-error"]')?.textContent).toContain('No sites to preview');
  });

  it('clears a prior plan when the operation changes', () => {
    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.plan()).not.toBeNull();

    fixture.componentInstance.onOperationChange('republish');
    expect(fixture.componentInstance.plan()).toBeNull();
  });

  it('offers Apply after a non-empty preview, but not for republish', () => {
    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('[data-testid="bulk-ops-apply-btn"]')).not.toBeNull(); // archive plan, eligible>0

    fixture.componentInstance.operationModel.set('republish');
    fixture.detectChanges();
    expect(fixture.componentInstance.canApply()).toBe(false);
  });

  it('applies with dryRun:false after confirm and renders the result', () => {
    post.and.returnValue(
      of({ ok: true, dryRun: false, plan: PLAN.plan, results: { archived: ['s1', 's2', 's3'], failed: [] } }),
    );
    // open preview first so canApply() is true
    post.and.returnValue(of(PLAN));
    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    (q('[data-testid="bulk-ops-apply-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('[data-testid="bulk-ops-confirm-apply"]')).not.toBeNull(); // dialog open

    post.and.returnValue(
      of({ ok: true, dryRun: false, plan: PLAN.plan, results: { archived: ['s1', 's2', 's3'], failed: [] } }),
    );
    (q('[data-testid="bulk-ops-confirm-apply"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const applyCall = post.calls.mostRecent().args;
    expect((applyCall[1] as { dryRun: boolean }).dryRun).toBe(false);
    expect(q('[data-testid="bulk-ops-apply-result"]')).not.toBeNull();
    expect(fixture.componentInstance.applyResults()?.applied.length).toBe(3);
    expect(fixture.componentInstance.confirmOpen()).toBe(false);
  });

  it('normalizes set_flag results (results.set) into applied', () => {
    fixture.componentInstance.operationModel.set('set_flag');
    fixture.componentInstance.flagKeyModel.set('review_synthesis');
    post.and.returnValue(of(PLAN));
    (q('[data-testid="bulk-ops-preview-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    post.and.returnValue(
      of({ ok: true, dryRun: false, plan: PLAN.plan, results: { set: ['s1', 's2'], failed: [{ id: 's3', error: 'no_match' }] } }),
    );
    fixture.componentInstance.apply();
    fixture.detectChanges();
    expect(fixture.componentInstance.applyResults()?.applied).toEqual(['s1', 's2']);
    expect(all('[data-testid="bulk-ops-apply-fail-row"]').length).toBe(1);
  });

  it('renders the set-flag enabled checkbox through Spartan hlmCheckbox (cyan accent + focus ring)', () => {
    fixture.componentInstance.operationModel.set('set_flag');
    fixture.detectChanges();
    expect(q('input[data-testid="bulk-ops-enabled"][hlmCheckbox]')).not.toBeNull();
    expect(q('[data-testid="bulk-ops-enabled"]')?.className ?? '').not.toContain('accent-primary');
  });

  it('renders the operation select through Spartan hlmSelect (not hand-rolled classes)', () => {
    expect(q('select[data-testid="bulk-ops-operation"][hlmSelect]')).withContext('converged to the Spartan select primitive').not.toBeNull();
    expect(q('[data-testid="bulk-ops-operation"]')?.className ?? '').not.toContain('bg-dark');
  });
});
