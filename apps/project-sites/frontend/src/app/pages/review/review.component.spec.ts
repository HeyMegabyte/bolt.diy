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

  function build(status: string, opts: { getThrows?: boolean } = {}): void {
    get = jasmine.createSpy('get').and.returnValue(
      opts.getThrows
        ? throwError(() => ({ error: {} }))
        : of({ ok: true, review: { id: 'rev1', site_id: 's1', status, expires_at: '2026-12-31T00:00:00.000Z' } }),
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
});
