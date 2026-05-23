import { Component, inject } from '@angular/core';
import { AdminStateService } from '../admin-state.service';
import { BoltEmbedService } from '../../../services/bolt-embed.service';
import { OnboardingChecklistComponent } from '../onboarding-checklist.component';

/**
 * Editor route — a thin shell. The bolt.diy iframe itself lives in
 * `AdminComponent` and is owned by {@link BoltEmbedService}, so it survives
 * every admin sub-route change. This component only renders:
 *  - the empty-site state (no site selected)
 *  - the loading veil that masks bolt.diy's cold-boot until `editorReady`
 *
 * The iframe is rendered, positioned, and reveal-animated by the shell.
 *
 * @example
 * ```html
 * <app-admin-editor />
 * ```
 */
@Component({
  selector: 'app-admin-editor',
  standalone: true,
  imports: [OnboardingChecklistComponent],
  template: `
    @if (!state.selectedSite()) {
      <div class="p-7 max-w-[820px] mx-auto space-y-6">
        <app-onboarding-checklist />
        <div class="empty-state-pretty">
          <div class="empty-glyph">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" stroke-width="1.4">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <h3 class="glow-h-grad text-2xl font-semibold m-0">Welcome to your admin</h3>
          <p class="text-[0.92rem] text-text-secondary max-w-[480px] mx-auto m-0 leading-relaxed">
            Pick a site from the top-left selector to open it in the AI editor — or follow the checklist above to get fully set up in two minutes.
          </p>
          <div class="flex gap-2 justify-center mt-1">
            <button class="btn-primary" (click)="state.newSite()">+ Create a new site</button>
            <button class="btn-ghost" (click)="openPalette()">⌘K Quick find</button>
          </div>
        </div>
      </div>
    } @else if (!bolt.editorReady()) {
      <div class="relative w-full h-[calc(100vh-49px)]">
        <div class="loading-veil absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0a0a1a]">
          <div class="orbit-spinner" aria-hidden="true">
            <div class="orbit orbit-1"></div>
            <div class="orbit orbit-2"></div>
            <div class="orbit orbit-3"></div>
          </div>
          <span class="text-white/70 text-sm font-medium tracking-wide">Loading</span>
          <span class="text-text-secondary/60 text-xs">{{ bolt.loadingStage() }}</span>
          <span class="text-text-secondary/40 text-[0.65rem] mt-2">
            First visit only — subsequent opens are instant
          </span>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1); display: block; }

    .empty-glyph {
      width: 88px; height: 88px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 20px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.08), rgba(124, 58, 237, 0.05));
      border: 1px solid rgba(0, 229, 255, 0.12);
      color: rgba(0, 229, 255, 0.7);
      box-shadow:
        0 16px 48px -24px rgba(0, 229, 255, 0.3),
        0 0 0 1px rgba(0, 229, 255, 0.05) inset;
      animation: pulseGlow 3.6s var(--ease-cinematic) infinite;
    }
    .loading-veil {
      animation: fadeIn 240ms var(--ease-cinematic);
      background:
        radial-gradient(ellipse at center, rgba(0, 229, 255, 0.04) 0%, transparent 60%),
        #0a0a1a;
    }
    .orbit-spinner { position: relative; width: 56px; height: 56px; }
    .orbit {
      position: absolute; inset: 0; border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: rgba(0, 229, 255, 0.9);
      animation: spin 1.2s var(--ease-cinematic) infinite;
    }
    .orbit-2 {
      inset: 6px; border-top-color: transparent;
      border-right-color: rgba(124, 58, 237, 0.7);
      animation-duration: 1.6s; animation-direction: reverse;
    }
    .orbit-3 {
      inset: 12px; border-top-color: transparent;
      border-bottom-color: rgba(0, 229, 255, 0.5);
      animation-duration: 2.0s;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pulseGlow {
      0%, 100% {
        box-shadow:
          0 16px 48px -24px rgba(0, 229, 255, 0.3),
          0 0 0 1px rgba(0, 229, 255, 0.05) inset;
      }
      50% {
        box-shadow:
          0 20px 64px -24px rgba(0, 229, 255, 0.45),
          0 0 0 1px rgba(0, 229, 255, 0.12) inset;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .loading-veil, .empty-glyph { animation: none; }
      .orbit { animation-duration: 3s; }
    }
  `],
})
export class AdminEditorComponent {
  state = inject(AdminStateService);
  bolt = inject(BoltEmbedService);

  openPalette(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  }
}
