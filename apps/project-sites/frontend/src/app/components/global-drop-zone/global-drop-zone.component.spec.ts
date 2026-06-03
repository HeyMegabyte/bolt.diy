import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { GlobalDropZoneComponent } from './global-drop-zone.component';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/**
 * Upload resilience for the admin-shell drag-and-drop zone (LIVE, untested).
 * Each dropped file is POSTed independently; ONE failure must NOT abort the
 * batch, and the result toast must reflect the real outcome (all-success /
 * partial / all-fail) so the user knows exactly what landed. No navigation when
 * nothing succeeded. overrideComponent strips the template; uploadFiles() is
 * driven directly with controlled per-file results.
 */
interface ToastSpies {
  info: () => number;
  dismiss: jasmine.Spy;
  success: jasmine.Spy;
  warning: jasmine.Spy;
  error: jasmine.Spy;
}
function make(): { c: GlobalDropZoneComponent; post: jasmine.Spy; toast: ToastSpies; nav: jasmine.Spy } {
  const post = jasmine.createSpy('postFormData');
  const nav = jasmine.createSpy('navigate');
  const toast: ToastSpies = {
    info: () => 1,
    dismiss: jasmine.createSpy('dismiss'),
    success: jasmine.createSpy('success'),
    warning: jasmine.createSpy('warning'),
    error: jasmine.createSpy('error'),
  };
  TestBed.configureTestingModule({
    imports: [GlobalDropZoneComponent],
    providers: [
      { provide: ApiService, useValue: { postFormData: post } },
      { provide: ToastService, useValue: toast },
      { provide: Router, useValue: { url: '/admin/forms', navigate: nav } },
    ],
  });
  TestBed.overrideComponent(GlobalDropZoneComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(GlobalDropZoneComponent).componentInstance, post, toast, nav };
}
const upload = (c: GlobalDropZoneComponent, files: File[]): Promise<void> =>
  (c as unknown as { uploadFiles(f: File[]): Promise<void> }).uploadFiles(files);
const file = (name: string): File => new File(['x'], name, { type: 'text/plain' });

describe('GlobalDropZoneComponent (upload resilience)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('all uploads succeed → success toast + navigates to media', async () => {
    const { c, post, toast, nav } = make();
    post.and.returnValue(of({ data: {} }));
    await upload(c, [file('a.png'), file('b.png')]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(['/admin/media']);
  });

  it('one failure does NOT abort the batch — every file is still attempted, result is a partial warning', async () => {
    const { c, post, toast } = make();
    let n = 0;
    post.and.callFake(() => (n++ === 0 ? throwError(() => new Error('boom')) : of({ data: {} })));
    await upload(c, [file('a.png'), file('b.png')]);
    expect(post).withContext('the second file is still uploaded after the first fails').toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith('Uploaded 1, 1 failed');
  });

  it('all uploads fail → error toast and NO navigation (nothing landed)', async () => {
    const { c, post, toast, nav } = make();
    post.and.returnValue(throwError(() => new Error('boom')));
    await upload(c, [file('a.png')]);
    expect(toast.error).toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });
});
