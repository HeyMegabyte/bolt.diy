import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { ReviewComponent } from './review.component';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/**
 * Guards the public reviewer page (#4): loads the review, shows approve/reject
 * only while pending, posts the decision and reflects the new status. Locks the
 * stakeholder-facing contract.
 */
describe('ReviewComponent', () => {
  let fixture: ComponentFixture<ReviewComponent>;
  let host: HTMLElement;
  let get: jasmine.Spy;
  let post: jasmine.Spy;

  function build(status: string, opts: { getThrows?: boolean; passwordRequired?: boolean } = {}): void {
    get = jasmine.createSpy('get').and.returnValue(
      opts.getThrows
        ? throwError(() => ({ error: {} }))
        : of({ ok: true, review: { id: 'rev1', site_id: 's1', status, expires_at: '2026-12-31T00:00:00.000Z', password_required: !!opts.passwordRequired } }),
    );
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, status: 'approved' }));
    TestBed.configureTestingModule({
      imports: [ReviewComponent],
      providers: [
        { provide: ApiService, useValue: { get, post } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'rev1' } } } },
      ],
    });
    fixture = TestBed.createComponent(ReviewComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  afterEach(() => TestBed.resetTestingModule());

  it('loads and shows a pending review with approve/reject buttons', () => {
    build('pending');
    expect(get).toHaveBeenCalledWith('/review/rev1');
    expect(q('[data-testid="review-status"]')?.textContent?.trim()).toBe('pending');
    expect(q('[data-testid="review-approve"]')).not.toBeNull();
    expect(q('[data-testid="review-reject"]')).not.toBeNull();
  });

  it('hides the buttons for an already-decided review', () => {
    build('approved');
    expect(q('[data-testid="review-approve"]')).toBeNull();
    expect(q('[data-testid="review-decided"]')).not.toBeNull();
  });

  it('posts the decision and reflects the new status', () => {
    build('pending');
    (q('[data-testid="review-approve"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(post).toHaveBeenCalledWith('/review/rev1/decision', { action: 'approve' });
    expect(fixture.componentInstance.review()?.status).toBe('approved');
    expect(q('[data-testid="review-approve"]')).toBeNull(); // now decided
  });

  it('shows an error when the link is not found', () => {
    build('pending', { getThrows: true });
    expect(q('[data-testid="review-error"]')).not.toBeNull();
  });

  // ── Password gate (link-creator-set; verified via POST /review/:id/unlock) ──
  it('a password-protected link shows the unlock form, NOT the status/decide UI', () => {
    build('pending', { passwordRequired: true });
    expect(q('[data-testid="review-password-form"]')).withContext('password gate shown').not.toBeNull();
    expect(q('[data-testid="review-approve"]')).withContext('decision UI hidden until unlocked').toBeNull();
    expect(q('[data-testid="review-status"]')).toBeNull();
  });

  it('a correct password unlocks → reveals the status + decision UI', () => {
    build('pending', { passwordRequired: true });
    post.and.returnValue(of({ ok: true, required: true })); // unlock success
    fixture.componentInstance.password.set('hunter2!');
    fixture.componentInstance.unlock();
    fixture.detectChanges();
    expect(post).toHaveBeenCalledWith('/review/rev1/unlock', { password: 'hunter2!' }, { silent: true });
    expect(fixture.componentInstance.unlocked()).toBeTrue();
    expect(q('[data-testid="review-password-form"]')).toBeNull();
    expect(q('[data-testid="review-approve"]')).withContext('decision UI now visible').not.toBeNull();
  });

  it('a wrong password (401) shows an inline error and stays gated', () => {
    build('pending', { passwordRequired: true });
    post.and.returnValue(throwError(() => ({ status: 401 })));
    fixture.componentInstance.password.set('nope');
    fixture.componentInstance.unlock();
    fixture.detectChanges();
    expect(fixture.componentInstance.unlocked()).toBeFalse();
    expect(q('[data-testid="review-password-error"]')?.textContent).toContain('Incorrect password');
    expect(q('[data-testid="review-password-form"]')).withContext('still gated').not.toBeNull();
  });

  it('an unprotected link shows the review directly (no gate)', () => {
    build('pending', { passwordRequired: false });
    expect(q('[data-testid="review-password-form"]')).toBeNull();
    expect(q('[data-testid="review-approve"]')).not.toBeNull();
  });
});
