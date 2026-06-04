/**
 * @module components/ai-chat-widget
 *
 * @description
 * Floating launcher in the bottom-right corner of admin pages. Click → opens
 * the standard `<app-side-panel>` primitive from the right at half-screen
 * width and exposes a full conversation surface: switcher dropdown, message
 * list, slash-command palette, SSE-streamed response, and a tool-use loop
 * that lets the assistant request `navigate` / `set_theme` /
 * `open_help_topic` actions which the user confirms before they fire.
 *
 * The visual aesthetic is intentionally dark + sleek — a small ghost-styled
 * launcher button (no bright teal blobs), the side panel takes care of the
 * actual surface chrome. Cmd-K still belongs to the command palette; this
 * widget owns its own toggle (no global accelerator) so the two never race.
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
import { Router } from '@angular/router';
import { SidePanelComponent } from '../side-panel/side-panel.component';
import { AiChatService, type ChatMessage } from '../../services/ai-chat.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

/** Tool-call payload emitted by the assistant inside `<tool>…</tool>` tags. */
interface ToolCall {
  name: 'navigate' | 'set_theme' | 'open_help_topic';
  args: Record<string, string>;
}

/** A pending tool the user must confirm before it executes. */
interface PendingTool {
  id: string;
  call: ToolCall;
  /** Human-readable summary shown next to the confirm button. */
  label: string;
}

/** Slash-command descriptor for the in-input palette. */
interface SlashCommand {
  cmd: string;
  hint: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/help', hint: 'List available commands' },
  { cmd: '/clear', hint: 'Reset this conversation' },
  { cmd: '/export', hint: 'Download the conversation as Markdown' },
  { cmd: '/site <slug>', hint: 'Switch active site for assistant context' },
  { cmd: '/goto <route>', hint: 'Pre-render a navigation button' },
];

