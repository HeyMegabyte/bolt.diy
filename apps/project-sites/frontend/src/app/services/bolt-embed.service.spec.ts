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
