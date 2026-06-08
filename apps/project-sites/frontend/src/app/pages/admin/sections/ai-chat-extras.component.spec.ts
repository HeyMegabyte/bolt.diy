import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AiChatExtrasComponent } from './ai-chat-extras.component';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';

/**
 * WCAG 4.1.2 — the Drive folder-picker modal's filter <input> had only a
 * placeholder ("Filter folders…") and no accessible name (not wrapped in a
 * <label>, no aria-label). Placeholder text is NOT an accessible name, so a
 * screen-reader user heard nothing. Added aria-label="Filter folders".
 */
describe('AiChatExtrasComponent (folder-filter accessible name)', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [AiChatExtrasComponent],
      providers: [
        // The constructor effect() fires refresh(id) once siteId is set, which
        // hits GET /ai-settings + GET /ai/context/files. `get` returns
        // `{ data: [] }` so files() stays an array — `{ data: {} }` would make
        // files() a non-array and crash the `@for (f of files())` block.
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: [] }), put: () => of({}), delete: () => of({}) } },
        { provide: AuthService, useValue: { getToken: () => null } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
      ],
    });
    const fx = TestBed.createComponent(AiChatExtrasComponent);
    // A site must be selected for the modal-bearing section to render at all
    // (template is wrapped in `@if (siteId(); as sid)`).
    fx.componentRef.setInput('siteId', 's1');
    fx.detectChanges();
    return fx;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('the folder-filter input exists and carries aria-label="Filter folders" when the picker is open', () => {
    const fx = render();
    fx.componentInstance.folderPickerOpen.set(true);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[placeholder="Filter folders…"]');
    expect(input).withContext('the folder-filter input renders inside the open picker').not.toBeNull();
    expect(input!.getAttribute('aria-label')).toBe('Filter folders');
  });
});
