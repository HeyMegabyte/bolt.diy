/**
 * Reusable pretty empty state.
 *   <app-empty-state
 *     icon="📭"
 *     title="No submissions yet"
 *     body="Drop the app.js snippet on your site and every form submit appears here."
 *     primary="Copy snippet"
 *     (primaryClick)="copy()"
 *   />
 */
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  template: `
    <div class="empty-state-pretty">
      @if (icon) {
        <div class="empty-glyph"><span class="empty-emoji">{{ icon }}</span></div>
      }
      <h3 class="glow-h-grad text-xl font-semibold m-0">{{ title }}</h3>
      @if (body) { <p class="text-[0.88rem] text-text-secondary max-w-[480px] mx-auto m-0 leading-relaxed">{{ body }}</p> }
      @if (primary || secondary) {
        <div class="flex gap-2 justify-center mt-1 flex-wrap">
          @if (primary)   { <button class="btn-primary" (click)="primaryClick.emit()">{{ primary }}</button> }
          @if (secondary) { <button class="btn-ghost" (click)="secondaryClick.emit()">{{ secondary }}</button> }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .empty-emoji { font-size: 1.8rem; line-height: 1; }
  `],
})
export class EmptyStateComponent {
  @Input() icon?: string;
  @Input() title = '';
  @Input() body?: string;
  @Input() primary?: string;
  @Input() secondary?: string;
  @Output() primaryClick = new EventEmitter<void>();
  @Output() secondaryClick = new EventEmitter<void>();
}
