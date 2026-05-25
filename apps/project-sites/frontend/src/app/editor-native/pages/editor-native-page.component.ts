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
 * Phase 2-6 will replace this thin shell with the full workbench
 * (file tree + CodeMirror + WebContainer + preview + terminal).
 */

import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EditorChatComponent } from '../components/editor-chat/editor-chat.component';

@Component({
  selector: 'app-editor-native-page',
  standalone: true,
  imports: [EditorChatComponent],
  template: `
    @if (allowed()) {
      <div class="enp-wrap" data-testid="editor-native-page">
        <app-editor-chat />
      </div>
    } @else {
      <div class="enp-gate" data-testid="editor-native-gate">
        <div class="enp-card">
          <h2>Native editor is opt-in</h2>
          <p>
            This experimental Angular editor is hidden behind a feature flag.
            Open Settings → Labs and flip "Experimental: native editor" to enable it,
            or append <code>?native=1</code> to the URL.
          </p>
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
