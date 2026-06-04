import { TestBed } from '@angular/core/testing';
import { ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import { FullscreenOverlayComponent } from './fullscreen-overlay.component';

/**
 * First coverage for FullscreenOverlayComponent (the modal-takeover surface).
 * Locks the dialog-pattern a11y contract added 2026-06-04:
 *  - focus returns to the trigger when the overlay closes (WCAG 2.4.3)
 * The focus trap is mocked; teleport-to-body runs against the real Karma DOM.
 */
const focusTrapProvider = {
  provide: ConfigurableFocusTrapFactory,
  useValue: { create: () => ({ focusInitialElementWhenReady: () => undefined, destroy: () => undefined }) },
};

describe('FullscreenOverlayComponent (a11y: focus restore)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('restores focus to the trigger when the overlay closes (WCAG 2.4.3)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus(); // real focus so the open() effect captures it
    TestBed.configureTestingModule({ imports: [FullscreenOverlayComponent], providers: [focusTrapProvider] });
    const fx = TestBed.createComponent(FullscreenOverlayComponent);
    fx.componentRef.setInput('open', true);
    fx.detectChanges(); // effect runs with open=true → captures `trigger`
    const focusSpy = spyOn(trigger, 'focus').and.callThrough(); // spy AFTER capture
    fx.componentRef.setInput('open', false);
    fx.detectChanges(); // effect runs with open=false → cleanupTeleport + restoreFocus()
    expect(focusSpy).toHaveBeenCalled();
    trigger.remove();
  });

  it('close() emits the closed output', () => {
    TestBed.configureTestingModule({ imports: [FullscreenOverlayComponent], providers: [focusTrapProvider] });
    const fx = TestBed.createComponent(FullscreenOverlayComponent);
    let closed = 0;
    fx.componentInstance.closed.subscribe(() => (closed += 1));
    fx.componentInstance.close();
    expect(closed).toBe(1);
  });
});
