import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router, type UrlTree } from '@angular/router';
import { of, throwError } from 'rxjs';
import { FeatureFlagService, featureFlagGuard } from './feature-flag.service';

/**
 * Coverage for FeatureFlagService — the client gate that decides which features users see.
 * Security-critical contract:
 *  - enabled:true → on; enabled:false / missing → off
 *  - a NETWORK ERROR resolves OFF (fail-safe — never open a gated feature on transport failure)
 *  - per-key cache dedups to one HTTP call; invalidate() forces a re-fetch
 *  - the route guard admits when on, redirects to /admin/feature-flags?disabled=<key> when off
 */
function setup(get: jasmine.Spy): { svc: FeatureFlagService; get: jasmine.Spy } {
  TestBed.configureTestingModule({
    providers: [
      FeatureFlagService,
      { provide: HttpClient, useValue: { get } },
    ],
  });
  return { svc: TestBed.inject(FeatureFlagService), get };
}

describe('FeatureFlagService (gate resolution + fail-safe)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('resolves ON when the flag is enabled', (done) => {
    const { svc } = setup(jasmine.createSpy('get').and.returnValue(of({ resolved: { enabled: true } })));
    svc.isOn('native_editor').subscribe((on) => { expect(on).toBe(true); done(); });
  });

  it('resolves OFF when disabled or the shape is missing', (done) => {
    const { svc } = setup(jasmine.createSpy('get').and.returnValue(of({ resolved: { enabled: false } })));
    svc.isOn('x').subscribe((on) => { expect(on).toBe(false); done(); });
  });

  it('FAILS SAFE — a network error resolves OFF (never opens a gated feature)', (done) => {
    const { svc } = setup(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    svc.isOn('x').subscribe((on) => { expect(on).toBe(false); done(); });
  });

  it('caches per key — concurrent isOn() calls dedup to one HTTP request', () => {
    const { svc, get } = setup(jasmine.createSpy('get').and.returnValue(of({ resolved: { enabled: true } })));
    svc.isOn('k').subscribe();
    svc.isOn('k').subscribe();
    expect(get.calls.count()).toBe(1);
  });

  it('invalidate(key) forces the next isOn() to re-fetch', () => {
    const { svc, get } = setup(jasmine.createSpy('get').and.returnValue(of({ resolved: { enabled: true } })));
    svc.isOn('k').subscribe();
    svc.invalidate('k');
    svc.isOn('k').subscribe();
    expect(get.calls.count()).toBe(2);
  });

  it('guard admits when the flag is on', fakeAsync(() => {
    setup(jasmine.createSpy('get').and.returnValue(of({ resolved: { enabled: true } })));
    let result: boolean | UrlTree | undefined;
    TestBed.runInInjectionContext(() => {
      (featureFlagGuard('k')(null as never, null as never) as { subscribe: (f: (v: boolean | UrlTree) => void) => void })
        .subscribe((v) => (result = v));
    });
    tick();
    expect(result).toBe(true);
  }));

  it('guard redirects to /admin/feature-flags?disabled=<key> when off', fakeAsync(() => {
    const tree = { __urlTree: true } as unknown as UrlTree;
    const createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue(tree);
    TestBed.configureTestingModule({
      providers: [
        FeatureFlagService,
        { provide: HttpClient, useValue: { get: jasmine.createSpy('get').and.returnValue(of({ resolved: { enabled: false } })) } },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });
    let result: boolean | UrlTree | undefined;
    TestBed.runInInjectionContext(() => {
      (featureFlagGuard('beta_x')(null as never, null as never) as { subscribe: (f: (v: boolean | UrlTree) => void) => void })
        .subscribe((v) => (result = v));
    });
    tick();
    expect(result).toBe(tree);
    expect(createUrlTree).toHaveBeenCalledWith(['/admin/feature-flags'], { queryParams: { disabled: 'beta_x' } });
  }));
});
