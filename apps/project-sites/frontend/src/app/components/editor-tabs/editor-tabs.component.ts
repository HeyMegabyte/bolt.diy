/**
 * @module components/editor-tabs
 *
 * @description
 * Slim horizontal tab strip rendered ABOVE the persistent bolt.diy iframe
 * when the user is on `/admin/editor`. Four tabs: Code · Preview · Media ·
 * Agents.
 *
 * - **Code** + **Preview** delegate to bolt's internal view by posting a
 *   `PS_EDITOR_VIEW` message into the iframe's `contentWindow`.
 * - **Media** + **Agents** emit `tabChange` so the admin shell can mount
 *   half-screen overlay panels (`<app-admin-media>` / `<app-admin-ai-endpoints>`)
 *   in front of the iframe without unmounting it.
 *
 * Active tab persists to `localStorage['editor.tab']`. Default = `code`.
 *
 * @example
 * ```html
 * <app-editor-tabs (tabChange)="onEditorTabChange($event)" />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  signal,
  type OnInit,
} from '@angular/core';

/** Discriminator for the four editor tabs. */
export type EditorTab = 'code' | 'preview' | 'media' | 'agents';

/** Persisted localStorage key for the active editor tab. */
const STORAGE_KEY = 'editor.tab';

/** Allow-list origin the bolt iframe is loaded from. */
const BOLT_ORIGIN = 'https://editor.projectsites.dev';

/** Static tab definition rendered into the strip. */
interface TabDef {
  readonly id: EditorTab;
  readonly label: string;
  /** Short ARIA hint surfaced to screen readers. */
  readonly aria: string;
}

@Component({
  selector: 'app-editor-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  styleUrl: './editor-tabs.component.scss',
  template: `
    <nav
      class="et-strip"
      role="tablist"
      aria-label="Editor view selector"
      data-testid="editor-tabs"
    >
      @for (t of tabs; track t.id) {
        <button
          type="button"
          role="tab"
          class="et-tab"
          [class.is-active]="activeTab() === t.id"
          [attr.aria-selected]="activeTab() === t.id"
          [attr.aria-label]="t.aria"
          [attr.tabindex]="activeTab() === t.id ? 0 : -1"
          [attr.data-testid]="'editor-tab-' + t.id"
          (click)="selectTab(t.id)"
          (keydown)="onKeydown($event, t.id)"
        >
          <span class="et-tab__icon" aria-hidden="true">
            @switch (t.id) {
              @case ('code') {
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              }
              @case ('preview') {
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              }
              @case ('media') {
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <circle cx="8.5" cy="11.5" r="1.5" />
                  <polyline points="21 16 16 11 5 22" />
                </svg>
              }
              @case ('agents') {
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="8" r="3" />
                  <path d="M5 21a7 7 0 0 1 14 0" />
                  <path d="M12 11v3" />
                </svg>
              }
            }
          </span>
          <span class="et-tab__label">{{ t.label }}</span>
        </button>
      }
    </nav>
  `,
})
export class EditorTabsComponent implements OnInit {
  /**
   * Fires whenever the user selects a tab. Parents react by mounting/
   * unmounting overlay panels (Media / Agents) or letting the bolt iframe
   * render the requested view (Code / Preview).
   */
  @Output() readonly tabChange = new EventEmitter<EditorTab>();

  /** Currently-selected tab. Mirrors `localStorage['editor.tab']`. */
  readonly activeTab = signal<EditorTab>('code');

  /** Tab definitions rendered in document order. */
  readonly tabs: readonly TabDef[] = [
    { id: 'code', label: 'Code', aria: 'Show bolt code editor' },
    { id: 'preview', label: 'Preview', aria: 'Show live preview' },
    { id: 'media', label: 'Media', aria: 'Open media library overlay' },
    { id: 'agents', label: 'Agents', aria: 'Open AI agents overlay' },
  ];

