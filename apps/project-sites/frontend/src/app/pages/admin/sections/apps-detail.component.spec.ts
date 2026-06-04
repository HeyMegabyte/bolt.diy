import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { AppDetailComponent } from './apps-detail.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * First coverage for the app-deploy detail (subdomain input validation — untested):
 *  - subdomainError messages (required / min / max / charset / dash edges) + untouched=null
 *  - canDeploy gate mirrors the validity rules
 *  - deploy() is guarded (invalid subdomain → no POST) and on success navigates to the instance
 * overrideComponent strips the template; validation is driven via the public onSubdomainChange.
 */
function make(
  post = jasmine.createSpy('post').and.returnValue(of({ instance_id: 'inst-1' })),
  appId = '',
): {
  c: AppDetailComponent;
  nav: jasmine.Spy;
  post: jasmine.Spy;
  toast: { success: jasmine.Spy; error: jasmine.Spy };
} {
  const nav = jasmine.createSpy('navigate');
  const toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  TestBed.configureTestingModule({
    imports: [AppDetailComponent],
    providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => appId } } } },
      { provide: Router, useValue: { navigate: nav } },
      { provide: ApiService, useValue: { post } },
      { provide: ToastService, useValue: toast },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1', slug: 'demo' }) } },
    ],
  });
  TestBed.overrideComponent(AppDetailComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AppDetailComponent).componentInstance, nav, post, toast };
}

describe('AppDetailComponent (subdomain validation + deploy guard)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('subdomainError is null until the field is touched', () => {
    const { c } = make();
    expect(c.subdomainError()).toBeNull();
  });

  it('rejects too-short, over-long, bad-charset, and dash-edge subdomains', () => {
    const { c } = make();
    c.onSubdomainChange('ab');
    expect(c.subdomainError()).toBe('Min 3 characters.');
    c.onSubdomainChange('a'.repeat(41));
    expect(c.subdomainError()).toBe('Max 40 characters.');
    c.onSubdomainChange('My_App');
    expect(c.subdomainError()).toBe('Lowercase letters, digits, and dashes only.');
    c.onSubdomainChange('-lead');
    expect(c.subdomainError()).toBe('Cannot start or end with a dash.');
    c.onSubdomainChange('');
    expect(c.subdomainError()).toBe('Subdomain is required.');
  });

  it('accepts a valid subdomain (no error, canDeploy true)', () => {
    const { c } = make();
    c.onSubdomainChange('my-cool-app');
    expect(c.subdomainError()).toBeNull();
    expect(c.canDeploy()).toBe(true);
  });

  it('deploy() is a no-op when the subdomain is invalid (no POST)', () => {
    const { c, post } = make();
    c.onSubdomainChange('x'); // invalid
    c.subdomain = 'x';
    c.deploy({ id: 'medusa', name: 'Medusa' } as never);
    expect(post).not.toHaveBeenCalled();
  });

  it('deploy() posts and routes to the new instance on success', () => {
    const { c, post, nav, toast } = make();
    c.onSubdomainChange('my-cool-app');
    c.subdomain = 'my-cool-app';
    c.deploy({ id: 'umami', name: 'Umami' } as never); // supported (Live) app
    expect(post).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(['/admin/apps/instances', 'inst-1']);
    expect(c.deploying()).toBe(false);
  });

  it('deploy() clears the deploying flag on error', () => {
    const { c } = make(jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 }))));
    c.onSubdomainChange('my-cool-app');
    c.subdomain = 'my-cool-app';
    c.deploy({ id: 'umami', name: 'Umami' } as never);
    expect(c.deploying()).toBe(false);
  });

  // A "Soon" (catalog-placeholder) app must NOT be deployable — its runtime
  // container ships in a future drop, so a POST would be a doomed dead action.
  it('deploy() is a no-op for an unsupported (Soon) app even with a valid subdomain', () => {
    const { c, post } = make();
    c.onSubdomainChange('valid-subdomain');
    c.subdomain = 'valid-subdomain';
    c.deploy({ id: 'matomo', name: 'Matomo' } as never); // not in SUPPORTED_APP_SLUGS
    expect(post).not.toHaveBeenCalled();
  });

  it('supported() reflects the loaded catalog app (Live=true, Soon=false)', () => {
    const live = make(undefined, 'umami').c;
    live.ngOnInit();
    expect(live.supported()).toBeTrue();
    TestBed.resetTestingModule();
    const soon = make(undefined, 'matomo').c;
    soon.ngOnInit();
    expect(soon.supported()).toBeFalse();
  });
});
