import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TaskTrayComponent } from './task-tray.component';
import { ApiService } from '../../services/api.service';

/**
 * Resolve contract for the agent human-in-the-loop task tray. Resolving a task
 * does an OPTIMISTIC remove for snappy UX, but a failed POST must ROLL BACK
 * (re-add the task) so an agent's question is never silently lost — and a
 * second resolve while one is in flight, or an empty free-form answer, must be
 * a no-op.
 *
 * AUTH: the tray MUST go through `ApiService` (which injects the bearer token),
 * NOT raw `HttpClient` — a raw call sends no Authorization header, so
 * `/api/inbox/tasks` 401s every 8s on every admin route (console-error spam +
 * a dead poll). The spec provides ONLY ApiService (no HttpClient) so a raw
 * `inject(HttpClient)` would fail to construct — locking the authed path in.
 *
 * overrideComponent strips the template + we skip detectChanges so the 8s poll
 * never fires; resolve() is driven directly.
 */
function make(resolveResult: unknown = of({ ok: true })): {
  c: TaskTrayComponent;
  getInboxTasks: jasmine.Spy;
  resolveInboxTask: jasmine.Spy;
} {
  const getInboxTasks = jasmine.createSpy('getInboxTasks').and.returnValue(of({ tasks: [] }));
  const resolveInboxTask = jasmine.createSpy('resolveInboxTask').and.returnValue(resolveResult);
  TestBed.configureTestingModule({
    imports: [TaskTrayComponent],
    providers: [{ provide: ApiService, useValue: { getInboxTasks, resolveInboxTask } }],
  });
  TestBed.overrideComponent(TaskTrayComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(TaskTrayComponent).componentInstance, getInboxTasks, resolveInboxTask };
}
const mkTask = (id: string): never =>
  ({ id, taskKind: 'choice', prompt: 'q', options: ['yes', 'no'], defaultChoice: null, expiresAt: 0, createdAt: 0 }) as never;

describe('TaskTrayComponent (agent inbox resolve)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads tasks through the bearer-authed ApiService (never raw HttpClient → no 401 poll spam)', () => {
    const { c, getInboxTasks } = make();
    c.refreshNow();
    expect(getInboxTasks).withContext('inbox poll goes through ApiService.getInboxTasks (bearer attached)').toHaveBeenCalled();
  });

  it('resolve() calls ApiService.resolveInboxTask + optimistically removes the task; on success it stays gone + busy clears', () => {
    const { c, resolveInboxTask } = make(of({ ok: true }));
    c.tasks.set([mkTask('t1'), mkTask('t2')]);
    c.resolve(c.tasks()[0], 'yes');
    expect(resolveInboxTask).toHaveBeenCalledWith('t1', 'yes');
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
    const { c, resolveInboxTask } = make(of({ ok: true }));
    c.tasks.set([mkTask('t1'), mkTask('t2')]);
    c.busyId.set('t2'); // simulate an in-flight resolve
    c.resolve(c.tasks()[0], 'yes');
    expect(resolveInboxTask).not.toHaveBeenCalled();
  });

  it('resolveFreeform is a no-op on empty/whitespace input (never posts a blank choice)', () => {
    const { c, resolveInboxTask } = make();
    c.tasks.set([mkTask('t1')]);
    c.freeformText['t1'] = '   ';
    c.resolveFreeform(c.tasks()[0]);
    expect(resolveInboxTask).not.toHaveBeenCalled();
  });
});
