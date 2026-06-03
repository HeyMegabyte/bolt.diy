import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { CalendarWidgetComponent } from './calendar-widget.component';
import { AuthService } from '../../../../services/auth.service';
import { ToastService } from '../../../../services/toast.service';

/**
 * Deleting a calendar event hits DELETE /api/calendar/events/:id — destructive,
 * no undo. It used to fire IMMEDIATELY on the editor's "Delete" click. It now
 * confirms first via the action-armed toast.warning pattern (the cockpit confirm
 * used across admin); the DELETE only runs when the operator clicks the toast
 * action. Completes the destructive-confirm audit (last open gap).
 *
 * We never call detectChanges() so ngOnInit (route snapshot + http.get loads)
 * never fires — deleteEvent is exercised directly.
 */
describe('CalendarWidgetComponent (destructive deleteEvent is confirm-guarded)', () => {
  let del: jasmine.Spy;
  let warning: jasmine.Spy;
  let success: jasmine.Spy;
  let lastAction: { label: string; run: () => void } | undefined;

  function build(): CalendarWidgetComponent {
    del = jasmine.createSpy('delete').and.returnValue(of({}));
    success = jasmine.createSpy('success');
    lastAction = undefined;
    warning = jasmine.createSpy('warning').and.callFake((_m: string, opts?: { action?: { label: string; run: () => void } }) => {
      lastAction = opts?.action;
      return 1;
    });
    TestBed.configureTestingModule({
      imports: [CalendarWidgetComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ data: [] }), post: () => of({}), patch: () => of({}), delete: del } },
        { provide: AuthService, useValue: { getToken: () => 'tok' } },
        { provide: ToastService, useValue: { error: () => 0, success, warning } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: Router, useValue: { navigate: () => undefined } },
      ],
    });
    return TestBed.createComponent(CalendarWidgetComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('asks for confirmation first — no immediate DELETE', () => {
    const c = build();
    c.form.id = 'ev1';
    c.editor.set(true);
    c.deleteEvent();
    expect(warning).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(c.editor()).toBe(true); // editor stays open until confirmed
  });

  it('runs the DELETE only when the toast action is clicked, then closes the editor', () => {
    const c = build();
    c.form.id = 'ev1';
    c.editor.set(true);
    c.deleteEvent();
    lastAction?.run();
    expect(del).toHaveBeenCalledWith('/api/calendar/events/ev1', { headers: { Authorization: 'Bearer tok' } });
    expect(success).toHaveBeenCalled();
    expect(c.editor()).toBe(false);
  });

  it('is a no-op with no event id (nothing to delete)', () => {
    const c = build();
    c.form.id = null;
    c.deleteEvent();
    expect(warning).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

/**
 * WCAG 1.3.1 — the event editor's Start/End/Location/Notes fields had VISIBLE
 * <label> siblings that weren't associated (no for/id), so a screen reader
 * didn't announce the field's purpose. Associate label[for] ↔ control[id].
 * (Title already has aria-label; All-day + Repeat use wrapping <label>.)
 */
describe('CalendarWidgetComponent (event-editor label association)', () => {
  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [CalendarWidgetComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ data: [] }), post: () => of({}), patch: () => of({}), delete: () => of({}) } },
        { provide: AuthService, useValue: { getToken: () => 'tok' } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0 } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: Router, useValue: { navigate: () => undefined } },
      ],
    });
    const fx = TestBed.createComponent(CalendarWidgetComponent);
    fx.detectChanges();              // ngOnInit (empty loads)
    fx.componentInstance.editor.set(true);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('associates Start / End / Location / Notes with their visible labels', () => {
    const el = render();
    // Every labelled m-row control (Start/End/Location/Notes) must be reachable by a label[for].
    const rows = Array.from(el.querySelectorAll('.m-row'));
    let checked = 0;
    for (const r of rows) {
      const lbl = r.querySelector(':scope > label');
      const ctrl = r.querySelector('input[type="datetime-local"], input[type="text"], textarea') as HTMLElement | null;
      if (lbl && ctrl) {
        checked++;
        expect(ctrl.id).withContext(`${lbl.textContent?.trim()} control has an id`).toBeTruthy();
        expect(el.querySelector(`label[for="${ctrl.id}"]`)).withContext(`${lbl.textContent?.trim()} label[for] points to it`).toBeTruthy();
      }
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
