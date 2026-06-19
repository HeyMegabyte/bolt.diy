import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReadinessCacheService } from './readiness-cache.service';
import { ApiService } from './api.service';

describe('ReadinessCacheService', () => {
  const get = jasmine.createSpy('get');
  let svc: ReadinessCacheService;

  beforeEach(() => {
    get.calls.reset();
    get.and.returnValue(of({ data: {} }));
    TestBed.configureTestingModule({
      providers: [ReadinessCacheService, { provide: ApiService, useValue: { get } }],
    });
    svc = TestBed.inject(ReadinessCacheService);
  });

  it('coalesces ids requested within the window into ONE batch call', fakeAsync(() => {
    get.and.returnValue(
      of({ data: { a: { grade: 'A', score: 90, passing: true, summary: null }, b: null } }),
    );
    svc.request('a');
    svc.request('b');
    tick(50);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/readiness', { ids: 'a,b' }, { silent: true });
    expect(svc.read('a')()).toEqual(jasmine.objectContaining({ grade: 'A', score: 90 }));
    expect(svc.read('b')()).toBeNull();
  }));

  it('dedupes — a repeated id does not trigger a second fetch', fakeAsync(() => {
    svc.request('a');
    tick(50);
    get.calls.reset();
    svc.request('a');
    tick(50);
    expect(get).not.toHaveBeenCalled();
  }));

  it('chunks the id list at 100 per request', fakeAsync(() => {
    for (let i = 0; i < 150; i++) svc.request(`s${i}`);
    tick(50);
    expect(get).toHaveBeenCalledTimes(2); // 100 + 50
  }));

  it('leaves a signal null on request error (never throws)', fakeAsync(() => {
    get.and.returnValue(throwError(() => new Error('boom')));
    svc.request('a');
    tick(50);
    expect(svc.read('a')()).toBeNull();
  }));

  it('read() for an unrequested id is null', () => {
    expect(svc.read('never')()).toBeNull();
  });
});
