import { TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import { ConfirmService } from './confirm.service';

/**
 * Coverage for ConfirmService — the promise-based window.confirm() replacement behind
 * every destructive admin action (pairs with the ConfirmDialogComponent spec). The
 * security-critical guarantee: confirm() resolves TRUE only when the dialog closes with
 * exactly `true`; a cancel (false) OR a dismiss (backdrop/Esc → undefined) resolves FALSE,
 * so a misclick/dismiss can never accidentally confirm a destructive action.
 */
function make(closedValue: boolean | undefined): { svc: ConfirmService; open: jasmine.Spy } {
  const open = jasmine.createSpy('open').and.returnValue({ closed: of(closedValue) });
  TestBed.configureTestingModule({
    providers: [
      ConfirmService,
      { provide: Dialog, useValue: { open } },
    ],
  });
  return { svc: TestBed.inject(ConfirmService), open };
}

describe('ConfirmService (destructive-confirm resolution)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('resolves true only when the dialog confirms (closed === true)', async () => {
    const { svc } = make(true);
    expect(await svc.confirm({ title: 'Delete?', message: 'Gone forever.' })).toBe(true);
  });

  it('resolves false when the dialog is cancelled (closed === false)', async () => {
    const { svc } = make(false);
    expect(await svc.confirm({ title: 'Delete?', message: 'Gone forever.' })).toBe(false);
  });

  it('resolves false when the dialog is dismissed (backdrop/Esc → undefined)', async () => {
    const { svc } = make(undefined);
    // The `result === true` guard means a dismiss can NEVER read as a confirm.
    expect(await svc.confirm({ title: 'Delete?', message: 'Gone forever.' })).toBe(false);
  });

  it('opens the dialog with the supplied data', async () => {
    const { svc, open } = make(true);
    await svc.confirm({ title: 'Revoke token', message: 'Integrations break.', confirmLabel: 'Revoke' });
    expect(open).toHaveBeenCalled();
    const config = open.calls.mostRecent().args[1] as { data: { title: string; confirmLabel?: string } };
    expect(config.data.title).toBe('Revoke token');
    expect(config.data.confirmLabel).toBe('Revoke');
  });
});
