import { Directive, ElementRef, inject } from '@angular/core';

/**
 * @module ui/tablist
 * WCAG APG "Tabs" keyboard pattern for any existing ARIA tablist.
 *
 * @remarks
 * Many admin sections already render a `role="tablist"` with `role="tab"`
 * children + `aria-selected`, but ship NO keyboard navigation — a screen
 * reader announces "tab list" yet ArrowLeft/Right do nothing, which is an
 * incomplete (and confusing) ARIA implementation per the WAI-ARIA Authoring
 * Practices Tabs pattern.
 *
 * Apply `hlmTablist` to the container that already carries `role="tablist"`.
 * The directive is purely additive: it does NOT touch click handlers, state
 * signals, or styling. It only manages the roving `tabindex` across the
 * `[role="tab"]` children and wires arrow / Home / End focus movement.
 *
 * - **Roving tabindex** — the focused (or, initially, the `aria-selected`)
 *   tab gets `tabindex="0"`; every other tab gets `tabindex="-1"`, so Tab
 *   reaches the strip once and arrows move within it.
 * - **ArrowRight / ArrowDown** — focus next tab (wraps to first).
 * - **ArrowLeft / ArrowUp** — focus previous tab (wraps to last).
 * - **Home / End** — focus first / last tab.
 * - Activation stays native: the tabs are `<button>`s, so Enter/Space fire
 *   their existing `(click)` and select. This works for both automatic and
 *   manual activation styles already in use.
 *
 * Tabs rendered by `@for` are queried live on every interaction, so dynamic
 * tab sets stay correct without re-initialisation.
 *
 * @example
 * ```html
 * <div class="range-chip-strip" role="tablist" hlmTablist aria-label="Date range">
 *   @for (r of ranges; track r.id) {
 *     <button role="tab" [attr.aria-selected]="range() === r.id" (click)="setRange(r.id)">{{ r.label }}</button>
 *   }
 * </div>
 * ```
 */
@Directive({
  selector: '[hlmTablist]',
  standalone: true,
  host: {
    '(keydown)': 'onKeydown($event)',
    '(focusin)': 'onFocusin($event)',
  },
})
export class HlmTablistDirective {
  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private initialised = false;

  /** Live list of enabled tab buttons in DOM order. */
  private tabs(): HTMLElement[] {
    const all = Array.from(this.el.querySelectorAll<HTMLElement>('[role="tab"]'));
    return all.filter((t) => !t.hasAttribute('disabled') && t.getAttribute('aria-disabled') !== 'true');
  }

  /** Apply roving tabindex so only `active` is in the Tab order. */
  private roving(active: HTMLElement): void {
    for (const t of this.tabs()) {
      t.tabIndex = t === active ? 0 : -1;
    }
  }

  /** On first interaction, seed the roving tabindex from the selected tab. */
  private ensureInit(): void {
    if (this.initialised) return;
    const tabs = this.tabs();
    if (!tabs.length) return;
    const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
    this.roving(selected);
    this.initialised = true;
  }

  onFocusin(ev: FocusEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target?.getAttribute('role') === 'tab') {
      this.roving(target);
    } else {
      this.ensureInit();
    }
  }

  onKeydown(ev: KeyboardEvent): void {
    const tabs = this.tabs();
    if (!tabs.length) return;
    const current = ev.target as HTMLElement;
    if (current?.getAttribute('role') !== 'tab') return;

    const idx = tabs.indexOf(current);
    if (idx === -1) return;

    let next = -1;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }

    ev.preventDefault();
    const target = tabs[next];
    this.roving(target);
    target.focus();
  }
}
