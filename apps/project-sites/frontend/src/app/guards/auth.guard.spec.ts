import { TestBed } from '@angular/core/testing';
import { Router, type UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

/**
 * Coverage for authGuard — the route protector on every admin/billing route. Security contract:
 *  - a logged-in session admits (true)
 *  - logged-out returns a UrlTree to /signin?returnUrl=<REQUESTED route>, carrying the
 *    originally-requested (target) URL — NOT router.url, which mid-navigation is still the
 *    previous page (the regression that bounced users to '/' after signin instead of '/admin').
 */
function run(opts: { loggedIn: boolean; targetUrl?: string; currentUrl?: string }): boolean | UrlTree {
  const createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue({ __tree: true } as unknown as UrlTree);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { isLoggedIn: () => opts.loggedIn } },
      { provide: Router, useValue: { url: opts.currentUrl ?? '/somewhere-else', createUrlTree } },
    ],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as never, { url: opts.targetUrl ?? '/admin' } as never),
  ) as boolean | UrlTree;
}

describe('authGuard (route protection)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('admits a logged-in session', () => {
    expect(run({ loggedIn: true })).toBe(true);
  });

  it('redirects a logged-out request to /signin carrying the requested route as returnUrl', () => {
    const tree = { __tree: true } as unknown as UrlTree;
    const createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue(tree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoggedIn: () => false } },
        { provide: Router, useValue: { url: '/', createUrlTree } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/admin/snapshots' } as never),
    );
    expect(result).toBe(tree); // a UrlTree, not boolean false (atomic redirect)
    expect(createUrlTree).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/admin/snapshots' } });
  });

  it('uses the TARGET url, not router.url (regression: /admin bounced to returnUrl=/ )', () => {
    const createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue({} as unknown as UrlTree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoggedIn: () => false } },
        // router.url is the PREVIOUS page mid-navigation — the guard must ignore it.
        { provide: Router, useValue: { url: '/', createUrlTree } },
      ],
    });
    TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/admin' } as never));
    expect(createUrlTree).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/admin' } });
  });
});