@Component({
  selector: 'app-ai-chat-widget',
  standalone: true,
  imports: [FormsModule, SidePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="cw-launcher"
      data-testid="aichat-launcher"
      aria-label="Open AI chat"
      (click)="openPanel()"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <span class="cw-launcher-label">Ask AI</span>
    </button>

    <app-side-panel
      [open]="open()"
      [widthFraction]="0.5"
      ariaLabel="AI chat"
      (closed)="closePanel()"
    >
      <span panelTitle>Ask AI</span>
      <span panelSubtitle>
        @if (chat.activeConversation(); as c) {
          {{ c.messages.length }} messages · {{ contextHint() }}
        } @else {
          New conversation · {{ contextHint() }}
        }
      </span>

      <div panelActions class="cw-actions">
        <select
          class="cw-switcher"
          data-testid="aichat-conversation-switcher"
          aria-label="Switch conversation"
          [value]="chat.activeId() ?? ''"
          (change)="onSwitchConversation($any($event.target).value)"
        >
          @if (chat.conversations().length === 0) {
            <option value="">No conversations yet</option>
          }
          @for (c of chat.conversations(); track c.id) {
            <option [value]="c.id">{{ c.title }}</option>
          }
        </select>
        <button
          type="button"
          class="cw-btn-ghost"
          data-testid="aichat-new"
          (click)="onNew()"
          aria-label="New conversation"
        >New</button>
        <button
          type="button"
          class="cw-btn-ghost"
          data-testid="aichat-export"
          (click)="onExport()"
          aria-label="Export conversation"
          [disabled]="(chat.messages().length === 0)"
        >Export</button>
      </div>

      <!-- Body wrapped in a panel-body proxy so panel scroll-area owns overflow. -->
      <div class="cw-feed" #feedEl data-testid="aichat-panel" aria-live="polite">
        @if (chat.messages().length === 0 && pendingTools().length === 0) {
          <div class="cw-empty">
            <p class="cw-empty-title">Begin.</p>
            <p class="cw-empty-sub">
              One line is enough. Type <code>/help</code> for the commands.
            </p>
            <div class="cw-chips">
              @for (s of starters; track s) {
                <button type="button" class="cw-chip" (click)="sendText(s)">{{ s }}</button>
              }
            </div>
          </div>
        }

        @for (m of chat.messages(); track m.id; let i = $index) {
          <article
            class="cw-msg"
            [class.is-user]="m.role === 'user'"
            [class.is-tool]="m.role === 'tool'"
            [attr.data-testid]="'aichat-message-' + i"
          >
            <header class="cw-msg-role">
              @if (m.role === 'tool') {
                tool · {{ m.toolName }}
              } @else {
                {{ m.role === 'user' ? 'You' : 'Assistant' }}
              }
            </header>
            <div class="cw-msg-body">{{ m.content }}</div>
          </article>
        }

        @if (busy()) {
          <div class="cw-msg">
            <header class="cw-msg-role">Assistant</header>
            <div class="cw-msg-body cw-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        }

        @for (p of pendingTools(); track p.id) {
          <div class="cw-tool-card">
            <div class="cw-tool-summary">
              <strong>{{ p.call.name }}</strong>
              <span>{{ p.label }}</span>
            </div>
            <div class="cw-tool-row">
              <button
                type="button"
                class="cw-btn-primary"
                [attr.data-testid]="p.call.name === 'navigate' ? 'aichat-tool-navigate-confirm' : 'aichat-tool-' + p.call.name + '-confirm'"
                (click)="confirmTool(p)"
              >Run</button>
              <button
                type="button"
                class="cw-btn-ghost"
                (click)="dismissTool(p)"
              >Dismiss</button>
            </div>
          </div>
        }
      </div>

      <div panelFooter class="cw-foot">
        @if (slashOpen()) {
          <div class="cw-slash-menu" role="listbox" aria-label="Slash commands">
            @for (s of filteredSlash(); track s.cmd) {
              <button
                type="button"
                class="cw-slash-item"
                (click)="applySlash(s.cmd)"
              >
                <code>{{ s.cmd }}</code>
                <span>{{ s.hint }}</span>
              </button>
            }
          </div>
        }
        <div class="cw-input-row">
          <textarea
            #inputEl
            class="cw-input"
            data-testid="aichat-input"
            rows="1"
            placeholder="Message AI… (Enter to send · Shift+Enter newline · / for commands)"
            [(ngModel)]="draft"
            (ngModelChange)="onDraftChange($event)"
            (keydown.enter)="onEnter($event)"
            (keydown.escape)="slashOpen.set(false)"
            aria-label="Message AI"
          ></textarea>
          <button
            type="button"
            class="cw-send"
            data-testid="aichat-send"
            (click)="sendDraft()"
            [disabled]="busy() || !draft.trim()"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </app-side-panel>
  `,
  styles: [`
    :host { position: fixed; right: 18px; bottom: 18px; z-index: 60; }

    /* ── Launcher ── */
    .cw-launcher {
      display: inline-flex; align-items: center; gap: 8px;
      height: 38px; padding: 0 14px 0 12px;
      border-radius: 999px;
      background: rgba(10, 10, 26, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
      cursor: pointer;
      transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
    }
    .cw-launcher:hover {
      transform: translateY(-1px);
      background: rgba(14, 14, 32, 0.85);
      border-color: rgba(255, 255, 255, 0.16);
    }
    .cw-launcher:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00E5FF);
      outline-offset: 2px;
    }
    .cw-launcher-label {
      font-size: 0.78rem; font-weight: 500; letter-spacing: 0.01em;
    }

    /* ── Side-panel actions ── */
    .cw-actions { display: inline-flex; align-items: center; gap: 6px; }
    .cw-switcher {
      height: 28px; max-width: 160px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 0.74rem; padding: 0 6px;
    }
    .cw-btn-ghost {
      height: 28px; padding: 0 10px;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 0.72rem; cursor: pointer;
      transition: background 140ms ease, border-color 140ms ease;
    }
    .cw-btn-ghost:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.18);
    }
    .cw-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
    .cw-btn-primary {
      height: 28px; padding: 0 12px;
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.35);
      border-radius: 6px; color: #c8f7ff;
      font-size: 0.72rem; cursor: pointer;
    }
    .cw-btn-primary:hover { background: rgba(0, 229, 255, 0.2); }

    /* ── Feed ── */
    .cw-feed {
      display: flex; flex-direction: column; gap: 12px;
      padding: 4px 2px;
    }
    .cw-empty {
      padding: 16px;
      border: 1px dashed rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
    }
    .cw-empty-title {
      margin: 0 0 4px;
      font-size: 0.82rem; font-weight: 600; color: #fff;
    }
    .cw-empty-sub {
      margin: 0 0 10px;
      font-size: 0.74rem; line-height: 1.45;
      color: rgba(255, 255, 255, 0.62);
    }
    .cw-empty code {
      font-size: 0.7rem; padding: 1px 5px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 4px;
    }
    .cw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .cw-chip {
      font-size: 0.7rem; padding: 4px 9px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      color: rgba(255, 255, 255, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
    }
    .cw-chip:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .cw-msg { display: flex; flex-direction: column; gap: 3px; }
    .cw-msg.is-user .cw-msg-body {
      align-self: flex-end;
      background: rgba(0, 229, 255, 0.06);
      border-color: rgba(0, 229, 255, 0.18);
    }
    .cw-msg.is-tool .cw-msg-body {
      background: rgba(124, 58, 237, 0.08);
      border-color: rgba(124, 58, 237, 0.25);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem;
    }
    .cw-msg-role {
      font-size: 0.58rem; text-transform: uppercase;
      letter-spacing: 0.08em; font-weight: 700;
      color: rgba(255, 255, 255, 0.42);
    }
    .cw-msg-body {
      padding: 8px 11px; border-radius: 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.88);
      font-size: 0.78rem; line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
    }
    .cw-typing { display: inline-flex; gap: 4px; align-items: center; }
    .cw-typing span {
      width: 5px; height: 5px; border-radius: 50%;
      background: rgba(0, 229, 255, 0.65);
      animation: cwBlink 1.2s infinite;
    }
    .cw-typing span:nth-child(2) { animation-delay: 0.18s; }
    .cw-typing span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes cwBlink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

    /* ── Tool cards ── */
    .cw-tool-card {
      padding: 10px 12px; border-radius: 10px;
      background: rgba(124, 58, 237, 0.07);
      border: 1px solid rgba(124, 58, 237, 0.25);
      display: flex; flex-direction: column; gap: 8px;
    }
    .cw-tool-summary {
      display: flex; align-items: baseline; gap: 8px;
      font-size: 0.76rem; color: rgba(255, 255, 255, 0.88);
    }
    .cw-tool-summary strong {
      font-size: 0.66rem; text-transform: uppercase;
      letter-spacing: 0.06em; color: rgba(255, 255, 255, 0.55);
    }
    .cw-tool-row { display: flex; gap: 6px; }

    /* ── Footer / input ── */
    .cw-foot { position: relative; padding: 10px 12px; }
    .cw-input-row { display: flex; gap: 8px; align-items: flex-end; }
    .cw-input {
      flex: 1; resize: none;
      max-height: 120px; min-height: 36px;
      padding: 8px 11px; border-radius: 10px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #fff; font: inherit; font-size: 0.8rem;
    }
    .cw-input:focus {
      outline: none;
      border-color: rgba(0, 229, 255, 0.4);
    }
    .cw-send {
      width: 36px; height: 36px; border-radius: 10px;
      border: 1px solid rgba(0, 229, 255, 0.32);
      background: rgba(0, 229, 255, 0.08);
      color: #8be9fd;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0;
    }
    .cw-send:disabled { opacity: 0.4; cursor: not-allowed; }
    .cw-send:hover:not(:disabled) { background: rgba(0, 229, 255, 0.16); }

    .cw-slash-menu {
      position: absolute; left: 12px; right: 12px; bottom: calc(100% - 4px);
      background: rgba(8, 8, 22, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
      padding: 4px; display: flex; flex-direction: column;
      max-height: 220px; overflow-y: auto;
    }
    .cw-slash-item {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 6px 8px;
      background: transparent; border: 0; border-radius: 6px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 0.74rem; text-align: left; cursor: pointer;
    }
    .cw-slash-item:hover { background: rgba(255, 255, 255, 0.05); }
    .cw-slash-item code {
      font-size: 0.7rem; color: #8be9fd;
    }
    .cw-slash-item span {
      font-size: 0.68rem; color: rgba(255, 255, 255, 0.55);
    }

    @media (prefers-reduced-motion: reduce) {
      .cw-launcher { transition: none; }
      .cw-typing span { animation: none; }
    }
  `],
})
export class AiChatWidgetComponent {
  protected readonly chat = inject(AiChatService);
  private readonly state = inject(AdminStateService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // ── UI state ──
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly slashOpen = signal(false);
  readonly pendingTools = signal<PendingTool[]>([]);
  draft = '';

  // Persona-voice warm-up prompts. Mirrors the HBO Jewish Christ-like
  // executive tone defined in `src/prompts/dashboard_persona.ts` — short,
  // declarative, action-shaped. Click sends the line verbatim.
  readonly starters = [
    'Bring me a problem.',
    "What are we shipping today?",
    'Anything goes. I prefer specifics.',
    "What's broken?",
  ];

  readonly contextHint = computed<string>(() => {
    const slug = this.state.selectedSite()?.slug;
    return slug ? `Site: ${slug}` : 'No site selected';
  });

  readonly filteredSlash = computed<SlashCommand[]>(() => {
    const q = this.draft.trim().toLowerCase();
    if (!q.startsWith('/')) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((s) => s.cmd.startsWith(q));
  });

  @ViewChild('inputEl') inputEl?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('feedEl') feedEl?: ElementRef<HTMLDivElement>;

  constructor() {
    // Auto-scroll feed when message count grows.
    effect(() => {
      this.chat.messages();
      this.pendingTools();
      queueMicrotask(() => this.scrollFeed());
    });
  }

  // ─────────── lifecycle ───────────

  openPanel(): void {
    this.open.set(true);
    if (!this.chat.activeId()) this.chat.newConversation();
    requestAnimationFrame(() =>
      this.inputEl?.nativeElement?.focus({ preventScroll: true }),
    );
  }

  closePanel(): void {
    this.open.set(false);
    this.slashOpen.set(false);
  }

  // ─────────── conversation actions ───────────

  onNew(): void {
    this.chat.newConversation();
    this.pendingTools.set([]);
    requestAnimationFrame(() => this.inputEl?.nativeElement?.focus());
  }

  onSwitchConversation(id: string): void {
    if (!id) return;
    this.chat.selectConversation(id);
    this.pendingTools.set([]);
  }

  onExport(): void {
    const blob = this.chat.exportActive();
    if (blob.size === 0) {
      this.toast.warning('Nothing to export yet.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-chat-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ─────────── input ───────────

  onDraftChange(value: string): void {
    this.draft = value;
    this.slashOpen.set(value.trimStart().startsWith('/'));
  }

  onEnter(e: Event): void {
    const ev = e as KeyboardEvent;
    if (ev.shiftKey) return;
    ev.preventDefault();
    this.sendDraft();
  }

  sendDraft(): void {
    const text = this.draft.trim();
    if (!text) return;
    this.draft = '';
    this.slashOpen.set(false);
    this.sendText(text);
  }

  applySlash(cmd: string): void {
    // Trim placeholder e.g. "/site <slug>" → "/site ".
    const cleaned = cmd.replace(/<[^>]+>/, '').trim();
    this.draft = cleaned + ' ';
    this.slashOpen.set(true);
    requestAnimationFrame(() => this.inputEl?.nativeElement?.focus());
  }

  // ─────────── slash command handling ───────────

  private handleSlash(text: string): boolean {
    const [head, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (head) {
      case '/help': {
        this.chat.addMessage('user', text);
        const help =
          'Available commands:\n' +
          SLASH_COMMANDS.map((s) => `  ${s.cmd} — ${s.hint}`).join('\n');
        this.chat.addMessage('assistant', help);
        return true;
      }
      case '/clear':
        this.chat.clearActive();
        this.pendingTools.set([]);
        return true;
      case '/export':
        this.onExport();
        return true;
      case '/site': {
        if (!arg) {
          this.toast.warning('Usage: /site <slug>');
          return true;
        }
        const match = this.state.sites().find((s) => s.slug === arg);
        if (!match) {
          this.toast.error(`No site matches slug '${arg}'.`);
          return true;
        }
        this.state.selectSite(match);
        this.chat.addMessage('tool', `Active site switched to ${arg}.`, 'site');
        return true;
      }
      case '/goto': {
        if (!arg) {
          this.toast.warning('Usage: /goto <route>');
          return true;
        }
        const route = arg.startsWith('/') ? arg : `/${arg}`;
        this.queueTool({
          name: 'navigate',
          args: { to: route },
        });
        return true;
      }
      default:
        return false;
    }
  }

  // ─────────── send + stream ───────────

  sendText(text: string): void {
    if (text.startsWith('/') && this.handleSlash(text)) return;

    this.chat.addMessage('user', text);
    this.chat.addMessage('assistant', '');
    this.busy.set(true);

    // Build a clean wire payload (omit our internal `tool` messages from history).
    const history: { role: 'user' | 'assistant'; content: string }[] = this.chat
      .messages()
      .filter((m): m is ChatMessage => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const ctrl = new AbortController();
    const body = JSON.stringify({
      conversation: history,
      context: {
        selected_site_id: this.state.selectedSite()?.id ?? null,
        current_route: this.router.url ?? '/',
      },
    });

    const token = this.auth.getToken();
    fetch('/api/admin/ai/stream/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: ctrl.signal,
    })
      .then((res) => this.consumeStream(res))
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        this.chat.updateLastMessage(
          'Sorry — chat is offline right now. Try again in a moment.',
        );
        this.busy.set(false);
      });
  }

  private async consumeStream(res: Response): Promise<void> {
    if (!res.ok || !res.body) {
      this.chat.updateLastMessage(
        `Chat error (${res.status}). Try again or open a support ticket.`,
      );
      this.busy.set(false);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assembled = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          const parsed = JSON.parse(json) as {
            chunk?: string;
            tool?: ToolCall;
            done?: boolean;
            error?: { code: string; message: string };
          };
          if (parsed.chunk) {
            assembled += parsed.chunk;
            // Strip any in-flight `<tool>…</tool>` envelopes from the visible
            // assistant body — tool calls render as their own card.
            const visible = assembled.replace(/<tool>[\s\S]*?<\/tool>/g, '').trim();
            this.chat.updateLastMessage(visible);
          }
          if (parsed.tool) {
            this.queueTool(parsed.tool);
          }
          if (parsed.error) {
            this.toast.error(parsed.error.message);
          }
          if (parsed.done) {
            this.busy.set(false);
          }
        } catch {
          /* malformed frame — skip silently. */
        }
      }
    }
    this.busy.set(false);
  }

  // ─────────── tool-use loop ───────────

  private queueTool(call: ToolCall): void {
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const label = this.summarizeTool(call);
    this.pendingTools.update((list) => [...list, { id, call, label }]);
  }

  protected confirmTool(p: PendingTool): void {
    this.pendingTools.update((list) => list.filter((x) => x.id !== p.id));
    this.runTool(p.call);
  }

  protected dismissTool(p: PendingTool): void {
    this.pendingTools.update((list) => list.filter((x) => x.id !== p.id));
    this.chat.addMessage('tool', `Dismissed ${p.call.name}.`, p.call.name);
  }

  private runTool(call: ToolCall): void {
    switch (call.name) {
      case 'navigate': {
        const to = call.args['to'] || '/admin';
        this.router.navigate([to]);
        this.flashGlow();
        this.chat.addMessage('tool', `Navigated to ${to}.`, 'navigate');
        return;
      }
      case 'set_theme': {
        const theme = (call.args['theme'] || 'dark').toLowerCase();
        try {
          document.documentElement.setAttribute('data-theme', theme);
          localStorage.setItem('ps_theme', theme);
        } catch {
          /* private mode */
        }
        this.chat.addMessage('tool', `Theme set to ${theme}.`, 'set_theme');
        return;
      }
      case 'open_help_topic': {
        const topic = call.args['topic'] || 'overview';
        const overlay = document.querySelector('app-shortcuts-overlay');
        if (overlay) {
          (overlay as HTMLElement).dispatchEvent(
            new CustomEvent('open', { bubbles: true }),
          );
        } else {
          this.router.navigate(['/admin/docs'], { fragment: topic });
        }
        this.chat.addMessage('tool', `Opened help: ${topic}.`, 'open_help_topic');
        return;
      }
      default:
        this.toast.warning(`Unknown tool: ${(call as ToolCall).name}`);
    }
  }

  private summarizeTool(call: ToolCall): string {
    switch (call.name) {
      case 'navigate':
        return `Go to ${call.args['to'] || '/'}`;
      case 'set_theme':
        return `Switch theme to ${call.args['theme'] || 'dark'}`;
      case 'open_help_topic':
        return `Open help: ${call.args['topic'] || 'overview'}`;
    }
  }

  private flashGlow(): void {
    const reduceMotion =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    document.body.classList.add('ai-glow');
    setTimeout(() => document.body.classList.remove('ai-glow'), 600);
  }

  private scrollFeed(): void {
    const el = this.feedEl?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
