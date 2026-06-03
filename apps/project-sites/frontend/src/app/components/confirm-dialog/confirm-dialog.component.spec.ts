import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import { ConfirmDialogComponent } from './confirm-dialog.component';

/**
 * First coverage for ConfirmDialogComponent — the Spartan replacement for window.confirm()
 * behind every destructive admin action (ConfirmService.confirm). Locks the safety contract:
 *  - Accept resolves the DialogRef with `true`, Cancel with `false`
 *  - the confirm button renders DESTRUCTIVE (red) by default, cyan only when danger:false
 *  - title/message + custom labels render from the injected data
 * Full render (the buttons call dialogRef.close directly); focus-trap factory stubbed for the nested shell.
 */
function make(data: Record<string, unknown>): { fixture: ComponentFixture<ConfirmDialogComponent>; close: jasmine.Spy } {
  const close = jasmine.createSpy('close');
  TestBed.configureTestingModule({
    imports: [ConfirmDialogComponent],
    providers: [
      { provide: DIALOG_DATA, useValue: data },
      { provide: DialogRef, useValue: { close } },
      {
        provide: ConfigurableFocusTrapFactory,
        useValue: { create: () => ({ focusInitialElementWhenReady: () => undefined, destroy: () => undefined }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(ConfirmDialogComponent);
  fixture.detectChanges();
  return { fixture, close };
}

function q(fixture: ComponentFixture<ConfirmDialogComponent>, testid: string): HTMLElement {
  return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
}

describe('ConfirmDialogComponent (destructive confirm contract)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Accept resolves the dialog with true', () => {
    const { fixture, close } = make({ title: 'Delete?', message: 'Gone forever.' });
    q(fixture, 'confirm-accept').click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('Cancel resolves the dialog with false', () => {
    const { fixture, close } = make({ title: 'Delete?', message: 'Gone forever.' });
    q(fixture, 'confirm-cancel').click();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('renders the destructive (red) confirm button by default', () => {
    const { fixture } = make({ title: 'Delete?', message: 'x' });
    expect(q(fixture, 'confirm-accept').className).toContain('red-500');
  });

  it('renders a cyan-accent confirm button when danger is explicitly false', () => {
    const { fixture } = make({ title: 'Proceed?', message: 'x', danger: false });
    expect(q(fixture, 'confirm-accept').className).toContain('ps-accent');
  });

  it('renders the message and honours custom button labels', () => {
    const { fixture } = make({ title: 'Revoke?', message: 'Integrations break.', confirmLabel: 'Yes, revoke', cancelLabel: 'Keep' });
    expect(q(fixture, 'confirm-message').textContent).toContain('Integrations break.');
    expect(q(fixture, 'confirm-accept').textContent).toContain('Yes, revoke');
    expect(q(fixture, 'confirm-cancel').textContent).toContain('Keep');
  });
});
