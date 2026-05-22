import { Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AdminStateService } from '../../pages/admin/admin-state.service';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }

@Component({
  selector: 'app-ai-chat-widget',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (!open()) {
      <button class="cw-trigger" (click)="toggle()" aria-label="Open AI chat" title="Ask AI (⌘/)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </button>
    } @else {
      <div class="cw-panel" role="dialog" aria-label="AI Chat">
        <header class="cw-head">
          <div class="flex items-center gap-2">
            <span class="cw-orb"></span>
            <span class="text-[0.78rem] font-semibold text-white">Ask AI</span>
            <span class="text-[0.6rem] uppercase tracking-wider text-text-secondary/70">MCP · Persona</span>
          </div>
          <button class="cw-x" (click)="toggle()" aria-label="Close">×</button>
        </header>
        <div class="cw-body" #scrollEl>
          @if (msgs().length === 0) {
            <div class="cw-empty">
              <p class="text-[0.78rem] text-white m-0 mb-2">Ask anything about this project — content, settings, debugging, ideas.</p>
              <div class="flex flex-wrap gap-1">
                @for (s of starters; track s) {
                  <button class="cw-chip" (click)="send(s)">{{ s }}</button>
                }
              </div>
            </div>
          } @else {
            @for (m of msgs(); track $index) {
              <div class="cw-msg" [class.is-user]="m.role === 'user'">
                <div class="cw-msg-role">{{ m.role === 'user' ? 'You' : 'AI' }}</div>
                <div class="cw-msg-body">{{ m.content }}</div>
              </div>
            }
            @if (busy()) {
              <div class="cw-msg">
                <div class="cw-msg-role">AI</div>
                <div class="cw-msg-body cw-typing"><span></span><span></span><span></span></div>
              </div>
            }
          }
        </div>
        <footer class="cw-foot">
          <textarea
            #inputEl
            class="cw-input"
            rows="1"
            placeholder="Message AI…  (Enter to send · Shift+Enter newline)"
            [(ngModel)]="draft"
            (keydown.enter)="onEnter($event)"></textarea>
          <button class="cw-send" (click)="sendDraft()" [disabled]="busy() || !draft.trim()" aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </footer>
      </div>
    }
  `,
  styles: [`
    :host { position: fixed; right: 18px; bottom: 18px; z-index: 60; }
    .cw-trigger { width: 52px; height: 52px; border-radius: 50%; border: 1px solid rgba(0,229,255,0.4); background: linear-gradient(135deg, rgba(124,58,237,0.95), rgba(0,229,255,0.85)); color: #06061a; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 12px 32px rgba(0,229,255,0.25), 0 0 0 1px rgba(255,255,255,0.05); transition: transform 200ms ease, box-shadow 200ms ease; }
    .cw-trigger:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 16px 38px rgba(0,229,255,0.35); }
    .cw-panel { width: 380px; max-width: calc(100vw - 36px); height: 540px; max-height: calc(100vh - 100px); background: rgba(10,10,26,0.96); backdrop-filter: blur(18px) saturate(140%); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,229,255,0.06); display: flex; flex-direction: column; overflow: hidden; animation: cwIn 180ms ease; }
    @keyframes cwIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
    .cw-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); background: linear-gradient(180deg, rgba(0,229,255,0.04), transparent); }
    .cw-orb { width: 10px; height: 10px; border-radius: 50%; background: radial-gradient(circle, #00E5FF, #7C3AED); box-shadow: 0 0 10px rgba(0,229,255,0.6); }
    .cw-x { background: transparent; border: 0; color: rgba(255,255,255,0.5); font-size: 1.4rem; line-height: 1; cursor: pointer; padding: 0 6px; }
    .cw-x:hover { color: #fff; }
    .cw-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
    .cw-empty { padding: 12px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 12px; background: rgba(255,255,255,0.02); }
    .cw-chip { font-size: 0.66rem; padding: 4px 9px; border-radius: 999px; background: rgba(0,229,255,0.06); color: rgba(255,255,255,0.78); border: 1px solid rgba(0,229,255,0.18); cursor: pointer; }
    .cw-chip:hover { background: rgba(0,229,255,0.12); border-color: rgba(0,229,255,0.35); }
    .cw-msg { display: flex; flex-direction: column; gap: 3px; }
    .cw-msg.is-user .cw-msg-body { align-self: flex-end; background: rgba(0,229,255,0.08); border-color: rgba(0,229,255,0.22); color: #fff; }
    .cw-msg-role { font-size: 0.58rem; uppercase: true; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.4); font-weight: 700; }
    .cw-msg-body { padding: 8px 11px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); color: rgba(255,255,255,0.88); font-size: 0.78rem; line-height: 1.45; white-space: pre-wrap; max-width: 100%; }
    .cw-typing { display: flex; gap: 4px; align-items: center; }
    .cw-typing span { width: 6px; height: 6px; border-radius: 50%; background: rgba(0,229,255,0.7); animation: cwBlink 1.2s infinite; }
    .cw-typing span:nth-child(2) { animation-delay: 0.18s; }
    .cw-typing span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes cwBlink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
    .cw-foot { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.25); }
    .cw-input { flex: 1; resize: none; max-height: 96px; min-height: 36px; padding: 8px 11px; border-radius: 10px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); color: #fff; font: inherit; font-size: 0.8rem; }
    .cw-input:focus { outline: none; border-color: rgba(0,229,255,0.45); }
    .cw-send { width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(0,229,255,0.35); background: rgba(0,229,255,0.12); color: #00E5FF; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
    .cw-send:disabled { opacity: 0.4; cursor: not-allowed; }
    @media (max-width: 480px) {
      .cw-panel { width: calc(100vw - 28px); right: 14px; height: 70vh; }
    }
  `],
})
export class AiChatWidgetComponent {
  private api = inject(ApiService);
  private state = inject(AdminStateService);

  open = signal(false);
  msgs = signal<ChatMsg[]>([]);
  busy = signal(false);
  draft = '';
  starters = ['Summarize my admin', 'What\'s broken?', 'How do I add a custom domain?', 'Explain MCP integrations'];

  @ViewChild('inputEl') inputEl?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollEl') scrollEl?: ElementRef<HTMLDivElement>;

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    // ⌘/ or Ctrl+/ — toggle the widget
    if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.toggle();
    }
  }

  toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) {
      requestAnimationFrame(() => this.inputEl?.nativeElement?.focus({ preventScroll: true }));
    }
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
    this.send(text);
  }

  send(text: string): void {
    this.msgs.update((m) => [...m, { role: 'user', content: text }]);
    this.scrollToBottom();
    this.busy.set(true);
    const siteId = this.state.selectedSite()?.id;
    const recent = this.msgs().slice(-8).map((m) => ({ role: m.role, content: m.content }));
    this.api.post<{ data: { reply: string } }>('/admin/ai-chat', { site_id: siteId, messages: recent }).subscribe({
      next: (r) => {
        this.msgs.update((m) => [...m, { role: 'assistant', content: r.data?.reply ?? '(no reply)' }]);
        this.busy.set(false);
        this.scrollToBottom();
      },
      error: () => {
        this.msgs.update((m) => [...m, { role: 'assistant', content: 'Sorry — chat is offline right now.' }]);
        this.busy.set(false);
      },
    });
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const el = this.scrollEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
