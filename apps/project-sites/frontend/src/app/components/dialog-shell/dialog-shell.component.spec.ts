import { TestBed } from '@angular/core/testing';
import { ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import { DialogShellComponent } from './dialog-shell.component';

/**
 * First coverage for DialogShellComponent — the ONE modal primitive every admin
 * dialog renders through (custom modals are banned). Locking its close contract
 * guards every consumer (delete-confirm, transfer, create dialogs, …):
 *  - close() emits `closed`
 *  - Escape (HostListener) closes
 *  - a backdrop/root click closes; a click inside the panel does NOT
 * overrideComponent strips the template so ngAfterViewInit finds no panel (no real
 * focus-trap needed); the close/escape/backdrop logic is driven directly.
 */
function make(): { c: DialogShellComponent; fired: () => number } {
  let count = 0;
  TestBed.configureTestingModule({
    imports: [DialogShellComponent],
    providers: [
      {
        provide: ConfigurableFocusTrapFactory,
        useValue: { create: () => ({ focusInitialElementWhenReady: () => undefined, destroy: () => undefined }) },
      },
    ],
  });
  TestBed.overrideComponent(DialogShellComponent, { set: { template: '<div></div>' } });
  const c = TestBed.createComponent(DialogShellComponent).componentInstance;
  c.closed.subscribe(() => (count += 1));
  return { c, fired: () => count };
}

function clickOn(cls: string): MouseEvent {
  return { target: { classList: { contains: (c: string) => c === cls } } } as unknown as MouseEvent;
}

describe('DialogShellComponent (modal close contract)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('close() emits the closed output', () => {
    const { c, fired } = make();
    c.close();
    expect(fired()).toBe(1);
  });

  it('Escape closes the dialog', () => {
    const { c, fired } = make();
    c.onEscape();
    expect(fired()).toBe(1);
  });

  it('a click on the root/backdrop closes the dialog', () => {
    const { c, fired } = make();
    c.onBackdropClick(clickOn('ps-dialog-root'));
    expect(fired()).toBe(1);
    c.onBackdropClick(clickOn('ps-dialog-backdrop'));
    expect(fired()).toBe(2);
  });

  it('a click INSIDE the panel does NOT close (only backdrop/root does)', () => {
    const { c, fired } = make();
    c.onBackdropClick(clickOn('dialog-panel'));
    c.onBackdropClick(clickOn('some-inner-button'));
    expect(fired()).toBe(0);
  });
});