  /** Restore the previously-selected tab from localStorage on first paint. */
  ngOnInit(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as EditorTab | null;
      if (saved && this.isValidTab(saved)) {
        this.activeTab.set(saved);
      }
    } catch {
      /* localStorage unavailable (private mode / quota) — keep default. */
    }
    // Re-broadcast the restored tab on mount so the shell mirrors it
    // (e.g. re-opens the Media overlay after a reload). For code/preview
    // we ALSO push the view into the iframe so bolt renders the right pane.
    this.dispatch(this.activeTab(), /* fromInit */ true);
  }

  /**
   * Select a tab. Persists to localStorage, emits `tabChange`, and (for
   * `code`/`preview`) pushes a `PS_EDITOR_VIEW` postMessage into the bolt
   * iframe. No-op when the tab is already active.
   */
  selectTab(id: EditorTab): void {
    if (this.activeTab() === id) {
      // Re-fire the iframe view message for code/preview so a user clicking
      // the active tab can force bolt back into that view (handy when the
      // user just closed an in-iframe modal).
      this.dispatch(id, /* fromInit */ false);
      return;
    }
    this.activeTab.set(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore — non-fatal */
    }
    this.dispatch(id, /* fromInit */ false);
  }

  /**
   * Reset the active tab back to `code`. Used by the overlay close button
   * (X) so closing the Media / Agents overlay returns the user to the
   * underlying bolt iframe in code view.
   */
  resetToCode(): void {
    this.selectTab('code');
  }

  /**
   * Arrow-key navigation across the tab strip per WAI-ARIA Authoring
   * Practices for `role="tablist"`. Left/Right cycle, Home/End jump to
   * extremes, Enter/Space activate (no-op since `(click)` already fires).
   */
  onKeydown(ev: KeyboardEvent, current: EditorTab): void {
    const idx = this.tabs.findIndex((t) => t.id === current);
    if (idx < 0) return;
    let next = idx;
    switch (ev.key) {
      case 'ArrowRight':
        next = (idx + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
        next = (idx - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }
    ev.preventDefault();
    const target = this.tabs[next];
    if (!target) return;
    this.selectTab(target.id);
    // Move keyboard focus to the newly-active tab so AT stays in sync.
    queueMicrotask(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        `[data-testid="editor-tab-${target.id}"]`,
      );
      btn?.focus({ preventScroll: true });
    });
  }

  /**
   * Push the selection to subscribers + the bolt iframe.
   *
   * For `code` / `preview`: posts `{ type: 'PS_EDITOR_VIEW', view }` to the
   * iframe's `contentWindow` so bolt swaps its internal pane. The iframe
   * lives in the admin shell — we grab it via the `BoltEmbedService`.
   *
   * For `media` / `agents`: no iframe message — the admin shell renders an
   * Angular overlay component on top.
   *
   * `fromInit` is true for the boot-time broadcast and prevents firing
   * `tabChange` when the persisted tab is `media` / `agents` (we DO want to
   * re-open the overlay) — kept the same as user-initiated selects for now;
   * the param is reserved for future divergence.
   */
  private dispatch(id: EditorTab, _fromInit: boolean): void {
    if (id === 'code' || id === 'preview') {
      this.postViewToBolt(id);
    }
    this.tabChange.emit(id);
  }

  /**
   * Best-effort postMessage to the bolt iframe asking it to switch its
   * internal view to `code` or `preview`. Silently no-ops when the iframe
   * isn't registered yet (booting / unmounted).
   */
  private postViewToBolt(view: 'code' | 'preview'): void {
    const win = this.boltContentWindow();
    if (!win) return;
    try {
      win.postMessage({ type: 'PS_EDITOR_VIEW', view }, BOLT_ORIGIN);
    } catch (err) {
      console.warn('[editor-tabs] postMessage failed', err);
    }
  }

  /**
   * Resolve the bolt iframe's `contentWindow` via DOM query. The iframe
   * lives in `AdminComponent`'s template with class `bolt-frame` so the
   * query is stable. Returns null while the iframe is still booting (i.e.
   * `bolt.iframeUrl()` is still null) — callers silently no-op.
   *
   * @remarks
   * `BoltEmbedService` keeps its own private reference for richer protocol
   * messages (saveAndDeploy, deploy, file-list). The tab strip only needs
   * a one-shot view switch, so the DOM query keeps the contract minimal.
   */
  private boltContentWindow(): Window | null {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector<HTMLIFrameElement>('iframe.bolt-frame');
    return el?.contentWindow ?? null;
  }

  /** Type-guard for persisted-storage values. */
  private isValidTab(v: string): v is EditorTab {
    return v === 'code' || v === 'preview' || v === 'media' || v === 'agents';
  }
}
