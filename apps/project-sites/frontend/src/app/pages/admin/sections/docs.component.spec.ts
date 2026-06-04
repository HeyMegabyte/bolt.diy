import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminDocsComponent, renderMarkdown, type OpenApiSpec } from './docs.component';
import { ApiService } from '../../../services/api.service';

/**
 * renderMarkdown is a third custom markdown→HTML renderer (used by the live
 * docs-overview + endpoint descriptions fetched from /admin/docs/openapi.json).
 * Its link rule inserted the href RAW → a javascript:/data: URL became a
 * clickable DOM-XSS, and a " in the href broke out of the attribute (escapeHtml
 * only neutralizes & < >). Hardened to scheme-allowlist + quote-escape, matching
 * the agent-message + miniMarkdown renderers.
 */
describe('renderMarkdown — link XSS hardening', () => {
  it('neutralizes a javascript: link (no executable href; label kept as text)', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('click');
  });

  it('neutralizes a data: link', () => {
    expect(renderMarkdown('[x](data:text/html,hi)')).not.toContain('href="data:');
  });

  it('keeps safe https / mailto / relative links', () => {
    expect(renderMarkdown('[site](https://example.com)')).toContain('href="https://example.com"');
    expect(renderMarkdown('[mail](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
    expect(renderMarkdown('[rel](/admin/sites)')).toContain('href="/admin/sites"');
  });

  it('escapes a double-quote in the href so it cannot break out of the attribute', () => {
    const html = renderMarkdown('[x](https://e.com" onmouseover="alert(1))');
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;');
  });
});

/** Collect CSS from BOTH injected <style> tags and constructable/adopted
 *  stylesheets — Angular may use either depending on view-encapsulation mode,
 *  so scoping to the host element (or only <style> tags) misses the component CSS. */
function collectAllCss(): string {
  let css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
  for (const sheet of Array.from(document.adoptedStyleSheets ?? [])) {
    try {
      css += '\n' + Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
    } catch {
      /* cross-origin / inaccessible sheet — skip */
    }
  }
  return css;
}

/**
 * Convergence r7 — locks the docs shell's cyan/black cohesion + a11y contract:
 * the endpoint count rolls (`<app-rolling-counter>`), the header + explorer
 * reveal-animate (`appReveal`), the Overview tab carries `aria-current` when
 * active + an animated center-out underline, and no raw cyan hex leaks into the
 * private `--docs-primary` token (it must inherit `--ps-accent`).
 */
describe('AdminDocsComponent (cohesion r7)', () => {
  let fixture: ComponentFixture<AdminDocsComponent>;
  let host: HTMLElement;

  const SPEC: OpenApiSpec = {
    openapi: '3.1.0',
    info: { title: 'Project Sites API', version: '1.0.0' },
    paths: {
      '/api/auth/me': {
        get: { summary: 'Current user', tags: ['auth'], operationId: 'get_api_auth_me', security: [{ bearerAuth: [] }] },
      },
      '/api/sites': {
        get: { summary: 'List sites', tags: ['sites'], operationId: 'get_api_sites', security: [{ bearerAuth: [] }] },
      },
    },
  };

  beforeEach(() => {
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      path.includes('openapi.json') ? of(SPEC) : of({ data: null }),
    );
    TestBed.configureTestingModule({
      imports: [AdminDocsComponent],
      // A catch-all route so navigateByUrl('/admin/docs') resolves and the
      // Overview tab's routerLinkActive (exact) can activate.
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: ApiService, useValue: { get } }],
    });
    fixture = TestBed.createComponent(AdminDocsComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);

  it('rolls the endpoint count through <app-rolling-counter>', () => {
    const counter = q('.docs-count-chip app-rolling-counter');
    expect(counter).withContext('endpoint count must use the rolling counter').not.toBeNull();
  });

  it('reveal-animates the header and explorer (appReveal)', () => {
    // appReveal is an attribute directive — assert the hosts carry the attribute.
    expect(q('header.docs-header')?.hasAttribute('appReveal')).toBeTrue();
    expect(q('.docs-explorer')?.hasAttribute('appReveal')).toBeTrue();
  });

  it('marks the Overview tab with aria-current="page" when active', async () => {
    // Activate the route so routerLinkActive (exact) + ariaCurrentWhenActive fire.
    await TestBed.inject(Router).navigateByUrl('/admin/docs');
    fixture.detectChanges();
    const tab = q('[data-testid="docs-overview-link"]') as HTMLAnchorElement | null;
    expect(tab).not.toBeNull();
    expect(tab?.getAttribute('aria-current')).toBe('page');
  });

  it('ships the animated center-out cyan tab underline element', () => {
    expect(q('.docs-tab .docs-tab-underline')).not.toBeNull();
  });

  it('keeps the docs accent bound to the --ps-accent brand token (no raw cyan literal)', () => {
    const css = collectAllCss();
    expect(css).toContain('--docs-primary: var(--ps-accent');
    // The title gradient + glyph must not hard-code the cyan hex.
    expect(css).not.toContain('#00E5FF 65%');
  });

  it('groups + lists every operation in the left rail', () => {
    fixture.detectChanges();
    expect(host.querySelectorAll('.endpoint-row').length).toBe(2);
    const authRow = q('[data-testid="docs-nav-endpoint-get_api_auth_me"]');
    expect(authRow?.getAttribute('aria-current')).withContext('inactive rows have no aria-current').toBeNull();
  });
});
