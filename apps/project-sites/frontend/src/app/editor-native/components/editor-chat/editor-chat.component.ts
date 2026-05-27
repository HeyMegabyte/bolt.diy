/**
 * @module editor-native/components/editor-chat
 *
 * @description
 * Cinematic chat surface for the native Angular editor at
 * `/admin/editor-native`. Phase 1 deliverable — proof-of-life for the
 * port. Provides:
 *
 *   - Provider selector + model dropdown (4 providers: Workers AI,
 *     OpenAI, Anthropic, Ollama)
 *   - Message list with user/assistant rails (cyan/purple)
 *   - Live token-by-token streaming via signals
 *   - Empty state hero: "Build for {{ business_name }}"
 *   - Cinematic loading orb matching the existing editor.component.ts
 *
 * Owns one `EditorChatService` instance per mounted component (provided
 * at component level, not root) so multiple chat surfaces don't share
 * state.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../../pages/admin/admin-state.service';
import { EditorChatService, type EditorMessage } from '../../services/editor-chat.service';
import { PROVIDER_PRESETS, type LlmProvider } from '../../services/editor-llm.service';

@Component({
  selector: 'app-editor-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  providers: [EditorChatService],
  template: `
    <section class="enc-shell" data-testid="editor-native-chat">
      <header class="enc-head">
        <div class="enc-head-left">
          <span class="enc-eyebrow">Native editor · experimental</span>
          <h2 class="enc-title">
            @if (state.selectedSite(); as site) {
              Build for <span class="enc-accent">{{ site.business_name || site.slug }}</span>
            } @else {
              Pick a site to begin
            }
          </h2>
        </div>
        <div class="enc-head-right">
          <label class="enc-field">
            <span class="enc-label">Provider</span>
            <select
              class="enc-select"
              [ngModel]="provider()"
              (ngModelChange)="onProviderChange($event)"
              data-testid="enc-provider"
              aria-label="LLM provider"
            >
              @for (p of providerList; track p.key) {
                <option [value]="p.key">{{ p.label }}</option>
              }
            </select>
          </label>
          <label class="enc-field">
            <span class="enc-label">Model</span>
            <select
              class="enc-select"
              [ngModel]="model()"
              (ngModelChange)="onModelChange($event)"
              data-testid="enc-model"
              aria-label="Model"
            >
              @for (m of modelChoices(); track m) {
                <option [value]="m">{{ m }}</option>
              }
            </select>
          </label>
        </div>
      </header>

      @if (!chat.currentChat()) {
        <div class="enc-hero">
          <div class="enc-orb" aria-hidden="true">
            <span class="enc-orb-r enc-orb-r-1"></span>
            <span class="enc-orb-r enc-orb-r-2"></span>
            <span class="enc-orb-r enc-orb-r-3"></span>
          </div>
          <h3 class="enc-hero-h">Start a new conversation</h3>
          <p class="enc-hero-p">
            The native editor lives outside the bolt.diy iframe — pure Angular signals, faster cold
            load, real D1 persistence.
          </p>
          <button
            type="button"
            class="enc-cta"
            (click)="startNewChat()"
            [disabled]="!state.selectedSite() || chat.loading()"
            data-testid="enc-start-chat"
          >
            @if (chat.loading()) {
              Creating…
            } @else {
              + Start chat
            }
          </button>
        </div>
      } @else {
        <div class="enc-scroll" #scrollWindow>
          @if (chat.messages().length === 0) {
            <div class="enc-empty">
              <p>
                Type your first message below. Try:
                <code>"Add a hero section with a CTA"</code>
              </p>
            </div>
          }
          @for (msg of chat.messages(); track msg.id) {
            <article
              class="enc-msg"
              [class.is-user]="msg.role === 'user'"
              [class.is-assistant]="msg.role === 'assistant'"
              [class.is-streaming]="msg.streaming"
              [class.is-failed]="msg.failed"
              [attr.data-role]="msg.role"
            >
              <span class="enc-rail" aria-hidden="true"></span>
              <div class="enc-msg-body">
                <span class="enc-msg-role">{{ msg.role }}</span>
                <pre class="enc-msg-text">{{ msg.content || (msg.streaming ? '…' : '') }}</pre>
                @if (msg.tokens_out && !msg.streaming) {
                  <span class="enc-msg-meta"
                    >{{ msg.tokens_in ?? 0 }} → {{ msg.tokens_out }} tok</span
                  >
                }
              </div>
            </article>
          }
        </div>

        <form class="enc-compose" (submit)="onSubmit($event)">
          <textarea
            #composer
            class="enc-textarea"
            placeholder="Describe what to change…"
            [(ngModel)]="draft"
            name="draft"
            rows="2"
            (keydown.enter)="onEnter($event)"
            [disabled]="chat.streaming()"
            data-testid="enc-composer"
            aria-label="Compose message"
          ></textarea>
          <div class="enc-compose-row">
            <span class="enc-hint">Shift+Enter for a new line · Enter to send</span>
            @if (chat.streaming()) {
              <button
                type="button"
                class="enc-stop"
                (click)="chat.cancelStream()"
                data-testid="enc-stop"
                aria-label="Stop generating"
              >
                Stop
              </button>
            } @else {
              <button
                type="submit"
                class="enc-send"
                [disabled]="!draft().trim()"
                data-testid="enc-send"
                aria-label="Send message"
              >
                Send →
              </button>
            }
          </div>
        </form>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        --enc-bg: var(--ps-bg, #060610);
        --enc-ink: var(--ps-ink, #f4f4ff);
        --enc-accent: var(--ps-accent, #00e5ff);
        --enc-purple: var(--ps-purple, #7c3aed);
        --enc-radius: var(--ps-radius-xl, 22px);
        --enc-ease: cubic-bezier(0.4, 0, 0.2, 1);
      }

      .enc-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background:
          radial-gradient(ellipse 60% 40% at 50% 0%, rgba(0, 229, 255, 0.06), transparent 70%),
          radial-gradient(ellipse 40% 30% at 100% 100%, rgba(124, 58, 237, 0.05), transparent 60%),
          var(--enc-bg);
        color: var(--enc-ink);
        font-family: 'Sora', system-ui, sans-serif;
      }

      .enc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.25rem;
        padding: 1.1rem 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        flex-wrap: wrap;
      }
      .enc-head-left {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .enc-head-right {
        display: flex;
        gap: 0.85rem;
        align-items: flex-end;
        flex-wrap: wrap;
      }

      .enc-eyebrow {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--enc-accent) 70%, var(--enc-ink) 30%);
      }
      .enc-title {
        font-size: 1.25rem;
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 0;
        text-wrap: balance;
      }
      .enc-accent {
        background: linear-gradient(135deg, var(--enc-accent), var(--enc-purple));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .enc-field {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }
      .enc-label {
        font-size: 0.6rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(244, 244, 255, 0.55);
        font-family: 'JetBrains Mono', ui-monospace, monospace;
      }
      .enc-select {
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: var(--enc-ink);
        border-radius: 10px;
        padding: 0.45rem 0.7rem;
        font-size: 0.8rem;
        min-width: 200px;
        appearance: none;
        background-image:
          linear-gradient(45deg, transparent 50%, var(--enc-accent) 50%),
          linear-gradient(135deg, var(--enc-accent) 50%, transparent 50%);
        background-position:
          calc(100% - 14px) 50%,
          calc(100% - 8px) 50%;
        background-size: 6px 6px;
        background-repeat: no-repeat;
        padding-right: 1.8rem;
      }
      .enc-select:focus-visible {
        outline: 2px solid var(--enc-accent);
        outline-offset: 2px;
      }

      .enc-hero {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 2rem;
        text-align: center;
        gap: 1rem;
      }
      .enc-orb {
        position: relative;
        width: 72px;
        height: 72px;
      }
      .enc-orb-r {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 2px solid transparent;
        border-top-color: var(--enc-accent);
        animation: encSpin 1.4s var(--enc-ease) infinite;
      }
      .enc-orb-r-2 {
        inset: 8px;
        border-top-color: transparent;
        border-right-color: var(--enc-purple);
        animation-duration: 1.9s;
        animation-direction: reverse;
      }
      .enc-orb-r-3 {
        inset: 16px;
        border-top-color: transparent;
        border-bottom-color: color-mix(in oklch, var(--enc-accent) 60%, transparent);
        animation-duration: 2.3s;
      }
      .enc-hero-h {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 600;
      }
      .enc-hero-p {
        max-width: 460px;
        margin: 0;
        font-size: 0.92rem;
        color: rgba(244, 244, 255, 0.7);
        line-height: 1.55;
      }
      .enc-cta {
        margin-top: 0.8rem;
        background: linear-gradient(135deg, var(--enc-accent), var(--enc-purple));
        color: var(--enc-bg);
        font-weight: 600;
        font-size: 0.9rem;
        padding: 0.7rem 1.3rem;
        border-radius: 999px;
        border: 0;
        cursor: pointer;
        transition:
          transform 180ms var(--enc-ease),
          box-shadow 180ms var(--enc-ease);
      }
      .enc-cta:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 10px 28px -10px rgba(0, 229, 255, 0.6);
      }
      .enc-cta:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .enc-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem 1.5rem 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        scroll-behavior: smooth;
      }
      .enc-empty {
        text-align: center;
        color: rgba(244, 244, 255, 0.45);
        font-size: 0.85rem;
        padding: 1.5rem 0;
      }
      .enc-empty code {
        background: rgba(0, 229, 255, 0.08);
        padding: 0.15rem 0.45rem;
        border-radius: 6px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        color: var(--enc-accent);
      }

      .enc-msg {
        display: grid;
        grid-template-columns: 4px 1fr;
        gap: 0.85rem;
        align-items: stretch;
        animation: encMsgIn 280ms var(--enc-ease);
      }
      @starting-style {
        .enc-msg {
          opacity: 0;
          transform: translateY(6px);
        }
      }
      .enc-rail {
        border-radius: 4px;
        background: linear-gradient(180deg, var(--enc-accent), transparent);
      }
      .enc-msg.is-assistant .enc-rail {
        background: linear-gradient(180deg, var(--enc-purple), transparent);
      }
      .enc-msg.is-failed .enc-rail {
        background: linear-gradient(180deg, #ef4444, transparent);
      }
      .enc-msg-body {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 0.75rem 0.95rem;
        border-radius: 14px;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .enc-msg-role {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 0.6rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--enc-accent) 70%, var(--enc-ink) 30%);
      }
      .enc-msg.is-assistant .enc-msg-role {
        color: color-mix(in oklch, var(--enc-purple) 70%, var(--enc-ink) 30%);
      }
      .enc-msg-text {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: inherit;
        font-size: 0.9rem;
        line-height: 1.55;
        color: var(--enc-ink);
      }
      .enc-msg.is-streaming .enc-msg-text::after {
        content: '▍';
        display: inline-block;
        margin-left: 1px;
        animation: encBlink 1s steps(2, end) infinite;
        color: var(--enc-accent);
      }
      .enc-msg.is-failed .enc-msg-text {
        color: #fca5a5;
      }
      .enc-msg-meta {
        font-size: 0.65rem;
        color: rgba(244, 244, 255, 0.4);
        font-family: 'JetBrains Mono', ui-monospace, monospace;
      }

      .enc-compose {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.9rem 1.5rem 1.1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(0, 0, 0, 0.25);
      }
      .enc-textarea {
        width: 100%;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        color: var(--enc-ink);
        padding: 0.75rem 1rem;
        font-family: inherit;
        font-size: 0.92rem;
        line-height: 1.5;
        resize: vertical;
        min-height: 64px;
        transition: border-color 180ms var(--enc-ease);
      }
      .enc-textarea:focus-visible {
        outline: 0;
        border-color: var(--enc-accent);
        box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.18);
      }
      .enc-compose-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .enc-hint {
        font-size: 0.7rem;
        color: rgba(244, 244, 255, 0.45);
        font-family: 'JetBrains Mono', ui-monospace, monospace;
      }
      .enc-send,
      .enc-stop {
        font-family: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        padding: 0.5rem 1.1rem;
        border-radius: 999px;
        border: 0;
        cursor: pointer;
        transition: transform 160ms var(--enc-ease);
      }
      .enc-send {
        background: linear-gradient(135deg, var(--enc-accent), var(--enc-purple));
        color: var(--enc-bg);
      }
      .enc-send:hover:not(:disabled) {
        transform: translateY(-1px);
      }
      .enc-send:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .enc-stop {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.5);
        color: #fca5a5;
      }

      @keyframes encSpin {
        to {
          transform: rotate(360deg);
        }
      }
      @keyframes encBlink {
        50% {
          opacity: 0;
        }
      }
      @keyframes encMsgIn {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .enc-orb-r,
        .enc-msg,
        .enc-msg.is-streaming .enc-msg-text::after {
          animation: none;
        }
      }
    `,
  ],
})
export class EditorChatComponent {
  readonly state = inject(AdminStateService);
  readonly chat = inject(EditorChatService);

  @ViewChild('scrollWindow') private scrollWindow?: ElementRef<HTMLElement>;

  readonly draft = signal<string>('');

  readonly providerList = Object.entries(PROVIDER_PRESETS).map(([key, value]) => ({
    key: key as LlmProvider,
    ...value,
  }));

  readonly provider = computed<LlmProvider>(
    () => this.chat.currentChat()?.provider ?? 'workers-ai',
  );
  readonly model = computed<string>(() => {
    const c = this.chat.currentChat();
    if (c) return c.model;
    return PROVIDER_PRESETS[this.provider()].models[0]!;
  });
  readonly modelChoices = computed<string[]>(() => PROVIDER_PRESETS[this.provider()].models);

  constructor() {
    // Auto-scroll to bottom whenever messages update.
    effect(() => {
      const _len = this.chat.messages().length;
      void _len;
      queueMicrotask(() => {
        const el = this.scrollWindow?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });

    // When the user picks a different site in the admin shell, drop
    // the current chat so the next "Start chat" binds to the new site.
    effect(() => {
      const _site = this.state.selectedSite();
      void _site;
      if (this.chat.currentChat()) {
        this.chat.cancelStream();
        this.chat.currentChat.set(null);
        this.chat.messages.set([]);
      }
    });
  }

  async startNewChat(): Promise<void> {
    const site = this.state.selectedSite();
    if (!site) return;
    await this.chat.createChat(site.id, this.provider());
  }

  onProviderChange(p: LlmProvider): void {
    this.chat.setProvider(p);
    // Reset model to provider default when switching.
    const first = PROVIDER_PRESETS[p].models[0];
    if (first) this.chat.setModel(first);
  }

  onModelChange(m: string): void {
    this.chat.setModel(m);
  }

  onEnter(event: Event): void {
    const ev = event as KeyboardEvent;
    if (ev.shiftKey) return;
    ev.preventDefault();
    void this.submit();
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit();
  }

  private async submit(): Promise<void> {
    const text = this.draft().trim();
    if (!text) return;
    this.draft.set('');
    await this.chat.sendMessage(text);
  }

  // Helper for templates that need to enumerate roles.
  trackMessage(_idx: number, msg: EditorMessage): string {
    return msg.id;
  }
}
