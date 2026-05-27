import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { OverlayModule } from '@angular/cdk/overlay';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injectable,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { CapabilityService } from '../services/capability.service';
import type { Capability } from '../types/domain';

/**
 * Verb tokens that flip the palette into action-mode. When the trimmed
 * input begins with one of these, the palette POSTs the raw string to
 * `POST /api/ai/intent` instead of filtering the static command list.
 *
 * Kept narrow on purpose — anything wider tends to capture noun-led
 * queries ("bookings tomorrow") which should stay as nav-filter.
 */
export const ACTION_MODE_VERBS = [
  'create',
  'new',
  'add',
  'schedule',
  'book',
  'send',
  'invite',
  'show',
  'find',
  'open',
  'go',
  'cancel',
  'delete',
  'archive',
  'remind',
  'pay',
] as const;
export type ActionVerb = (typeof ACTION_MODE_VERBS)[number];

/**
 * Pure detection — does the input begin with an action verb?
 * Exported so the palette spec can assert it without spinning up the
 * full component tree.
 */
export function isActionModeInput(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return false;
  const head = trimmed.split(/\s+/)[0] ?? '';
  return (ACTION_MODE_VERBS as readonly string[]).includes(head);
}

/**
 * Response envelope from `POST /api/ai/intent`. The action types here
 * mirror routes the dashboard knows how to invoke; unknown types are
 * surfaced as toast errors rather than blind navigation.
 */
export interface IntentResponse {
  readonly action_type:
    | 'create_booking'
    | 'create_quote'
    | 'create_job'
    | 'open_billing'
    | 'show_metric'
    | 'unknown';
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
  readonly natural_response?: string;
}

interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly route: readonly string[];
  readonly requires: Capability | null;
}

/**
 * Cmd+K command palette content. Filterable list of cross-section
 * navigation targets. **Immediately focuses the input on open** per
 * the universal Cmd+K mandate.
 *
 * Open via {@link CommandPaletteService.open}; close on Esc / select.
 */
