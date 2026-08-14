import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DocsOverviewComponent } from './docs-overview.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { DocsSpecService } from '../docs.component';

/**
 * Locks the "Raw OpenAPI" action. The `/api/admin/docs/openapi.json` route is
 * BEARER-authed, so the old `<a target="_blank" href="/api/…">` opened a tab with no
 * Authorization header → 401 (a browser navigation can't carry the bearer). openRawSpec
 * must instead open a blank tab SYNCHRONOUSLY (popup-safe, inside the click gesture),
 * fetch the spec WITH auth (getBlobAbsolute), and point the tab at the blob URL.
 * See the `plain-navigation-cant-carry-bearer` project memory.
 */
function make(getBlobAbsolute: jasmine.Spy, toastError = jasmine.createSpy('error')): DocsOverviewComponent {
  TestBed.configureTestingModule({
    imports: [DocsOverviewComponent],
    providers: [
      { provide: ApiService, useValue: { getBlobAbsolute } },
      { provide: ToastService, useValue: { success: () => 0, error: toastError, info: () => 0 } },
      { provide: DocsSpecService, useValue: { operations: () => [], stats: () => null } },
    ],
  });
  TestBed.overrideComponent(DocsOverviewComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(DocsOverviewComponent).componentInstance;
}

describe('DocsOverviewComponent (authed OpenAPI spec — popup-safe)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens a tab synchronously, fetches the AUTHED spec with auth, then points the tab at the blob', () => {
    const getBlobAbsolute = jasmine.createSpy('getBlobAbsolute').and.returnValue(of(new Blob(['{}'], { type: 'application/json' })));
    const tab = { location: { href: '' }, close: jasmine.createSpy('close') };
    const openSpy = spyOn(window, 'open').and.returnValue(tab as unknown as Window);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:spec');

    make(getBlobAbsolute).openRawSpec();

    // Tab opened synchronously (before the async fetch) so it survives the popup blocker.
    expect(openSpy).withContext('blank tab opened in the click gesture').toHaveBeenCalledWith('', '_blank');
    // Fetched WITH auth from the AUTHED admin route — never a bare target=_blank that 401s.
    expect(getBlobAbsolute).toHaveBeenCalledWith('/api/admin/docs/openapi.json');
    expect(tab.location.href).withContext('tab navigated to the blob, not the /api path').toBe('blob:spec');
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('closes the blank tab + toasts on a fetch failure (never leaves a dead tab)', () => {
    const getBlobAbsolute = jasmine.createSpy('getBlobAbsolute').and.returnValue(throwError(() => ({ status: 401 })));
    const toastError = jasmine.createSpy('error');
    const tab = { location: { href: '' }, close: jasmine.createSpy('close') };
    spyOn(window, 'open').and.returnValue(tab as unknown as Window);

    make(getBlobAbsolute, toastError).openRawSpec();

    expect(tab.close).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
