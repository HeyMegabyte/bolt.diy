import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AdminDocsComponent, type OpenApiSpec } from './docs.component';
import { ApiService } from '../../../services/api.service';

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
      providers: [provideRouter([]), { provide: ApiService, useValue: { get } }],
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

  it('marks the Overview tab with aria-current="page" when active', () => {
    const tab = q('[data-testid="docs-overview-link"]') as HTMLAnchorElement | null;
    expect(tab).not.toBeNull();
    // RouterLink resolves `/admin/docs` as the active default route in the test harness.
    expect(tab?.getAttribute('aria-current')).toBe('page');
  });

  it('ships the animated center-out cyan tab underline element', () => {
    expect(q('.docs-tab .docs-tab-underline')).not.toBeNull();
  });

  it('keeps the docs accent bound to the --ps-accent brand token (no raw cyan literal)', () => {
    const styles = host.querySelectorAll('style');
    const css = Array.from(styles)
      .map((s) => s.textContent ?? '')
      .join('\n');
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