@Component({
  selector: 'lib-command-palette',
  standalone: true,
  imports: [DialogModule, OverlayModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ps-palette"
      role="dialog"
      aria-modal="true"
      aria-labelledby="palette-input"
      data-testid="command-palette"
    >
      <input
        #input
        id="palette-input"
        type="text"
        class="ps-palette__input"
        autocomplete="off"
        spellcheck="false"
        autofocus
        placeholder="Search bookings, jobs, sites, team, settings, docs…"
        [ngModel]="query()"
        (ngModelChange)="setQuery($event)"
        (keydown.escape)="close()"
        (keydown.arrowDown)="moveSel(1); $event.preventDefault()"
        (keydown.arrowUp)="moveSel(-1); $event.preventDefault()"
        (keydown.enter)="activate(); $event.preventDefault()"
        data-testid="command-palette-input"
        aria-controls="palette-list"
        [attr.aria-activedescendant]="activeId()"
      />
      <ul
        id="palette-list"
        class="ps-palette__list"
        role="listbox"
        aria-label="Commands"
      >
        @for (item of filtered(); track item.id; let i = $index) {
          <li
            [id]="'palette-opt-' + item.id"
            class="ps-palette__row"
            [class.is-active]="i === sel()"
            role="option"
            [attr.aria-selected]="i === sel()"
            (mouseenter)="sel.set(i)"
            (click)="run(item)"
          >
            <span class="ps-palette__label">{{ item.label }}</span>
            <span class="ps-palette__hint">{{ item.hint }}</span>
          </li>
        } @empty {
          <li class="ps-palette__empty">No matches — try “bookings”, “site”, “settings”.</li>
        }
      </ul>
      @if (actionMode()) {
        <div class="ps-palette__action" data-testid="command-palette-action-mode">
          @if (busy()) {
            <span class="ps-palette__action-busy">Asking AI…</span>
          } @else {
            <span class="ps-palette__action-hint">↵ runs this as an AI action</span>
          }
          @if (actionError(); as err) {
            <span class="ps-palette__action-err" role="alert">{{ err }}</span>
          }
        </div>
      }
      <footer class="ps-palette__foot">
        <span>↑↓ navigate</span>
        <span>↵ {{ actionMode() ? 'run action' : 'open' }}</span>
        <span>esc close</span>
        <span>? shortcuts</span>
      </footer>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: min(640px, 92vw);
        background: var(--ps-bg, #060610);
        color: var(--ps-ink, #f4f4ff);
        border-radius: var(--ps-radius-xl, 22px);
        box-shadow: var(--ps-shadow-modal, 0 24px 72px rgba(0, 0, 0, 0.55));
        overflow: hidden;
      }
      .ps-palette__input {
        width: 100%;
        padding: 18px 22px;
        font-size: 1rem;
        background: transparent;
        color: inherit;
        border: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        outline: none;
      }
      .ps-palette__list {
        list-style: none;
        margin: 0;
        padding: 6px 0;
        max-height: 320px;
        overflow-y: auto;
      }
      .ps-palette__row {
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
        padding: 10px 22px;
        cursor: pointer;
      }
      .ps-palette__row.is-active {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent);
      }
      .ps-palette__label {
        font-weight: 600;
      }
      .ps-palette__hint {
        margin-left: auto;
        font-size: 0.75rem;
        color: color-mix(in oklch, currentColor 55%, transparent);
      }
      .ps-palette__empty {
        padding: 14px 22px;
        color: color-mix(in oklch, currentColor 55%, transparent);
      }
      .ps-palette__foot {
        display: flex;
        gap: 1rem;
        padding: 8px 22px;
        font-size: 0.7rem;
        color: color-mix(in oklch, currentColor 50%, transparent);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .ps-palette__action {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 6px 22px;
        font-size: 0.75rem;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
        border-top: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 24%, transparent);
      }
      .ps-palette__action-hint {
        color: var(--ps-ink-accent, var(--ps-accent, #00e5ff));
        font-weight: 600;
      }
      .ps-palette__action-busy {
        color: color-mix(in oklch, currentColor 70%, transparent);
      }
      .ps-palette__action-err {
        margin-left: auto;
        color: #f87171;
      }
      @media (prefers-reduced-motion: no-preference) {
        :host {
          animation: enter 160ms ease-out;
        }
      }
      @keyframes enter {
        from {
          transform: translateY(-6px);
          opacity: 0;
        }
        to {
          transform: none;
          opacity: 1;
        }
      }
    `,
  ],
})
export class CommandPaletteComponent implements AfterViewInit {
  private readonly router = inject(Router);
  private readonly caps = inject(CapabilityService);
  private readonly dialog = inject(Dialog);
  private readonly http = inject(HttpClient);

  @ViewChild('input', { static: true })
  private readonly inputRef!: ElementRef<HTMLInputElement>;

  readonly query = signal('');
  readonly sel = signal(0);
  readonly actionMode = computed(() => isActionModeInput(this.query()));
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);

  private readonly commands: readonly CommandItem[] = [
    { id: 'bookings', label: 'Bookings', hint: 'g b', route: ['/dashboard', 'bookings'], requires: 'bookings:read' },
    { id: 'quotes', label: 'Quotes', hint: 'g q', route: ['/dashboard', 'quotes'], requires: 'quotes:read' },
    { id: 'jobs', label: 'Jobs', hint: 'g j', route: ['/dashboard', 'jobs'], requires: 'jobs:read' },
    { id: 'crew', label: 'Crew', hint: 'g c', route: ['/dashboard', 'crew'], requires: 'crew:read' },
    { id: 'sites', label: 'Sites', hint: 'g s', route: ['/dashboard', 'sites'], requires: 'sites:read' },
    { id: 'billing', label: 'Billing', hint: 'g $', route: ['/dashboard', 'billing'], requires: 'billing:read' },
    { id: 'team', label: 'Team', hint: 'g t', route: ['/dashboard', 'team'], requires: 'users:read' },
    { id: 'integrations', label: 'Integrations', hint: 'g i', route: ['/dashboard', 'integrations'], requires: 'apps:read' },
    { id: 'settings', label: 'Settings', hint: 'g ,', route: ['/dashboard', 'settings'], requires: 'settings:read' },
    { id: 'changelog', label: 'Changelog', hint: '', route: ['/dashboard', 'changelog'], requires: null },
    { id: 'docs', label: 'Docs', hint: '', route: ['/dashboard', 'docs'], requires: 'docs:read' },
  ];

  readonly available = computed<readonly CommandItem[]>(() =>
    this.commands.filter((c) => c.requires === null || this.caps.has(c.requires)),
  );

  readonly filtered = computed<readonly CommandItem[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.available();
    return this.available().filter((c) => c.label.toLowerCase().includes(q));
  });

  readonly activeId = computed<string | null>(() => {
    const list = this.filtered();
    const i = Math.min(this.sel(), list.length - 1);
    return i >= 0 && list[i] ? `palette-opt-${list[i]!.id}` : null;
  });

  constructor() {
    afterNextRender(() => this.inputRef.nativeElement.focus({ preventScroll: true }));
  }

  ngAfterViewInit(): void {
    // Belt-and-braces focus: some browsers ignore `autofocus` on
    // CDK-overlay-injected nodes until the next frame.
    queueMicrotask(() => this.inputRef.nativeElement.focus({ preventScroll: true }));
  }

  setQuery(v: string): void {
    this.query.set(v);
    this.sel.set(0);
  }

  moveSel(delta: number): void {
    const list = this.filtered();
    if (list.length === 0) return;
    const next = (this.sel() + delta + list.length) % list.length;
    this.sel.set(next);
  }

  activate(): void {
    if (this.actionMode()) {
      void this.runAction();
      return;
    }
    const list = this.filtered();
    const target = list[this.sel()];
    if (target) this.run(target);
  }

  /**
   * Hand the raw query off to `POST /api/ai/intent`. The server
   * returns a structured action; the palette translates it into a
   * route or dialog launch. Unknown intents surface as inline errors
   * so the user can revise the phrasing.
   */
  async runAction(): Promise<void> {
    const text = this.query().trim();
    if (!text) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const res = await new Promise<IntentResponse>((resolve, reject) => {
        this.http.post<IntentResponse>('/api/ai/intent', { input: text }).subscribe({
          next: resolve,
          error: reject,
        });
      });
      this.dispatchIntent(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI intent failed';
      this.actionError.set(message);
    } finally {
      this.busy.set(false);
    }
  }

  /** Route the parsed intent to its dashboard target. Visible for testing. */
  dispatchIntent(intent: IntentResponse): void {
    switch (intent.action_type) {
      case 'create_booking':
        this.close();
        void this.router.navigate(['/dashboard', 'bookings', 'new'], {
          queryParams: intent.params,
        });
        return;
      case 'create_quote':
        this.close();
        void this.router.navigate(['/dashboard', 'quotes', 'new'], {
          queryParams: intent.params,
        });
        return;
      case 'create_job':
        this.close();
        void this.router.navigate(['/dashboard', 'jobs', 'new'], {
          queryParams: intent.params,
        });
        return;
      case 'open_billing':
        this.close();
        void this.router.navigate(['/dashboard', 'billing']);
        return;
      case 'show_metric':
        this.close();
        void this.router.navigate(['/dashboard'], { queryParams: intent.params });
        return;
      case 'unknown':
      default:
        this.actionError.set(
          intent.natural_response ?? 'I did not understand that — try rephrasing.',
        );
    }
  }

  run(item: CommandItem): void {
    this.close();
    void this.router.navigate(item.route);
  }

  close(): void {
    this.dialog.closeAll();
  }

  @HostListener('document:keydown', ['$event'])
  onShortcutHelp(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== '?') return;
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    // TODO: open the shortcut sheet — wire when the help dialog ships.
  }
}

/**
 * Imperative opener for the command palette. Holds the open/closed
 * state at app scope so Cmd+K is a global trigger.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly dialog = inject(Dialog);
  private isOpen = false;

  open(): void {
    if (this.isOpen) {
      this.dialog.closeAll();
      this.isOpen = false;
      return;
    }
    const ref = this.dialog.open(CommandPaletteComponent, {
      hasBackdrop: true,
      backdropClass: 'ps-palette-backdrop',
      panelClass: 'ps-palette-panel',
      ariaLabel: 'Command palette',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      width: 'auto',
    });
    this.isOpen = true;
    ref.closed.subscribe(() => (this.isOpen = false));
  }
}
