import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminEmailComponent } from './email.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the email/submissions load-error gating (first coverage): a failed
 * listFormSubmissions used to be silent (error: () => loadingSubmissions.set(false))
 * → the empty list fell through to "No submissions yet". Now refreshSubmissions sets a
 * persistent submissionsError + Retry card; success/retry clear it. overrideComponent
 * strips the template; refreshSubmissions() is driven directly.
 */
function make(list: jasmine.Spy): AdminEmailComponent {
  TestBed.configureTestingModule({
    imports: [AdminEmailComponent],
    providers: [
      { provide: ApiService, useValue: { listFormSubmissions: list, get: () => of({ data: [] }), post: () => of({}) } },
      { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }), formatRelativeTime: () => 'now' } },
    ],
  });
  TestBed.overrideComponent(AdminEmailComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminEmailComponent).componentInstance;
}

describe('AdminEmailComponent (submissions load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates submissions and leaves submissionsError null', () => {
    const c = make(jasmine.createSpy('list').and.returnValue(of({ data: [{ id: 'm1' }] })));
    c.refreshSubmissions();
    expect(c.submissionsError()).toBeNull();
    expect(c.submissions().length).toBe(1);
    expect(c.loadingSubmissions()).toBe(false);
  });

  it('a load error sets a persistent submissionsError (not a fake empty)', () => {
    const c = make(jasmine.createSpy('list').and.returnValue(throwError(() => ({ status: 500 }))));
    c.refreshSubmissions();
    expect(c.submissionsError()).toContain('Could not load');
    expect(c.submissions().length).toBe(0);
    expect(c.loadingSubmissions()).toBe(false);
  });

  it('retry after an error clears the prior submissionsError', () => {
    const list = jasmine.createSpy('list').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = make(list);
    c.refreshSubmissions();
    expect(c.submissionsError()).not.toBeNull();
    c.refreshSubmissions();
    expect(c.submissionsError()).toBeNull();
  });
});
