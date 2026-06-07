import { TestBed } from '@angular/core/testing';
import { Router, type UrlTree } from '@angular/router';
import { sysAdminGuard } from './sys-admin.guard';
import { AuthService } from '../services/auth.service';

/**
 * Coverage for sysAdminGuard — the gate on LAYER 1 (System Administrator /
 * platform-ops feature flags). Contract:
 *  - a sys-admin identity admits (true)
 *  - any other signed-in owner is redirected to /admin/site-features (their own
 *    owner-facing Features layer) via a UrlTree (atomic, no content flash)
 */
function run(email: string): boolean | UrlTree {
  const tree = { __tree: '/admin/site-features' } as unknown as UrlTree;
  const parseUrl = jasmine.createSpy('parseUrl').and.returnValue(tree);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { email: () => email } },
      { provide: Router, useValue: { parseUrl } },
    ],
  });
  return TestBed.runInInjectionContext(() => sysAdminGuard({} as never, {} as never)) as boolean | UrlTree;
}

describe('sysAdminGuard (System Administrator layer protection)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('admits the platform operator brian@megabyte.space', () => {
    expect(run('brian@megabyte.space')).toBe(true);
  });

  it('admits the alternate operator identity hey@megabyte.space', () => {
    expect(run('hey@megabyte.space')).toBe(true);
  });

  it('redirects a normal site owner to /admin/site-features', () => {
    const parseUrl = jasmine.createSpy('parseUrl').and.returnValue({ __tree: true } as unknown as UrlTree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { email: () => 'owner@acme.com' } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
    const result = TestBed.runInInjectionContext(() => sysAdminGuard({} as never, {} as never));
    expect(parseUrl).toHaveBeenCalledWith('/admin/site-features');
    expect(result).not.toBe(true);
  });

  it('redirects an empty / signed-out identity (defense in depth)', () => {
    const parseUrl = jasmine.createSpy('parseUrl').and.returnValue({ __tree: true } as unknown as UrlTree);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { email: () => '' } },
        { provide: Router, useValue: { parseUrl } },
      ],
    });
    TestBed.runInInjectionContext(() => sysAdminGuard({} as never, {} as never));
    expect(parseUrl).toHaveBeenCalledWith('/admin/site-features');
  });
});
