import { TestBed } from '@angular/core/testing';
import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { IdeComponent } from './ide.component';
import { ConfirmService } from '../../../../services/confirm.service';

/**
 * The preview tab binds `[src]="safeLiveUrl"` on an iframe. A plain string in an
 * iframe[src] (RESOURCE_URL context) is blocked by Angular's sanitizer (NG0904
 * console error), and trusting an unvalidated URL into a resource-URL context is
 * an injection risk — so `safeLiveUrl` host/scheme-validates the `liveUrl` Input
 * (https only) before wrapping it as a SafeResourceUrl.
 */
describe('IdeComponent (preview iframe src is a sanitized SafeResourceUrl)', () => {
  function make(): IdeComponent {
    TestBed.configureTestingModule({
      imports: [IdeComponent],
      providers: [{ provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } }],
    });
    // No detectChanges → Monaco/AfterViewInit never fire; we only read the getter.
    return TestBed.createComponent(IdeComponent).componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('wraps a well-formed https liveUrl as a SafeResourceUrl (not a raw string Angular blocks)', () => {
    const c = make();
    c.liveUrl = 'https://acme.projectsites.dev/api/ai/acme/hello';
    const safe = c.safeLiveUrl;
    expect(safe).withContext('a value is produced').not.toBeNull();
    expect(typeof safe).withContext('SafeResourceUrl is an object Angular trusts').not.toBe('string');
    expect(TestBed.inject(DomSanitizer).sanitize(SecurityContext.RESOURCE_URL, safe))
      .withContext('resolves back to the same https url').toContain('acme.projectsites.dev');
  });

  it('returns null for empty / non-https / malformed liveUrl (nothing untrusted loads in the iframe)', () => {
    const c = make();
    c.liveUrl = null;
    expect(c.safeLiveUrl).withContext('no url → null').toBeNull();
    c.liveUrl = 'http://acme.projectsites.dev/x';
    expect(c.safeLiveUrl).withContext('non-https rejected').toBeNull();
    c.liveUrl = 'javascript:alert(1)';
    expect(c.safeLiveUrl).withContext('javascript: rejected').toBeNull();
    c.liveUrl = 'not a url';
    expect(c.safeLiveUrl).withContext('malformed rejected').toBeNull();
  });
});
