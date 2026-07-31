/**
 * @module editor-native/pages/editor-native-page
 *
 * @description
 * Phase-1 host for the native editor. The route `/admin/editor-native`
 * mounts this component. It checks the `editor.native` feature flag
 * (localStorage OR `?native=1` query param), redirects opt-outs back
 * to the iframe editor, and otherwise mounts `<app-editor-chat>` as
 * the only surface.
 *
 * The component ALSO self-defends against the server-side `native_editor`
 * flag being dark: instead of relying solely on the route-level
 * `featureFlagGuard` redirect (guards and components drift independently),
 * a dark flag renders the calm flag-disabled notice + dimmed card INSIDE
 * the admin shell — never a blank main. Pattern per rules/feature-flags.md
 * (notice + dimmed; the api-tokens 503 notice is the sibling reference).
 *
 * Phase 2-6 will replace this thin shell with the full workbench
 * (file tree + CodeMirror + WebContainer + preview + terminal).
 */

import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EditorChatComponent } from '../components/editor-chat/editor-chat.component';
import { FeatureFlagService } from '../../services/feature-flag.service';

@Component({
  selector: 'app-editor-native-page',
  standalone: true,
  imports: [EditorChatComponent, RouterLink],
  template: `
    @if (allowed()) {
      <div class="enp-wrap" data-testid="editor-native-page">
        <app-editor-chat />
      </div>
    } @else {
      <div class="enp-gate" data-testid="editor-native-gate" role="status">
        <div class="enp-card" [class.enp-card-dimmed]="flagOff()">
          @if (flagOff()) {
            <p class="enp-flag-notice" data-testid="editor-native-flag-notice">
              Feature disabled — the <code>native_editor</code> flag is off for this platform.
            </p>
            <h2>Native editor is switched off</h2>
            <p>
              An operator can enable it from the Feature Flags console. Until then,
              the classic editor remains fully available.
            </p>
          } @else {
            <h2>Native editor is opt-in</h2>
            <p>
              This experimental Angular editor is hidden behind a feature flag.
              Open Settings → Labs and flip "Experimental: native editor" to enable it,
              or append <code>?native=1</code> to the URL.
            </p>
          }
          <a class="enp-btn" routerLink="/admin/editor">← Back to editor</a>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; height: 100%; }
      .enp-wrap {
        position: absolute;
        inset: 62px 0 0 0;
        display: block;
      }
      .enp-gate {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        padding: 2rem;
      }
      .enp-card {
        max-width: 460px;
        text-align: center;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        padding: 1.75rem 1.5rem;
        color: var(--ps-ink, #f4f4ff);
      }
      .enp-card h2 { margin: 0 0 0.5rem; font-size: 1.2rem; }
      .enp-card p { font-size: 0.9rem; color: rgba(244, 244, 255, 0.7); line-height: 1.5; }
      .enp-card-dimmed { opacity: 0.78; }
      .enp-flag-notice {
        margin: 0 0 0.9rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid rgba(0, 229, 255, 0.35);
        border-radius: 10px;
        background: rgba(0, 229, 255, 0.06);
        color: var(--ps-accent, #00e5ff);
        font-size: 0.8rem;
      }
      .enp-card code {
        background: rgba(0, 229, 255, 0.08);
        padding: 0.1rem 0.4rem;
        border-radius: 4px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        color: var(--ps-accent, #00e5ff);
      }
      .enp-btn {
        display: inline-block;
        margin-top: 0.9rem;
        padding: 0.55rem 1.1rem;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--ps-accent, #00e5ff), var(--ps-purple, #7c3aed));
        color: var(--ps-bg, #060610);
        font-weight: 600;
        text-decoration: none;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class EditorNativePageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly allowed = signal(false);

  /**
   * Server-side `native_editor` flag: `true` on, `false` dark, `undefined`
   * while resolving. `isOn` is cached + shareReplay'd (one HTTP per session)
   * and already `catchError`s to `false` — no error branch needed here.
   */
  private readonly serverFlag = toSignal<boolean | undefined>(
    inject(FeatureFlagService).isOn('native_editor'),
    { initialValue: undefined },
  );

  /** Only a RESOLVED-dark flag shows the disabled notice — never a loading flash. */
  readonly flagOff = computed(() => this.serverFlag() === false);

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap.get('native');
    const queryEnabled = query === '1' || query === 'true';
    let storedEnabled = false;
    try {
      storedEnabled = localStorage.getItem('editor.native') === 'true';
    } catch {
      // Private mode / SSR — silently skip.
    }
    if (queryEnabled) {
      try {
        localStorage.setItem('editor.native', 'true');
      } catch {
        // ignore
      }
    }
    this.allowed.set(queryEnabled || storedEnabled);
  }
}
