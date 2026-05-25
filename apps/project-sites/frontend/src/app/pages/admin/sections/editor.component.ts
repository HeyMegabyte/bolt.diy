import { Component, inject } from '@angular/core';
import { AdminStateService } from '../admin-state.service';
import { BoltEmbedService } from '../../../services/bolt-embed.service';
import { OnboardingChecklistComponent } from '../onboarding-checklist.component';

/**
 * Editor route — a thin shell. The bolt.diy iframe itself lives in
 * AdminComponent and is owned by BoltEmbedService, so it survives every
 * admin sub-route change. This component renders:
 *
 *  - empty-site state (no site selected)
 *  - thin cinematic loading veil while the iframe boots, dismissed the
 *    instant bolt.diy postMessages PS_BOLT_CHAT_READY (i.e. the chat
 *    placeholder "Build a professional website for…" has painted)
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
      <div class="ed-veil">
        <div class="ed-veil-card">
          <div class="ed-spinner" aria-hidden="true">
            <div class="ed-orb ed-orb-1"></div>
            <div class="ed-orb ed-orb-2"></div>
            <div class="ed-orb ed-orb-3"></div>
          </div>
          <div class="ed-headline">Booting your AI editor</div>
          <div class="ed-sub">{{ bolt.loadingStage() }}</div>
          <div class="ed-footnote">First visit only — subsequent opens are instant.</div>
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

    /* Loading veil — sits over the iframe in its visible position so the
       user never sees bolt.diy's own boot flicker. Cinematic + brief —
       dismissed the instant PS_BOLT_CHAT_READY fires from the iframe. */
    .ed-veil {
      position: absolute;
      inset: 62px 0 0 0;
      display: flex; align-items: center; justify-content: center;
      z-index: 2;
      background:
        radial-gradient(ellipse 70% 50% at center top, rgba(0, 229, 255, 0.06), transparent 60%),
        radial-gradient(ellipse 50% 40% at center bottom, rgba(124, 58, 237, 0.05), transparent 65%),
        #060610;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: edFade 240ms var(--ease-cinematic);
    }
    .ed-veil-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.85rem;
      padding: 2rem 2.4rem;
      border-radius: 22px;
      background: rgba(8, 8, 32, 0.6);
      border: 1px solid rgba(0, 229, 255, 0.10);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.04);
      max-width: 460px;
      text-align: center;
    }
    .ed-spinner { position: relative; width: 64px; height: 64px; }
    .ed-orb {
      position: absolute; inset: 0; border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: rgba(0, 229, 255, 0.9);
      animation: edSpin 1.2s var(--ease-cinematic) infinite;
    }
    .ed-orb-2 {
      inset: 8px; border-top-color: transparent;
      border-right-color: rgba(124, 58, 237, 0.8);
      animation-duration: 1.6s; animation-direction: reverse;
    }
    .ed-orb-3 {
      inset: 16px; border-top-color: transparent;
      border-bottom-color: rgba(0, 229, 255, 0.5);
      animation-duration: 2.0s;
    }
    .ed-headline {
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 600; font-size: 1.05rem; color: #f4f4ff;
      letter-spacing: -0.02em;
    }
    .ed-sub {
      font-size: 0.78rem;
      color: rgba(244, 244, 255, 0.65);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .ed-footnote {
      font-size: 0.7rem;
      color: rgba(244, 244, 255, 0.4);
      margin-top: 0.4rem;
    }
    @keyframes edSpin { to { transform: rotate(360deg); } }
    @keyframes edFade { from { opacity: 0; } to { opacity: 1; } }

    @media (prefers-reduced-motion: reduce) {
      .empty-glyph, .ed-veil { animation: none; }
      .ed-orb { animation-duration: 3s; }
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
