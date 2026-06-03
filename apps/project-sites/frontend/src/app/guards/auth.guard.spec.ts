import { TestBed } from '@angular/core/testing';
import { Router, type UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

/**
 * Coverage for authGuard — the route protector on every admin/billing route. Security contract:
 *  - a logged-in session admits (true)
 *  - logged-out returns a UrlTree to /signin?returnUrl=<requested route> (atomic redirect, no
 *    flash-of-protected-content), carrying the originally-requested URL for post-signin handoff
 */
function run(opts: { loggedIn: boolean; url?: string }): boolean | UrlTree {
  const createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue({ __tree: true } as unknown as UrlTree);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { isLoggedIn: () => opts.loggedIn } },
      { provide: Router, useValue: { url: opts.url ?? '/admin', createUrlTree } },
    ],
  });
  return TestBed.runInInjectionContext(() => authGuard({} as never, {} as never)) as boolean | UrlTree;
}

describe('authGuard (route protection)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('admits a logged-in session', () => {
    expect(run({ loggedIn: true })).toBe(true);
  });

  it('redirects a logged-out request to /signin with the requested route as returnUrl', () => {
    const tree = { __tree: true } as unknown as UrlTree;
    const createUrlTree = jasmine.createSpy('createUrlTree').and.returnValue(tree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoggedIn: () => false } },
        { provide: Router, useValue: { url: '/admin/snapshots', createUrlTree } },
      ],
    });
    const result = TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));
    expect(result).toBe(tree); // a UrlTree, not boolean false (atomic redirect)
    expect(createUrlTree).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/admin/snapshots' } });
  });
});
