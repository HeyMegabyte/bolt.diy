import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminSocialCampaignComponent } from './social-campaign.component';
import { ApiService } from '../../../services/api.service';

/**
 * Coverage for the AI campaign generator page (model section):
 *  - ngOnInit loads connected accounts (silent); failure degrades to []
 *  - canGenerate gates on business name + ≥1 account + not-already-running
 *  - generate() posts { spec, signals } with the right shape, stores the result
 *  - generate() is a no-op when the guard fails (no double-submit / empty brief)
 *  - a failed generate sets the error message + clears the busy flag
 *  - toggleAccount + prettyType helpers
 * overrideComponent strips the template; methods are driven directly.
 */
function make(get: jasmine.Spy, post: jasmine.Spy): AdminSocialCampaignComponent {
  TestBed.configureTestingModule({
    imports: [AdminSocialCampaignComponent],
    providers: [{ provide: ApiService, useValue: { get, post } }],
  });
  TestBed.overrideComponent(AdminSocialCampaignComponent, {
    set: { template: '<div></div>', imports: [] },
  });
  return TestBed.createComponent(AdminSocialCampaignComponent).componentInstance;
}

const okPost = () =>
  jasmine
    .createSpy('post')
    .and.returnValue(of({ data: { length: 30, slot_count: 17, drafts_created: 17, drafts: [] } }));

describe('AdminSocialCampaignComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads connected accounts on init', () => {
    const get = jasmine
      .createSpy('get')
      .and.returnValue(of({ data: [{ id: 'a1', platform: 'facebook', handle: '@v' }] }));
    const c = make(get, okPost());
    c.ngOnInit();
    expect(get).toHaveBeenCalledWith('/social/accounts', undefined, { silent: true });
    expect(c.accounts().length).toBe(1);
    expect(c.loadingAccounts()).toBe(false);
  });

  it('degrades to an empty account list when the load fails', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const c = make(get, okPost());
    c.ngOnInit();
    expect(c.accounts()).toEqual([]);
    expect(c.loadingAccounts()).toBe(false);
  });

  it('gates generation on a business name AND a selected account', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })), okPost());
    expect(c.canGenerate()).toBe(false);
    c.businessName.set('Vito Salon');
    expect(c.canGenerate()).toBe(false); // still no account
    c.toggleAccount('a1');
    expect(c.canGenerate()).toBe(true);
  });

  it('posts a well-formed { spec, signals } body and stores the result', () => {
    const post = okPost();
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })), post);
    c.businessName.set('Vito Salon');
    c.servicesText.set('Haircut, Beard Trim');
    c.length.set(30);
    c.postsPerWeek.set(4);
    c.toggleAccount('a1');
    c.generate();

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.calls.mostRecent().args as [string, { spec: Record<string, unknown>; signals: Record<string, unknown> }];
    expect(path).toBe('/social/campaign');
    expect(body.spec['length']).toBe(30);
    expect(body.spec['account_ids']).toEqual(['a1']);
    expect(body.signals['business_name']).toBe('Vito Salon');
    expect(body.signals['services']).toEqual(['Haircut', 'Beard Trim']);
    expect(c.result()?.drafts_created).toBe(17);
    expect(c.generating()).toBe(false);
  });

  it('is a no-op when the guard fails (empty brief — no double-submit)', () => {
    const post = okPost();
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })), post);
    c.generate(); // no business name, no account
    expect(post).not.toHaveBeenCalled();
  });

  it('sets the error message and clears busy when generation fails', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 502 })));
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })), post);
    c.businessName.set('Vito Salon');
    c.toggleAccount('a1');
    c.generate();
    expect(c.error()).toContain('Could not generate');
    expect(c.generating()).toBe(false);
  });

  it('toggleAccount adds then removes; prettyType humanises archetypes', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })), okPost());
    c.toggleAccount('a1');
    expect(c.selected().has('a1')).toBe(true);
    c.toggleAccount('a1');
    expect(c.selected().has('a1')).toBe(false);
    expect(c.prettyType('service_spotlight')).toBe('Service Spotlight');
  });

  it('pre-fills the brief from the prefill endpoint on init', () => {
    const get = jasmine
      .createSpy('get')
      .and.callFake((path: string) =>
        path.includes('prefill')
          ? of({ data: { business_name: 'Acme Co', area_name: 'Newark' } })
          : of({ data: [] }),
      );
    const c = make(get, okPost());
    c.ngOnInit();
    expect(c.businessName()).toBe('Acme Co');
    expect(c.areaName()).toBe('Newark');
  });

  it('prefill never overwrites a value the user already typed', () => {
    const get = jasmine
      .createSpy('get')
      .and.callFake((path: string) =>
        path.includes('prefill') ? of({ data: { business_name: 'Acme Co' } }) : of({ data: [] }),
      );
    const c = make(get, okPost());
    c.businessName.set('My Custom Name');
    c.ngOnInit();
    expect(c.businessName()).toBe('My Custom Name');
  });
});
