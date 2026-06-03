import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminAcceptInviteComponent } from './accept-invite.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * First coverage for the team-invite acceptance flow (security-relevant auth, untested):
 *  - missing ?token → error state, helpful message, no POST fired
 *  - accept success → success state + role toast + delayed redirect to /admin
 *  - accept error → error state with the server message
 *  - goAdmin navigates
 * overrideComponent strips the template; ngOnInit() is driven directly per token stub.
 */
function make(token: string | null, post: jasmine.Spy): {
  c: AdminAcceptInviteComponent;
  nav: jasmine.Spy;
  post: jasmine.Spy;
  toast: { success: jasmine.Spy; error: jasmine.Spy };
} {
  const nav = jasmine.createSpy('navigateByUrl');
  const toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  TestBed.configureTestingModule({
    imports: [AdminAcceptInviteComponent],
    providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => token } } } },
      { provide: Router, useValue: { navigateByUrl: nav } },
      { provide: ApiService, useValue: { post } },
      { provide: ToastService, useValue: toast },
    ],
  });
  TestBed.overrideComponent(AdminAcceptInviteComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminAcceptInviteComponent).componentInstance, nav, post, toast };
}

describe('AdminAcceptInviteComponent (invite acceptance flow)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('errors with a helpful message and fires no request when the token is missing', () => {
    const post = jasmine.createSpy('post');
    const { c } = make(null, post);
    c.ngOnInit();
    expect(c.state()).toBe('error');
    expect(c.message()).toContain('Missing token');
    expect(post).not.toHaveBeenCalled();
  });

  it('on success moves to the success state, toasts the role, and redirects to /admin', fakeAsync(() => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { joined: true, role: 'editor' } }));
    const { c, nav, toast } = make('tok-123', post);
    c.ngOnInit();
    expect(c.state()).toBe('success');
    expect(toast.success).toHaveBeenCalledWith('Joined as editor');
    expect(nav).not.toHaveBeenCalled(); // redirect is delayed
    tick(1200);
    expect(nav).toHaveBeenCalledWith('/admin');
  }));

  it('surfaces the server message on an accept error', () => {
    const post = jasmine.createSpy('post').and.returnValue(
      throwError(() => ({ error: { error: { message: 'Invite already used' } } })),
    );
    const { c } = make('tok-123', post);
    c.ngOnInit();
    expect(c.state()).toBe('error');
    expect(c.message()).toBe('Invite already used');
  });

  it('falls back to a generic message when the error has no detail', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 })));
    const { c } = make('tok-123', post);
    c.ngOnInit();
    expect(c.state()).toBe('error');
    expect(c.message()).toBe('Invite could not be accepted.');
  });

  it('goAdmin navigates to the dashboard', () => {
    const { c, nav } = make('tok-123', jasmine.createSpy('post').and.returnValue(of({ data: {} })));
    c.goAdmin();
    expect(nav).toHaveBeenCalledWith('/admin');
  });
});
