import { TestBed } from '@angular/core/testing';
import { ConfigurableFocusTrapFactory } from '@angular/cdk/a11y';
import { SidePanelComponent } from './side-panel.component';

/**
 * First coverage for SidePanelComponent (the right-rail drawer). Locks the
 * dialog-pattern a11y contract added 2026-06-04:
 *  - focus returns to the trigger when the panel closes (WCAG 2.4.3)
 *  - Escape emits `closed` while open
 * The focus trap is mocked (no real DOM trap needed).
 */
const focusTrapProvider = {
  provide: ConfigurableFocusTrapFactory,
  useValue: { create: () => ({ focusInitialElementWhenReady: () => undefined, destroy: () => undefined }) },
};

describe('SidePanelComponent (a11y: focus restore + close)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('restores focus to the trigger when the panel closes (WCAG 2.4.3)', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus(); // real focus so the open() effect captures it as previouslyFocused
    TestBed.configureTestingModule({ imports: [SidePanelComponent], providers: [focusTrapProvider] });
    const fx = TestBed.createComponent(SidePanelComponent);
    fx.componentRef.setInput('open', true);
    fx.detectChanges(); // effect runs with open=true → captures `trigger`
    const focusSpy = spyOn(trigger, 'focus').and.callThrough(); // spy AFTER capture
    fx.componentRef.setInput('open', false);
    fx.detectChanges(); // effect runs with open=false → restoreFocus()
    expect(focusSpy).toHaveBeenCalled();
    trigger.remove();
  });

  it('Escape emits closed while open', () => {
    TestBed.configureTestingModule({ imports: [SidePanelComponent], providers: [focusTrapProvider] });
    const fx = TestBed.createComponent(SidePanelComponent);
    fx.componentRef.setInput('open', true);
    fx.detectChanges();
    let closed = 0;
    fx.componentInstance.closed.subscribe(() => (closed += 1));
    fx.componentInstance.onEscape();
    expect(closed).toBe(1);
  });
});
