import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DeleteConfirmDialogComponent } from './delete-confirm-dialog.component';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/**
 * Destructive-action contract for the Delete Site dialog ("verify destructive
 * actions" mandate). Guarantees: confirmDelete() forwards the operator's
 * cancel-subscription choice verbatim; it closes the dialog with `true` (the
 * caller's "deleted" signal) ONLY after a successful API delete; and a failed
 * delete clears the busy flag + leaves the dialog OPEN (no false-success close,
 * Cancel/Retry still reachable). overrideComponent strips the template so the
 * destructive logic is tested in isolation.
 */
function make(delResult = of(undefined)): {
  c: DeleteConfirmDialogComponent;
  del: jasmine.Spy;
  close: jasmine.Spy;
  success: jasmine.Spy;
} {
  const del = jasmine.createSpy('deleteSiteWithOptions').and.returnValue(delResult);
  const close = jasmine.createSpy('close');
  const success = jasmine.createSpy('success');
  TestBed.configureTestingModule({
    imports: [DeleteConfirmDialogComponent],
    providers: [
      { provide: DIALOG_DATA, useValue: { siteId: 's1', siteName: 'My Site', hasPaidPlan: true } },
      { provide: DialogRef, useValue: { close } },
      { provide: ApiService, useValue: { deleteSiteWithOptions: del } },
      { provide: ToastService, useValue: { success, error: jasmine.createSpy('error') } },
    ],
  });
  TestBed.overrideComponent(DeleteConfirmDialogComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(DeleteConfirmDialogComponent).componentInstance, del, close, success };
}

describe('DeleteConfirmDialogComponent (destructive site delete)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('deletes with cancelSub=false by default, toasts success, and closes(true)', () => {
    const { c, del, close, success } = make();
    c.confirmDelete();
    expect(del).toHaveBeenCalledWith('s1', false);
    expect(success).toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('forwards cancelSub=true verbatim when the operator opts to cancel the subscription', () => {
    const { c, del } = make();
    c.cancelSub = true;
    c.confirmDelete();
    expect(del).toHaveBeenCalledWith('s1', true);
  });

  it('on a delete failure: clears the deleting flag, does NOT toast success, and does NOT close (no false success)', () => {
    const { c, close, success } = make(throwError(() => ({ status: 500 })));
    c.confirmDelete();
    expect(c.deleting()).withContext('busy flag cleared so the operator can retry/cancel').toBeFalse();
    expect(success).not.toHaveBeenCalled();
    expect(close).withContext('dialog stays open on failure — never reports a delete that did not happen').not.toHaveBeenCalled();
  });
});
