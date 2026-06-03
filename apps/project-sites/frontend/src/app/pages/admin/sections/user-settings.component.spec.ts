import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminUserSettingsComponent } from './user-settings.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';
import { ConfirmService } from '../../../services/confirm.service';
import { HttpClient } from '@angular/common/http';

/**
 * First coverage for User Settings — focus on the SECURITY-critical destructive
 * account-deletion guard (the "verify destructive actions" mandate) + the
 * notification-pref toggle. The guarantee: performDelete() fires NO request
 * unless the user typed exactly "delete" (case-insensitive) — a misclick or a
 * partial word can't delete the account. overrideComponent strips the template.
 */
function make(del = jasmine.createSpy('delete').and.returnValue(throwError(() => ({ status: 404 })))): {
  c: AdminUserSettingsComponent;
  http: { delete: jasmine.Spy; post: jasmine.Spy };
  toast: { error: jasmine.Spy; success: jasmine.Spy };
} {
  const http = { get: () => of({}), post: jasmine.createSpy('post').and.returnValue(of({})), put: () => of({}), delete: del };
  const toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') };
  TestBed.configureTestingModule({
    imports: [AdminUserSettingsComponent],
    providers: [
      { provide: ApiService, useValue: http },
      { provide: ToastService, useValue: toast },
      { provide: AuthService, useValue: { email: () => 'test@megabyte.space', user: () => ({}), signOut: () => undefined } },
      { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      { provide: HttpClient, useValue: http },
    ],
  });
  TestBed.overrideComponent(AdminUserSettingsComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminUserSettingsComponent).componentInstance, http, toast };
}

describe('AdminUserSettingsComponent (destructive delete guard + notifications)', () => {
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('performDelete is a NO-OP unless the confirm text is exactly "delete"', () => {
    const { c, http } = make();
    c.deleteConfirm = '';
    c.performDelete();
    c.deleteConfirm = 'del';
    c.performDelete();
    c.deleteConfirm = 'delete my account';
    c.performDelete();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('fires the delete only with an exact (case-insensitive, trimmed) "delete" confirm', () => {
    const { c, http } = make();
    c.deleteConfirm = '  DELETE  ';
    c.performDelete();
    expect(http.delete).toHaveBeenCalledWith('/admin/account');
  });

  it('on a delete failure, surfaces an error and clears the deleting flag (graceful, no dead-end)', () => {
    const { c, toast } = make();
    c.deleteConfirm = 'delete';
    c.performDelete();
    expect(toast.error).toHaveBeenCalled();
    expect(c.deleting()).toBe(false);
  });

  it('openDeleteAccount opens the dialog and resets the confirm text', () => {
    const { c } = make();
    c.deleteConfirm = 'stale';
    c.openDeleteAccount();
    expect(c.deleteOpen()).toBe(true);
    expect(c.deleteConfirm).toBe('');
  });

  it('closeDeleteDialog is blocked mid-deletion (cannot dismiss while a delete is in flight)', () => {
    const { c } = make();
    c.deleteOpen.set(true);
    c.deleting.set(true);
    c.closeDeleteDialog();
    expect(c.deleteOpen()).toBe(true); // still open
    c.deleting.set(false);
    c.closeDeleteDialog();
    expect(c.deleteOpen()).toBe(false);
  });

  it('toggleNotification flips the target pref and fires a fire-and-forget sync', () => {
    const { c, http } = make();
    const g = c.notificationGroups()[0];
    const p = g.prefs[0];
    const before = p.enabled;
    c.toggleNotification(g.id, p.id);
    const after = c.notificationGroups()[0].prefs[0].enabled;
    expect(after).toBe(!before);
    expect(http.post).toHaveBeenCalled();
  });
});
