import { Directive, effect, ElementRef, inject, input, output } from '@angular/core';
import { DOCUMENT } from '@angular/common';

const STORAGE_PREFIX = 'ps-nav-order-';

/**
 * Lightweight drag-to-reorder for sidebar navigation items.
 *
 * Usage: `<nav appDragReorder [items]="navItems()" (reordered)="onReorder($event)" />`
 *
 * Uses native HTML5 drag-and-drop (no CDK dependency) so it ships
 * in the initial bundle without pulling in CDK drag-drop (~15 KB).
 * Items must have `data-id` attributes matching the `id` field.
 */
@Directive({ selector: '[appDragReorder]', standalone: true })
export class DragReorderDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);

  /** Group key for localStorage persistence (e.g. 'admin-sidebar'). */
  readonly group = input('default');

  /** Emitted when the user drops an item in a new position. */
  readonly reordered = output<string[]>();

  private draggedId: string | null = null;

  constructor() {
    effect(() => {
      const g = this.group();
      this.el.nativeElement.addEventListener('dragstart', this.onDragStart);
      this.el.nativeElement.addEventListener('dragover', this.onDragOver);
      this.el.nativeElement.addEventListener('drop', this.onDrop);
      this.el.nativeElement.addEventListener('dragend', this.onDragEnd);
    });
  }

  private readonly onDragStart = (e: DragEvent) => {
    const el = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (!el) return;
    this.draggedId = el.dataset['id'] ?? null;
    el.classList.add('dragging');
    e.dataTransfer!.effectAllowed = 'move';
  };

  private readonly onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  };

  private readonly onDrop = (e: DragEvent) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (!target || !this.draggedId || target.dataset['id'] === this.draggedId) return;

    const container = this.el.nativeElement;
    const dragged = container.querySelector(`[data-id="${this.draggedId}"]`);
    if (!dragged) return;

    // Insert dragged before or after target based on drop position
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      target.before(dragged);
    } else {
      target.after(dragged);
    }

    // Collect new order
    const ids = Array.from(container.querySelectorAll('[data-id]')).map(
      (el) => (el as HTMLElement).dataset['id'] ?? '',
    );
    this.reordered.emit(ids);
    this.persist(ids);
  };

  private readonly onDragEnd = () => {
    const el = this.el.nativeElement.querySelector('.dragging');
    if (el) el.classList.remove('dragging');
    this.draggedId = null;
  };

  /** Load persisted order from localStorage. */
  loadOrder(): string[] | null {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + this.group());
      if (raw) return JSON.parse(raw) as string[];
    } catch { /* ignore */ }
    return null;
  }

  private persist(ids: string[]): void {
    try { localStorage.setItem(STORAGE_PREFIX + this.group(), JSON.stringify(ids)); } catch { /* quota */ }
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('dragstart', this.onDragStart);
    this.el.nativeElement.removeEventListener('dragover', this.onDragOver);
    this.el.nativeElement.removeEventListener('drop', this.onDrop);
    this.el.nativeElement.removeEventListener('dragend', this.onDragEnd);
  }
}
