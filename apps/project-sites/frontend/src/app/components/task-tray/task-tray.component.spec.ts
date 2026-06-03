import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { TaskTrayComponent } from './task-tray.component';

/**
 * Resolve contract for the agent human-in-the-loop task tray. Resolving a task
 * does an OPTIMISTIC remove for snappy UX, but a failed POST must ROLL BACK
 * (re-add the task) so an agent's question is never silently lost — and a
 * second resolve while one is in flight, or an empty free-form answer, must be
 * a no-op. overrideComponent strips the template + we skip detectChanges so the
 * 8s poll never fires; resolve() is driven directly.
 */
function make(postResult: unknown = of({ ok: true })): { c: TaskTrayComponent; post: jasmine.Spy } {
  const post = jasmine.createSpy('post').and.returnValue(postResult);
  TestBed.configureTestingModule({
    imports: [TaskTrayComponent],
    providers: [{ provide: HttpClient, useValue: { post, get: () => of({ tasks: [] }) } }],
  });
  TestBed.overrideComponent(TaskTrayComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(TaskTrayComponent).componentInstance, post };
}
const mkTask = (id: string): never =>
  ({ id, prompt: 'q', options: ['yes', 'no'], defaultChoice: null, resolvedAt: null }) as never;

describe('TaskTrayComponent (agent inbox resolve)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('resolve() POSTs the choice + optimistically removes the task; on success it stays gone + busy clears', () => {
    const { c, post } = make(of({ ok: true }));
    c.tasks.set([mkTask('t1'), mkTask('t2')]);
    c.resolve(c.tasks()[0], 'yes');
    expect(post).toHaveBeenCalledWith('/api/inbox/tasks/t1/resolve', { choice: 'yes' });
    expect(c.tasks().map((t) => t.id)).toEqual(['t2']);
    expect(c.busyId()).toBeNull();
  });

  it('on a resolve FAILURE the task is rolled back (re-added, never silently lost) + busy clears', () => {
    const { c } = make(throwError(() => ({ status: 500 })));
    c.tasks.set([mkTask('t1')]);
    c.resolve(c.tasks()[0], 'no');
    expect(c.tasks().map((t) => t.id)).withContext('a failed resolve restores the task so it can be retried').toEqual(['t1']);
    expect(c.busyId()).toBeNull();
  });

  it('ignores a second resolve while one is already in flight (busyId guard)', () => {
    const { c, post } = make(of({ ok: true }));
    c.tasks.set([mkTask('t1'), mkTask('t2')]);
    c.busyId.set('t2'); // simulate an in-flight resolve
    c.resolve(c.tasks()[0], 'yes');
    expect(post).not.toHaveBeenCalled();
  });

  it('resolveFreeform is a no-op on empty/whitespace input (never posts a blank choice)', () => {
    const { c, post } = make();
    c.tasks.set([mkTask('t1')]);
    c.freeformText['t1'] = '   ';
    c.resolveFreeform(c.tasks()[0]);
    expect(post).not.toHaveBeenCalled();
  });
});
