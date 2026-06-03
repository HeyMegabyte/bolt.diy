import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { DomSanitizer } from '@angular/platform-browser';
import { BoltEmbedService } from './bolt-embed.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { SentryService } from './sentry.service';

/**
 * Security boundary for the bolt.diy iframe bridge: BoltEmbedService listens for
 * postMessage events from the embedded editor, but MUST only act on messages from
 * the trusted origins (editor.projectsites.dev / localhost:5173) — a message from
 * any other origin is a cross-frame injection vector (it could trigger uploads,
 * deploys, or veil-dismissal). It also only honors the `PS_`-prefixed protocol.
 * loadingStage() is the observable proxy for "the handler acted".
 */
type Testable = {
  attachMessageListener(): void;
  messageHandler: (e: MessageEvent) => void;
  loadingStage(): string;
};

function setup(): { svc: Testable; fire: (origin: string, data: unknown) => void; error: jasmine.Spy } {
  const error = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    providers: [
      BoltEmbedService,
      { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (u: string) => u } },
      { provide: ApiService, useValue: { get: () => of({}), post: () => of({}) } },
      { provide: ToastService, useValue: { toasts: signal([]), error, success: jasmine.createSpy('success') } },
      { provide: SentryService, useValue: { captureException: () => undefined, addBreadcrumb: () => undefined, captureMessage: () => undefined } },
    ],
  });
  const svc = TestBed.inject(BoltEmbedService) as unknown as Testable;
  svc.attachMessageListener();
  const fire = (origin: string, data: unknown): void => svc.messageHandler(new MessageEvent('message', { origin, data }));
  return { svc, fire, error };
}

describe('BoltEmbedService (postMessage origin security)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('IGNORES a PS_BOLT_READY from a disallowed origin (cross-frame injection guard)', () => {
    const { svc, fire } = setup();
    const before = svc.loadingStage();
    fire('https://evil.example.com', { type: 'PS_BOLT_READY' });
    expect(svc.loadingStage()).toBe(before); // untrusted origin → handler no-ops
  });

  it('PROCESSES a PS_BOLT_READY from the trusted editor origin', () => {
    const { svc, fire } = setup();
    fire('https://editor.projectsites.dev', { type: 'PS_BOLT_READY' });
    expect(svc.loadingStage()).toBe('Running Start Application');
  });

  it('also trusts the localhost:5173 dev origin', () => {
    const { svc, fire } = setup();
    fire('http://localhost:5173', { type: 'PS_BOLT_READY' });
    expect(svc.loadingStage()).toBe('Running Start Application');
  });

  it('ignores a non-PS_ message even from a trusted origin', () => {
    const { svc, fire } = setup();
    const before = svc.loadingStage();
    fire('https://editor.projectsites.dev', { type: 'EVIL_INJECT' });
    expect(svc.loadingStage()).toBe(before);
  });

  it('ignores a null / malformed payload from a trusted origin', () => {
    const { svc, fire } = setup();
    const before = svc.loadingStage();
    fire('https://editor.projectsites.dev', null);
    expect(svc.loadingStage()).toBe(before);
  });

  it('surfaces a trusted-origin PS_ERROR as a toast', () => {
    const { fire, error } = setup();
    fire('https://editor.projectsites.dev', { type: 'PS_ERROR', message: 'boom' });
    expect(error).toHaveBeenCalled();
  });

  it('does NOT surface a PS_ERROR from an untrusted origin', () => {
    const { fire, error } = setup();
    fire('https://evil.example.com', { type: 'PS_ERROR', message: 'boom' });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('BoltEmbedService — importChatFrom gating (publish-aware, no 404 console noise)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function bootSvc(): { bootForSite: (s: unknown) => void; iframeUrl: () => unknown } {
    TestBed.configureTestingModule({
      providers: [
        BoltEmbedService,
        { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (u: string) => u } },
        { provide: ApiService, useValue: { get: () => of({}), post: () => of({}) } },
        { provide: ToastService, useValue: { toasts: signal([]), error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: SentryService, useValue: { captureException: () => undefined, addBreadcrumb: () => undefined, captureMessage: () => undefined } },
      ],
    });
    return TestBed.inject(BoltEmbedService) as unknown as { bootForSite: (s: unknown) => void; iframeUrl: () => unknown };
  }

  it('sets importChatFrom for a PUBLISHED site (warm chat/version import)', () => {
    const svc = bootSvc();
    svc.bootForSite({ id: 's1', slug: 'live-site', business_name: 'Live', status: 'published' });
    const url = String(svc.iframeUrl() ?? '');
    expect(url).toContain('importChatFrom=');
    expect(url).toContain('live-site');
  });

  it('OMITS importChatFrom for an UNPUBLISHED site (no R2 manifest → would 404 on every admin route)', () => {
    const svc = bootSvc();
    svc.bootForSite({ id: 's2', slug: 'draft-site', business_name: 'Draft', status: 'draft' });
    const url = String(svc.iframeUrl() ?? '');
    expect(url).not.toContain('importChatFrom');
    expect(url).withContext('still boots the editor for the draft site').toContain('draft-site');
  });
});

/**
 * Veil-dismiss → editorReady. The editor shows a cinematic loading veil until
 * the iframe signals it's interactive; if that transition regressed, users would
 * stare at a permanent veil (a broken editor). Locks the dismiss paths AND the
 * security boundary: an UNTRUSTED origin must never force the veil away.
 */
describe('BoltEmbedService (veil dismiss → editorReady)', () => {
  afterEach(() => TestBed.resetTestingModule());
  const ready = (svc: unknown): boolean => (svc as { editorReady(): boolean }).editorReady();
  const TRUSTED = 'https://editor.projectsites.dev';

  it('editorReady starts false (veil shown) and PS_APP_RUNNING from the trusted editor dismisses it', () => {
    const { svc, fire } = setup();
    expect(ready(svc)).withContext('veil shown until the iframe is interactive').toBeFalse();
    fire(TRUSTED, { type: 'PS_APP_RUNNING' });
    expect(ready(svc)).toBeTrue();
  });

  it('PS_BOLT_CHAT_READY (chat placeholder painted) dismisses the veil', () => {
    const { svc, fire } = setup();
    fire(TRUSTED, { type: 'PS_BOLT_CHAT_READY' });
    expect(ready(svc)).toBeTrue();
  });

  it('PS_GENERATION_STATUS preview_ready dismisses the veil', () => {
    const { svc, fire } = setup();
    fire(TRUSTED, { type: 'PS_GENERATION_STATUS', status: 'preview_ready' });
    expect(ready(svc)).toBeTrue();
  });

  it('a veil-dismiss message from an UNTRUSTED origin must NOT force the editor ready (injection guard)', () => {
    const { svc, fire } = setup();
    fire('https://evil.example.com', { type: 'PS_APP_RUNNING' });
    expect(ready(svc)).withContext('an untrusted frame cannot dismiss the veil').toBeFalse();
  });
});
