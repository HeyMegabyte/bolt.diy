import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ToastService } from './toast.service';

/**
 * Coverage for ToastService — the dedupe-aware global toast queue every admin section
 * uses for success/failure feedback. Locks the contract: dedup identical (message+type)
 * within the 2s window (returns the prior id, no duplicate), distinct toasts coexist,
 * auto-dismiss after the type's duration, `duration:0` is sticky, dismiss/dismissAll,
 * convenience methods map to the right type, and action/correlationId pass through.
 */
function svc(): ToastService {
  TestBed.configureTestingModule({ providers: [ToastService] });
  return TestBed.inject(ToastService);
}

describe('ToastService (dedupe + lifecycle)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('show() enqueues a toast and returns its id', () => {
    const t = svc();
    const id = t.show('Saved', 'success', 0);
    expect(t.toasts().length).toBe(1);
    expect(t.toasts()[0].id).toBe(id);
    expect(t.toasts()[0].type).toBe('success');
  });

  it('collapses an identical (message+type) toast within the dedupe window (returns prior id)', () => {
    const t = svc();
    const a = t.show('Could not load', 'error', 0);
    const b = t.show('Could not load', 'error', 0);
    expect(b).toBe(a);
    expect(t.toasts().length).toBe(1);
  });

  it('does NOT dedupe when message or type differs', () => {
    const t = svc();
    t.show('Could not load', 'error', 0);
    t.show('Could not load', 'warning', 0); // same message, different type
    t.show('Saved', 'error', 0); // same type, different message
    expect(t.toasts().length).toBe(3);
  });

  it('auto-dismisses after the toast duration', fakeAsync(() => {
    const t = svc();
    t.show('Transient', 'info', 1000);
    expect(t.toasts().length).toBe(1);
    tick(1000);
    expect(t.toasts().length).toBe(0);
  }));

  it('duration:0 is sticky (never auto-dismisses)', fakeAsync(() => {
    const t = svc();
    const id = t.show('Uploading…', 'info', 0);
    tick(60000);
    expect(t.toasts().length).toBe(1);
    t.dismiss(id);
    expect(t.toasts().length).toBe(0);
  }));

  it('dismiss(unknownId) is a no-op; dismissAll clears everything', () => {
    const t = svc();
    t.show('A', 'info', 0);
    t.show('B', 'success', 0);
    t.dismiss(99999);
    expect(t.toasts().length).toBe(2);
    t.dismissAll();
    expect(t.toasts().length).toBe(0);
  });

  it('convenience methods map to the right severity', () => {
    const t = svc();
    t.error('e', 0); t.success('s', 0); t.warning('w', 0); t.info('i', 0);
    expect(t.toasts().map((x) => x.type)).toEqual(['error', 'success', 'warning', 'info']);
  });

  it('carries an action and correlationId through to the rendered toast', () => {
    const t = svc();
    const action = { label: 'Retry', run: () => undefined };
    t.show('Failed', 'error', { duration: 0, action, correlationId: 'req-123' });
    const toast = t.toasts()[0];
    expect(toast.action?.label).toBe('Retry');
    expect(toast.correlationId).toBe('req-123');
  });
});
