import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminEmailComponent } from './email.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the email/submissions load-error gating (first coverage): a failed
 * listFormSubmissions used to be silent (error: () => loadingSubmissions.set(false))
 * → the empty list fell through to "No submissions yet". Now refreshSubmissions sets a
 * persistent submissionsError + Retry card; success/retry clear it. overrideComponent
 * strips the template; refreshSubmissions() is driven directly.
 */
function make(list: jasmine.Spy): AdminEmailComponent {
  TestBed.configureTestingModule({
    imports: [AdminEmailComponent],
    providers: [
      { provide: ApiService, useValue: { listFormSubmissions: list, get: () => of({ data: [] }), post: () => of({}) } },
      { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }), formatRelativeTime: () => 'now' } },
    ],
  });
  TestBed.overrideComponent(AdminEmailComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminEmailComponent).componentInstance;
}

describe('AdminEmailComponent (submissions load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates submissions and leaves submissionsError null', () => {
    const c = make(jasmine.createSpy('list').and.returnValue(of({ data: [{ id: 'm1' }] })));
    c.refreshSubmissions();
    expect(c.submissionsError()).toBeNull();
    expect(c.submissions().length).toBe(1);
    expect(c.loadingSubmissions()).toBe(false);
  });

  it('a load error sets a persistent submissionsError (not a fake empty)', () => {
    const c = make(jasmine.createSpy('list').and.returnValue(throwError(() => ({ status: 500 }))));
    c.refreshSubmissions();
    expect(c.submissionsError()).toContain('Could not load');
    expect(c.submissions().length).toBe(0);
    expect(c.loadingSubmissions()).toBe(false);
  });

  it('retry after an error clears the prior submissionsError', () => {
    const list = jasmine.createSpy('list').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = make(list);
    c.refreshSubmissions();
    expect(c.submissionsError()).not.toBeNull();
    c.refreshSubmissions();
    expect(c.submissionsError()).toBeNull();
  });
});

/**
 * webhook_url is sent to the worker for newsletter integrations that
 * `needsWebhookUrl` — the worker calls it server-side. The form only had
 * native type="url" (accepts http:// + internal hosts like localhost /
 * 169.254.x, and the programmatic submit path can bypass native validation).
 * submitConnect must reject a non-https / internal-host webhook BEFORE the POST
 * (SSRF-adjacent), matching the webhooks/recipes/social-RSS sweep.
 */
describe('AdminEmailComponent (webhook URL validation before connect)', () => {
  let createIntegration: jasmine.Spy;
  let error: jasmine.Spy;
  function build(): AdminEmailComponent {
    createIntegration = jasmine.createSpy('createIntegration').and.returnValue(of({ data: { provider: 'webhooky' } }));
    error = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminEmailComponent],
      providers: [
        { provide: ApiService, useValue: { createIntegration, listFormSubmissions: () => of({ data: [] }), get: () => of({ data: [] }), post: () => of({}) } },
        { provide: ToastService, useValue: { error, success: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }), formatRelativeTime: () => 'now' } },
      ],
    });
    TestBed.overrideComponent(AdminEmailComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminEmailComponent).componentInstance;
  }
  const webhookProvider = { id: 'webhooky', name: 'Webhooky', needsWebhookUrl: true } as never;
  afterEach(() => TestBed.resetTestingModule());

  it('rejects an http:// webhook (non-https) — no POST, useful error', () => {
    const c = build();
    c.connectingProvider.set(webhookProvider);
    c.apiKey = 'k'; c.webhookUrl = 'http://hooks.example.com/x';
    c.submitConnect(webhookProvider);
    expect(createIntegration).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('rejects an internal-host webhook (https://localhost) — SSRF-adjacent', () => {
    const c = build();
    c.connectingProvider.set(webhookProvider);
    c.apiKey = 'k'; c.webhookUrl = 'https://localhost/hook';
    c.submitConnect(webhookProvider);
    expect(createIntegration).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('accepts a well-formed https webhook — POSTs once', () => {
    const c = build();
    c.connectingProvider.set(webhookProvider);
    c.apiKey = 'k'; c.webhookUrl = 'https://hooks.example.com/projectsites';
    c.submitConnect(webhookProvider);
    expect(createIntegration).toHaveBeenCalledTimes(1);
  });

  it('a provider that needs no webhook connects with an empty webhookUrl', () => {
    const c = build();
    const plain = { id: 'mailchimp', name: 'Mailchimp', needsWebhookUrl: false } as never;
    c.connectingProvider.set(plain);
    c.apiKey = 'k'; c.webhookUrl = '';
    c.submitConnect(plain);
    expect(createIntegration).toHaveBeenCalledTimes(1);
  });
});
