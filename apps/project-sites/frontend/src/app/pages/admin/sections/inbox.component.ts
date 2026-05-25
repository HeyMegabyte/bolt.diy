import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { FocusTrapDirective } from '../../../directives/focus-trap.directive';

/**
 * Pulse Inbox — unified conversation hub.
 *
 * 3-column layout:
 *   LEFT 320px  — conversation list + filter chips + fuzzy search
 *   CENTER 1fr  — thread view + composer (reply/note toggle)
 *   RIGHT 320px — contact details + previous conversations + tags
 *
 * Realtime via WebSocket → `wss://projectsites.dev/api/inbox/ws/:conversation_id`
 * (backend owned by sibling agent — `conversation_hub.ts` DO).
 *
 * Optimistic-write composer: append message to local state first, send via WS,
 * backend writes to D1. Reconnect with exponential backoff. Presence dots
 * shown when contact is currently connected to the public widget.
 */

interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  external_ids?: Record<string, string>;
  custom_attributes?: Record<string, string>;
  tags?: string[];
  is_present?: boolean;
}

type ChannelKind = 'email' | 'slack' | 'discord' | 'telegram' | 'website' | 'sms';
type ConversationStatus = 'open' | 'pending' | 'snoozed' | 'resolved';
type Sentiment = 'positive' | 'neutral' | 'negative' | null;
type SenderType = 'agent' | 'contact' | 'ai';
type MessageKind = 'reply' | 'note';

interface Conversation {
  id: string;
  contact: Contact;
  channel: ChannelKind;
  status: ConversationStatus;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  assignee_id?: string | null;
  assignee_name?: string | null;
  unread_count: number;
  sentiment?: Sentiment;
  last_message_preview: string;
  last_message_at: string;
  snoozed_until?: string | null;
}

interface InboxMessage {
  id: string;
  conversation_id: string;
  body: string;
  sender_type: SenderType;
  sender_name?: string;
  kind: MessageKind;
  ai_confidence?: number | null;
  attachments?: { r2_key: string; name: string; size: number; type: string }[];
  created_at: string;
  pending?: boolean;
}

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

interface Agent {
  id: string;
  name: string;
  email: string;
}

type FilterChip = 'all' | 'mine' | 'unassigned' | 'open' | 'snoozed' | 'resolved';

@Component({
  selector: 'app-admin-inbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgClass, DatePipe, RevealDirective, RollingCounterComponent, FocusTrapDirective],
  template: `
    <div class="inbox-shell" role="application" aria-label="Pulse Inbox">

      <!-- ═══════════════════════════════════════════════════ LEFT RAIL -->
      <aside class="inbox-left" aria-label="Conversations">
        <header class="left-head">
          <div class="left-title">
            <span class="left-glyph" aria-hidden="true">💬</span>
            <h1>Inbox</h1>
            <span class="left-count" aria-label="Unread total">
              <app-rolling-counter [value]="totalUnread()" [duration]="700" />
            </span>
          </div>

          <input
            #searchInput
            class="left-search"
            type="search"
            placeholder="Search contact or message…"
            [(ngModel)]="searchQueryModel"
            (ngModelChange)="searchQuery.set($event)"
            aria-label="Search conversations"
          />

          <div class="left-chips" role="tablist" aria-label="Conversation filters">
            @for (chip of filterChips; track chip.id) {
              <button
                role="tab"
                type="button"
                class="chip"
                [class.chip-active]="activeFilter() === chip.id"
                [attr.aria-selected]="activeFilter() === chip.id"
                (click)="setFilter(chip.id)"
              >{{ chip.label }}<span class="chip-count" aria-hidden="true">{{ chip.count() }}</span></button>
            }
          </div>
        </header>

        <ol class="left-list" role="listbox" aria-label="Conversations list" (keydown)="onListKey($event)">
          @if (loading()) {
            @for (n of skeletonRows; track n) {
              <li class="row row-skel" aria-hidden="true">
                <div class="skel skel-avatar"></div>
                <div class="skel-stack">
                  <div class="skel skel-line skel-line-1"></div>
                  <div class="skel skel-line skel-line-2"></div>
                </div>
              </li>
            }
          } @else if (filteredConversations().length === 0) {
            <li class="row-empty" appReveal>
              <div class="empty-glyph" aria-hidden="true">📭</div>
              <h3>{{ activeFilter() === 'all' ? 'No conversations yet' : 'Nothing here' }}</h3>
              <p>{{ emptyHint() }}</p>
            </li>
          } @else {
            @for (c of filteredConversations(); track c.id; let i = $index) {
              <li
                role="option"
                class="row"
                [class.row-active]="selectedId() === c.id"
                [attr.aria-selected]="selectedId() === c.id"
                [attr.data-conversation-id]="c.id"
                tabindex="0"
                appReveal [revealDelay]="i * 30"
                (click)="selectConversation(c)"
                (keydown.enter)="selectConversation(c)"
              >
                <div class="row-avatar" [attr.aria-label]="c.contact.name + ' avatar'">
                  @if (c.contact.avatar_url) {
                    <img [src]="c.contact.avatar_url" alt="" loading="lazy" decoding="async" />
                  } @else {
                    <span aria-hidden="true">{{ initials(c.contact.name) }}</span>
                  }
                  @if (c.contact.is_present) {
                    <span class="presence-dot" aria-label="Contact is online"></span>
                  }
                </div>
                <div class="row-body">
                  <div class="row-head">
                    <span class="row-name">{{ c.contact.name }}</span>
                    <span class="row-channel" [attr.title]="'Channel: ' + c.channel" aria-hidden="true">
                      {{ channelGlyph(c.channel) }}
                    </span>
                    @if (c.sentiment) {
                      <span class="row-sentiment" [attr.title]="'Sentiment: ' + c.sentiment" aria-hidden="true">
                        {{ sentimentGlyph(c.sentiment) }}
                      </span>
                    }
                    <time class="row-time" [attr.datetime]="c.last_message_at">{{ relativeTime(c.last_message_at) }}</time>
                  </div>
                  <p class="row-preview">{{ c.last_message_preview }}</p>
                  <div class="row-meta">
                    <span class="status-pill" [ngClass]="'status-' + c.status">{{ c.status }}</span>
                    @if (c.unread_count > 0) {
                      <span class="unread-badge" [attr.aria-label]="c.unread_count + ' unread'">{{ c.unread_count }}</span>
                    }
                  </div>
                </div>
              </li>
            }
          }
        </ol>
      </aside>

      <!-- ═══════════════════════════════════════════════════ CENTER -->
      <section class="inbox-center" aria-label="Thread">
        @if (!selectedConversation()) {
          <div class="empty-thread" appReveal>
            <div class="empty-glyph empty-glyph-lg" aria-hidden="true">✨</div>
            <h2>Pick a conversation</h2>
            <p>Or open a public widget at <code>https://projectsites.dev/widget.js?inbox=YOUR_ID</code> and chat into your own inbox.</p>
          </div>
        } @else {
          <header class="thread-head">
            <div class="thread-who">
              <div class="row-avatar" aria-hidden="true">
                @if (selectedConversation()!.contact.avatar_url) {
                  <img [src]="selectedConversation()!.contact.avatar_url" alt="" />
                } @else {
                  <span>{{ initials(selectedConversation()!.contact.name) }}</span>
                }
              </div>
              <div>
                <div class="thread-name">{{ selectedConversation()!.contact.name }}</div>
                <div class="thread-sub">
                  <span>{{ channelLabel(selectedConversation()!.channel) }}</span>
                  @if (selectedConversation()!.contact.email) {
                    <span>·</span>
                    <a [href]="'mailto:' + selectedConversation()!.contact.email">{{ selectedConversation()!.contact.email }}</a>
                  }
                  @if (wsState() === 'connected') { <span class="ws-dot" aria-label="Realtime connected"></span> }
                  @if (wsState() === 'reconnecting') { <span class="ws-dot ws-dot-warn" aria-label="Reconnecting"></span> }
                </div>
              </div>
            </div>

            <div class="thread-controls">
              <label class="ctrl-select">
                <span class="ctrl-label">Assignee</span>
                <select [ngModel]="selectedConversation()!.assignee_id ?? ''" (ngModelChange)="onAssign($event)" aria-label="Assignee">
                  <option value="">Unassigned</option>
                  @for (a of agents(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                </select>
              </label>
              <label class="ctrl-select">
                <span class="ctrl-label">Status</span>
                <select [ngModel]="selectedConversation()!.status" (ngModelChange)="onStatus($event)" aria-label="Status">
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="snoozed">Snoozed</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              <label class="ctrl-select">
                <span class="ctrl-label">Priority</span>
                <select [ngModel]="selectedConversation()!.priority ?? 'normal'" (ngModelChange)="onPriority($event)" aria-label="Priority">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <button type="button" class="btn-resolve" (click)="resolve()" [disabled]="selectedConversation()!.status === 'resolved'">
                Resolve
              </button>
            </div>
          </header>

          <ol #threadList class="thread-list" role="log" aria-live="polite" aria-label="Messages">
            @for (m of messages(); track m.id) {
              <li
                class="msg"
                [ngClass]="{
                  'msg-in': m.sender_type === 'contact',
                  'msg-out': m.sender_type === 'agent',
                  'msg-ai': m.sender_type === 'ai',
                  'msg-note': m.kind === 'note',
                  'msg-pending': m.pending,
                }"
              >
                <div class="msg-bubble">
                  @if (m.kind === 'note') {
                    <span class="badge-note" aria-label="Internal note">INTERNAL NOTE</span>
                  }
                  @if (m.sender_type === 'ai') {
                    <span class="badge-ai" [attr.title]="aiConfidenceLabel(m.ai_confidence)">
                      ✨ AI
                      @if (m.ai_confidence != null) {
                        <span class="ai-pill">{{ aiConfidencePct(m.ai_confidence) }}%</span>
                      }
                    </span>
                  }
                  <div class="msg-body">{{ m.body }}</div>
                  @if (m.attachments?.length) {
                    <ul class="msg-attach" aria-label="Attachments">
                      @for (a of m.attachments; track a.r2_key) {
                        <li><a [href]="attachmentUrl(a.r2_key)" target="_blank" rel="noopener">{{ a.name }}</a></li>
                      }
                    </ul>
                  }
                </div>
                <div class="msg-meta">
                  <span>{{ m.sender_name ?? senderLabel(m.sender_type) }}</span>
                  <span>·</span>
                  <time [attr.datetime]="m.created_at">{{ m.created_at | date:'shortTime' }}</time>
                  @if (m.pending) { <span class="pending-tag">sending…</span> }
                </div>
              </li>
            }
            @if (contactTyping()) {
              <li class="msg msg-in msg-typing" aria-live="polite">
                <div class="msg-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
                <div class="msg-meta">{{ selectedConversation()!.contact.name }} is typing…</div>
              </li>
            }
          </ol>

          <footer class="composer" role="form" aria-label="Reply composer" (dragover)="onDragOver($event)" (drop)="onDrop($event)">
            <div class="composer-tabs" role="tablist">
              <button role="tab" type="button" class="ct" [class.ct-active]="composerMode() === 'reply'" [attr.aria-selected]="composerMode() === 'reply'" (click)="composerMode.set('reply')">Reply</button>
              <button role="tab" type="button" class="ct ct-note" [class.ct-active]="composerMode() === 'note'" [attr.aria-selected]="composerMode() === 'note'" (click)="composerMode.set('note')">Note</button>
            </div>

            <textarea
              #composerInput
              class="composer-input"
              [class.composer-note]="composerMode() === 'note'"
              [(ngModel)]="draftModel"
              (ngModelChange)="onDraftChange($event)"
              (keydown)="onComposerKey($event)"
              [attr.placeholder]="composerMode() === 'note' ? 'Internal note — only your team sees this. Cmd+Shift+Enter sends.' : 'Reply to ' + selectedConversation()!.contact.name + ' — / for canned, Cmd+Enter sends.'"
              aria-label="Composer"
              rows="3"
            ></textarea>

            @if (cannedOpen()) {
              <div class="canned-pop" role="listbox" aria-label="Canned responses">
                @for (cr of filteredCanned(); track cr.id) {
                  <button type="button" role="option" class="canned-row" (click)="pickCanned(cr)">
                    <code>/{{ cr.shortcut }}</code>
                    <span>{{ cr.title }}</span>
                    <em>{{ cannedPreview(cr.body) }}</em>
                  </button>
                }
                @if (filteredCanned().length === 0) {
                  <div class="canned-empty">No canned response matches. <a href="/admin/settings#inbox-canned">Create one →</a></div>
                }
              </div>
            }

            @if (pendingAttachments().length > 0) {
              <ul class="attach-strip" aria-label="Pending attachments">
                @for (a of pendingAttachments(); track a.r2_key) {
                  <li>{{ a.name }} <button type="button" (click)="removeAttachment(a.r2_key)" [attr.aria-label]="'Remove ' + a.name">×</button></li>
                }
              </ul>
            }

            <div class="composer-bar">
              <button type="button" class="cb" (click)="attachInput.click()" aria-label="Attach file" title="Attach (drag-drop also works)">📎</button>
              <input #attachInput type="file" multiple hidden (change)="onAttach($event)" />
              <button type="button" class="cb" (click)="toggleCanned()" aria-label="Canned responses" title="Canned response (type /)">⌨</button>
              <button type="button" class="cb cb-ai" (click)="aiAssist()" [disabled]="aiBusy()" aria-label="AI assist — draft 3 reply variants" title="AI draft 3 replies">
                {{ aiBusy() ? '…' : '✨' }} AI assist
              </button>
              <div class="composer-spacer"></div>
              <span class="hint" aria-hidden="true">⌘↵ {{ composerMode() === 'reply' ? 'send' : 'add note' }}</span>
              <button type="button" class="btn-send" (click)="sendMessage()" [disabled]="!draftModel.trim() && pendingAttachments().length === 0">
                {{ composerMode() === 'reply' ? 'Send' : 'Add note' }}
              </button>
            </div>

            @if (aiDrafts().length > 0) {
              <div class="ai-drafts" role="region" aria-label="AI draft variants" [focusTrap]="true">
                <div class="ai-drafts-head">
                  <span>✨ AI drafts</span>
                  <button type="button" class="cb" (click)="aiDrafts.set([])" aria-label="Dismiss drafts">×</button>
                </div>
                @for (d of aiDrafts(); track d) {
                  <button type="button" class="ai-draft-row" (click)="useDraft(d)">{{ d }}</button>
                }
              </div>
            }
          </footer>
        }
      </section>

      <!-- ═══════════════════════════════════════════════════ RIGHT RAIL -->
      <aside class="inbox-right" aria-label="Contact details">
        @if (!selectedConversation()) {
          <div class="right-empty">
            <p>Open a conversation to see contact context, custom attributes, and conversation history.</p>
          </div>
        } @else {
          @let c = selectedConversation()!.contact;
          <header class="right-head" appReveal>
            <div class="row-avatar row-avatar-lg" aria-hidden="true">
              @if (c.avatar_url) { <img [src]="c.avatar_url" alt="" /> } @else { <span>{{ initials(c.name) }}</span> }
            </div>
            <div class="right-name">{{ c.name }}</div>
            <div class="right-sub">
              @if (c.email) { <a [href]="'mailto:' + c.email">{{ c.email }}</a> }
              @if (c.phone) { <a [href]="'tel:' + c.phone">{{ c.phone }}</a> }
            </div>
          </header>

          <section class="right-block" appReveal [revealDelay]="60">
            <h3>Custom attributes</h3>
            <dl class="kv">
              @for (entry of attributeEntries(); track entry.key) {
                <div>
                  <dt>{{ entry.key }}</dt>
                  <dd>
                    <input
                      class="kv-input"
                      [value]="entry.value"
                      (blur)="saveAttribute(entry.key, $any($event.target).value)"
                      [attr.aria-label]="entry.key + ' value'"
                    />
                  </dd>
                </div>
              }
              @if (attributeEntries().length === 0) {
                <div class="kv-empty">No custom attributes yet. Add them via the API or the contact details endpoint.</div>
              }
            </dl>
          </section>

          <section class="right-block" appReveal [revealDelay]="120">
            <h3>Tags</h3>
            <div class="tag-row">
              @for (t of c.tags ?? []; track t) {
                <span class="tag">{{ t }}<button type="button" (click)="removeTag(t)" [attr.aria-label]="'Remove tag ' + t">×</button></span>
              }
              <input
                class="tag-input"
                [(ngModel)]="newTag"
                (keydown.enter)="addTag()"
                placeholder="+ tag"
                aria-label="Add tag"
              />
            </div>
          </section>

          <section class="right-block" appReveal [revealDelay]="180">
            <h3>Previous conversations</h3>
            <ul class="prev-list">
              @for (p of previousConversations(); track p.id) {
                <li>
                  <button type="button" (click)="selectConversation(p)">
                    <span>{{ channelGlyph(p.channel) }}</span>
                    <span>{{ p.last_message_preview }}</span>
                    <time>{{ relativeTime(p.last_message_at) }}</time>
                  </button>
                </li>
              }
              @if (previousConversations().length === 0) {
                <li class="prev-empty">First time chatting with us.</li>
              }
            </ul>
          </section>

          <section class="right-block" appReveal [revealDelay]="240">
            <h3>Install the widget</h3>
            <p class="widget-blurb">Drop this on any site to route visitor chats here.</p>
            <pre class="widget-snippet" aria-label="Widget install snippet"><code>&lt;script async src="https://projectsites.dev/widget.js?inbox={{ inboxId() }}"&gt;&lt;/script&gt;</code></pre>
            <button type="button" class="cb cb-wide" (click)="copyWidgetSnippet()">Copy snippet</button>
          </section>
        }
      </aside>
    </div>
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
      display: block;
      height: calc(100vh - 62px);
      overflow: hidden;
      background: var(--ps-bg, #060610);
      color: var(--ps-ink, #f4f4ff);
    }

    .inbox-shell {
      display: grid;
      grid-template-columns: 320px 1fr 320px;
      height: 100%;
      min-height: 0;
    }

    @media (max-width: 1100px) {
      .inbox-shell { grid-template-columns: 280px 1fr; }
      .inbox-right { display: none; }
    }
    @media (max-width: 720px) {
      .inbox-shell { grid-template-columns: 1fr; }
      .inbox-left { display: var(--mobile-left, block); }
      .inbox-center { display: var(--mobile-center, none); }
    }

    /* ── Left rail ─────────────────────────────── */
    .inbox-left {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid rgba(255,255,255,0.06);
      background: rgba(8, 8, 20, 0.4);
      backdrop-filter: blur(8px);
    }
    .left-head {
      padding: 14px 14px 8px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      display: flex; flex-direction: column; gap: 10px;
    }
    .left-title {
      display: flex; align-items: center; gap: 10px;
    }
    .left-title h1 {
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 1.05rem; font-weight: 600; margin: 0;
      letter-spacing: -0.01em;
    }
    .left-glyph { font-size: 1.1rem; }
    .left-count {
      margin-left: auto;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.78rem;
      padding: 2px 8px;
      border-radius: 8px;
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 16%, transparent);
      color: oklch(from var(--ps-accent, #00e5ff) max(l, 0.78) max(c, 0.22) h);
    }
    .left-search {
      appearance: none;
      width: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.3);
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.85rem;
      min-height: 36px;
    }
    .left-search:focus-visible {
      outline: 2px solid var(--ps-accent, #00e5ff);
      outline-offset: 1px;
      border-color: transparent;
    }
    .left-chips {
      display: flex; gap: 4px; flex-wrap: wrap;
    }
    .chip {
      appearance: none; border: 0; cursor: pointer;
      min-height: 28px;
      padding: 4px 9px;
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
      font-size: 0.74rem;
      display: inline-flex; align-items: baseline; gap: 6px;
      transition: background 160ms var(--ease-cinematic), color 160ms;
    }
    .chip:hover { background: rgba(255,255,255,0.08); color: var(--ps-ink, #f4f4ff); }
    .chip-active {
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
      color: oklch(from var(--ps-accent, #00e5ff) max(l, 0.78) max(c, 0.22) h);
      box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00e5ff) 28%, transparent);
    }
    .chip-count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.65rem;
      opacity: 0.7;
    }

    .left-list {
      list-style: none; padding: 6px 8px 24px; margin: 0;
      overflow-y: auto; flex: 1; min-height: 0;
      scrollbar-width: thin;
    }
    .row {
      display: flex; gap: 10px;
      padding: 10px;
      border-radius: 12px;
      cursor: pointer;
      transition: background 160ms var(--ease-cinematic);
      min-height: 64px;
    }
    .row:hover { background: rgba(255,255,255,0.04); }
    .row:focus-visible {
      outline: 2px solid var(--ps-accent, #00e5ff);
      outline-offset: -1px;
    }
    .row-active {
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent), rgba(124, 58, 237, 0.06));
      box-shadow: inset 2px 0 0 var(--ps-accent, #00e5ff);
    }
    .row-avatar {
      width: 40px; height: 40px;
      border-radius: 50%;
      position: relative;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18));
      color: var(--ps-ink, #f4f4ff);
      font-weight: 600; font-size: 0.85rem;
      overflow: hidden;
    }
    .row-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .row-avatar-lg { width: 64px; height: 64px; font-size: 1.2rem; }
    .presence-dot {
      position: absolute;
      width: 10px; height: 10px;
      bottom: 0; right: 0;
      border-radius: 50%;
      background: #34d399;
      border: 2px solid var(--ps-bg, #060610);
    }
    .row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .row-head { display: flex; align-items: baseline; gap: 6px; }
    .row-name { font-weight: 600; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-channel, .row-sentiment { font-size: 0.8rem; flex-shrink: 0; }
    .row-time {
      margin-left: auto;
      font-size: 0.68rem;
      color: rgba(244,244,255,0.5);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      flex-shrink: 0;
    }
    .row-preview {
      margin: 0;
      font-size: 0.76rem;
      color: rgba(244,244,255,0.65);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
    }
    .row-meta { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
    .status-pill {
      font-size: 0.62rem;
      padding: 2px 7px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
      background: rgba(255,255,255,0.06);
      color: rgba(244,244,255,0.7);
    }
    .status-open { background: color-mix(in oklch, #34d399 18%, transparent); color: #6ee7b7; }
    .status-pending { background: color-mix(in oklch, #f59e0b 18%, transparent); color: #fbbf24; }
    .status-snoozed { background: color-mix(in oklch, #818cf8 18%, transparent); color: #a5b4fc; }
    .status-resolved { background: rgba(244,244,255,0.08); color: rgba(244,244,255,0.55); }
    .unread-badge {
      margin-left: auto;
      min-width: 18px; height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--ps-accent, #00e5ff);
      color: #060610;
      font-size: 0.64rem;
      font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
    }

    /* ── Skeletons ─────────────────────────────── */
    .row-skel { padding: 12px 10px; pointer-events: none; }
    .skel { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: shimmer 1.6s var(--ease-cinematic) infinite; border-radius: 8px; }
    .skel-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
    .skel-stack { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .skel-line { height: 10px; }
    .skel-line-1 { width: 60%; }
    .skel-line-2 { width: 90%; }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
    @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }

    .row-empty {
      text-align: center;
      padding: 36px 24px;
    }
    .empty-glyph { font-size: 2rem; }
    .empty-glyph-lg { font-size: 3rem; margin-bottom: 12px; }
    .row-empty h3 { font-family: 'Sora', system-ui, sans-serif; font-size: 1rem; margin: 8px 0 4px; }
    .row-empty p { font-size: 0.8rem; color: rgba(244,244,255,0.55); margin: 0; }

    /* ── Center ────────────────────────────────── */
    .inbox-center {
      display: flex; flex-direction: column; min-height: 0;
      background: var(--ps-bg, #060610);
    }
    .empty-thread {
      flex: 1;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; padding: 64px 32px;
    }
    .empty-thread h2 { font-family: 'Sora', system-ui, sans-serif; font-size: 1.4rem; margin: 8px 0; }
    .empty-thread p { color: rgba(244,244,255,0.6); font-size: 0.88rem; max-width: 520px; }
    .empty-thread code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 5px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.78rem; }

    .thread-head {
      padding: 14px 20px;
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      background: linear-gradient(180deg, rgba(8,8,20,0.6), transparent);
    }
    .thread-who { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .thread-name { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; font-size: 0.95rem; }
    .thread-sub {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.72rem; color: rgba(244,244,255,0.55);
    }
    .thread-sub a { color: inherit; text-decoration: underline; }
    .ws-dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d399; }
    .ws-dot-warn { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; animation: pulse 1.2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    @media (prefers-reduced-motion: reduce) { .ws-dot-warn { animation: none; } }

    .thread-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ctrl-select { display: flex; flex-direction: column; gap: 2px; }
    .ctrl-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(244,244,255,0.45); }
    .ctrl-select select {
      appearance: none;
      min-height: 28px;
      padding: 3px 22px 3px 8px;
      border-radius: 8px;
      background: rgba(0,0,0,0.3) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%23f4f4ff' stroke-width='1.4' fill='none' stroke-linecap='round'/></svg>") right 6px center / 8px no-repeat;
      border: 1px solid rgba(255,255,255,0.08);
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.78rem;
    }
    .btn-resolve {
      appearance: none; border: 0; cursor: pointer;
      min-height: 32px;
      padding: 0 14px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--ps-accent, #00e5ff), #50aae3);
      color: #060610;
      font-weight: 600; font-size: 0.82rem;
      transition: transform 160ms var(--ease-cinematic), opacity 160ms;
    }
    .btn-resolve:hover:not([disabled]) { transform: translateY(-1px); }
    .btn-resolve:disabled { opacity: 0.4; cursor: not-allowed; }

    .thread-list {
      list-style: none; padding: 20px 24px; margin: 0;
      flex: 1; min-height: 0; overflow-y: auto;
      display: flex; flex-direction: column; gap: 14px;
    }
    .msg { display: flex; flex-direction: column; gap: 4px; max-width: 70%; }
    .msg-in { align-self: flex-start; }
    .msg-out, .msg-ai { align-self: flex-end; align-items: flex-end; }
    .msg-note { align-self: stretch; max-width: 100%; }
    .msg-bubble {
      padding: 10px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.06);
      font-size: 0.86rem;
      line-height: 1.5;
      box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 18px -16px rgba(0,0,0,0.6);
      word-wrap: break-word;
    }
    .msg-out .msg-bubble {
      background: linear-gradient(135deg, color-mix(in oklch, var(--ps-accent, #00e5ff) 22%, rgba(0,0,0,0.4)), rgba(124,58,237,0.12));
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 20%, transparent);
    }
    .msg-ai .msg-bubble {
      background: linear-gradient(135deg, rgba(124,58,237,0.16), rgba(0,229,255,0.08));
      border: 1px solid rgba(124,58,237,0.25);
    }
    .msg-note .msg-bubble {
      background: color-mix(in oklch, #f59e0b 14%, rgba(8,8,20,0.6));
      border: 1px dashed color-mix(in oklch, #f59e0b 40%, transparent);
    }
    .msg-pending .msg-bubble { opacity: 0.6; }
    .msg-body { white-space: pre-wrap; }
    .badge-note, .badge-ai {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 5px;
      margin-bottom: 6px;
    }
    .badge-note { background: rgba(245,158,11,0.18); color: #fcd34d; }
    .badge-ai { background: rgba(124,58,237,0.2); color: #c4b5fd; }
    .ai-pill {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      padding: 0 4px;
      border-radius: 4px;
      background: rgba(0,0,0,0.3);
    }
    .msg-meta { font-size: 0.66rem; color: rgba(244,244,255,0.45); display: flex; gap: 6px; padding: 0 6px; }
    .pending-tag { color: rgba(245,158,11,0.8); }
    .msg-attach { list-style: none; padding: 6px 0 0; margin: 6px 0 0; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.76rem; }
    .msg-attach a { color: var(--ps-accent, #00e5ff); text-decoration: underline; }

    .msg-typing .msg-bubble { display: flex; gap: 4px; padding: 12px 14px; }
    .typing-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: rgba(244,244,255,0.5);
      animation: typing 1.2s var(--ease-cinematic) infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.15s; }
    .typing-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-3px); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .typing-dot { animation: none; opacity: 0.7; } }

    /* ── Composer ─────────────────────────────── */
    .composer {
      padding: 12px 20px 16px;
      border-top: 1px solid rgba(255,255,255,0.06);
      background: linear-gradient(0deg, rgba(8,8,20,0.6), transparent);
      position: relative;
    }
    .composer-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
    .ct {
      appearance: none; border: 0; cursor: pointer;
      min-height: 26px;
      padding: 3px 12px;
      border-radius: 999px 999px 0 0;
      background: transparent;
      color: rgba(244,244,255,0.6);
      font-size: 0.74rem; font-weight: 600;
      border-bottom: 2px solid transparent;
    }
    .ct-active { color: var(--ps-ink, #f4f4ff); border-bottom-color: var(--ps-accent, #00e5ff); }
    .ct-note.ct-active { border-bottom-color: #fbbf24; color: #fcd34d; }

    .composer-input {
      width: 100%;
      min-height: 76px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.4);
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.88rem;
      font-family: inherit;
      resize: vertical;
      line-height: 1.5;
    }
    .composer-input:focus-visible {
      outline: 2px solid var(--ps-accent, #00e5ff);
      outline-offset: 1px;
      border-color: transparent;
    }
    .composer-note { background: color-mix(in oklch, #f59e0b 6%, rgba(0,0,0,0.4)); border-color: color-mix(in oklch, #f59e0b 30%, transparent); }

    .composer-bar { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .composer-spacer { flex: 1; }
    .cb {
      appearance: none; border: 1px solid rgba(255,255,255,0.08); cursor: pointer;
      min-width: 30px; min-height: 30px;
      padding: 0 9px;
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.85rem;
      display: inline-flex; align-items: center; gap: 4px;
      transition: background 160ms var(--ease-cinematic);
    }
    .cb:hover:not([disabled]) { background: rgba(255,255,255,0.1); }
    .cb-ai { background: linear-gradient(135deg, rgba(124,58,237,0.18), rgba(0,229,255,0.1)); border-color: rgba(124,58,237,0.32); }
    .cb-wide { width: 100%; justify-content: center; margin-top: 6px; }
    .hint { font-size: 0.66rem; color: rgba(244,244,255,0.4); font-family: 'JetBrains Mono', ui-monospace, monospace; }

    .btn-send {
      appearance: none; border: 0; cursor: pointer;
      min-height: 32px;
      padding: 0 16px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--ps-accent, #00e5ff), #50aae3);
      color: #060610;
      font-weight: 600; font-size: 0.82rem;
      transition: transform 160ms var(--ease-cinematic);
    }
    .btn-send:hover:not([disabled]) { transform: translateY(-1px); }
    .btn-send:disabled { opacity: 0.4; cursor: not-allowed; }

    .canned-pop {
      position: absolute;
      bottom: 100%; left: 20px; right: 20px;
      margin-bottom: 6px;
      max-height: 260px; overflow-y: auto;
      background: rgba(12, 12, 28, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 20px 60px -20px rgba(0,0,0,0.6);
      z-index: 5;
    }
    .canned-row {
      display: grid; grid-template-columns: auto 1fr auto;
      gap: 10px; align-items: center;
      width: 100%; padding: 8px 10px;
      border-radius: 8px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--ps-ink, #f4f4ff);
      text-align: left;
      font-size: 0.82rem;
    }
    .canned-row:hover { background: rgba(255,255,255,0.06); }
    .canned-row code { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--ps-accent, #00e5ff); }
    .canned-row em { font-style: normal; color: rgba(244,244,255,0.5); font-size: 0.72rem; }
    .canned-empty { padding: 16px; text-align: center; color: rgba(244,244,255,0.5); font-size: 0.8rem; }

    .attach-strip {
      list-style: none; padding: 6px 0 0; margin: 6px 0 0;
      display: flex; flex-wrap: wrap; gap: 6px;
      font-size: 0.72rem;
    }
    .attach-strip li {
      background: rgba(255,255,255,0.06);
      padding: 3px 6px 3px 10px;
      border-radius: 6px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .attach-strip button { background: transparent; border: 0; color: rgba(244,244,255,0.6); cursor: pointer; padding: 0 4px; min-height: 24px; min-width: 24px; }

    .ai-drafts {
      margin-top: 10px;
      border: 1px solid rgba(124,58,237,0.3);
      background: linear-gradient(180deg, rgba(124,58,237,0.08), transparent);
      border-radius: 12px;
      padding: 10px;
    }
    .ai-drafts-head {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 0.74rem; color: #c4b5fd;
      text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
      margin-bottom: 6px;
    }
    .ai-draft-row {
      display: block; width: 100%; text-align: left;
      padding: 8px 10px; margin-top: 4px;
      border-radius: 8px;
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.06);
      cursor: pointer;
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.82rem; line-height: 1.4;
    }
    .ai-draft-row:hover { background: rgba(255,255,255,0.06); }

    /* ── Right rail ───────────────────────────── */
    .inbox-right {
      display: flex; flex-direction: column;
      border-left: 1px solid rgba(255,255,255,0.06);
      background: rgba(8, 8, 20, 0.4);
      backdrop-filter: blur(8px);
      overflow-y: auto;
    }
    .right-head { padding: 22px 18px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .right-name { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; font-size: 1rem; }
    .right-sub { display: flex; flex-direction: column; gap: 2px; font-size: 0.76rem; color: rgba(244,244,255,0.6); }
    .right-sub a { color: var(--ps-accent, #00e5ff); text-decoration: none; }
    .right-sub a:hover { text-decoration: underline; }
    .right-empty { padding: 24px; text-align: center; color: rgba(244,244,255,0.55); font-size: 0.82rem; }

    .right-block {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .right-block h3 {
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em;
      margin: 0 0 10px;
      color: rgba(244,244,255,0.5);
    }
    .kv { margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .kv > div { display: grid; grid-template-columns: 40% 1fr; gap: 6px; }
    .kv dt { font-size: 0.76rem; color: rgba(244,244,255,0.55); }
    .kv dd { margin: 0; }
    .kv-input {
      width: 100%; padding: 4px 6px;
      background: rgba(0,0,0,0.3);
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.76rem;
    }
    .kv-input:hover { border-color: rgba(255,255,255,0.08); }
    .kv-input:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; border-color: transparent; }
    .kv-empty { font-size: 0.76rem; color: rgba(244,244,255,0.45); }

    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(0,229,255,0.1);
      color: oklch(from var(--ps-accent, #00e5ff) max(l, 0.78) max(c, 0.22) h);
      font-size: 0.7rem;
    }
    .tag button { background: transparent; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 2px; min-width: 24px; min-height: 24px; }
    .tag-input {
      flex: 1; min-width: 80px;
      padding: 3px 8px; min-height: 26px;
      background: rgba(0,0,0,0.3);
      border: 1px dashed rgba(255,255,255,0.12);
      border-radius: 999px;
      color: var(--ps-ink, #f4f4ff);
      font-size: 0.7rem;
    }

    .prev-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .prev-list button {
      display: grid; grid-template-columns: auto 1fr auto; gap: 8px;
      width: 100%; padding: 6px 8px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--ps-ink, #f4f4ff);
      border-radius: 8px;
      text-align: left;
      font-size: 0.76rem;
      align-items: center;
    }
    .prev-list button:hover { background: rgba(255,255,255,0.04); }
    .prev-list time { color: rgba(244,244,255,0.45); font-size: 0.66rem; }
    .prev-list button > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .prev-empty { font-size: 0.76rem; color: rgba(244,244,255,0.45); padding: 4px 8px; }

    .widget-blurb { font-size: 0.78rem; color: rgba(244,244,255,0.6); margin: 0 0 8px; }
    .widget-snippet {
      background: rgba(0,0,0,0.5);
      padding: 8px;
      border-radius: 8px;
      font-size: 0.7rem;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      overflow-x: auto;
      margin: 0 0 6px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .widget-snippet code { white-space: pre; color: var(--ps-accent, #00e5ff); }
  `],
})
export class AdminInboxComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild('threadList') private threadListRef?: ElementRef<HTMLOListElement>;
  @ViewChild('composerInput') private composerRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('searchInput') private searchRef?: ElementRef<HTMLInputElement>;

  // ── State ─────────────────────────────────────────
  loading = signal(true);
  conversations = signal<Conversation[]>([]);
  messages = signal<InboxMessage[]>([]);
  selectedId = signal<string | null>(null);
  agents = signal<Agent[]>([]);
  canned = signal<CannedResponse[]>([]);
  searchQuery = signal('');
  searchQueryModel = '';
  activeFilter = signal<FilterChip>('all');
  composerMode = signal<'reply' | 'note'>('reply');
  draftModel = '';
  cannedOpen = signal(false);
  pendingAttachments = signal<{ r2_key: string; name: string; size: number; type: string }[]>([]);
  aiDrafts = signal<string[]>([]);
  aiBusy = signal(false);
  newTag = '';
  contactTyping = signal(false);
  inboxId = signal<string>('');
  wsState = signal<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');

  skeletonRows = Array.from({ length: 6 });

  filterChips: { id: FilterChip; label: string; count: () => number }[] = [
    { id: 'all',        label: 'All',        count: () => this.conversations().length },
    { id: 'mine',       label: 'Mine',       count: () => this.conversations().filter((c) => c.assignee_id === this.auth.email()).length },
    { id: 'unassigned', label: 'Unassigned', count: () => this.conversations().filter((c) => !c.assignee_id).length },
    { id: 'open',       label: 'Open',       count: () => this.conversations().filter((c) => c.status === 'open').length },
    { id: 'snoozed',    label: 'Snoozed',    count: () => this.conversations().filter((c) => c.status === 'snoozed').length },
    { id: 'resolved',   label: 'Resolved',   count: () => this.conversations().filter((c) => c.status === 'resolved').length },
  ];

  selectedConversation = computed(() => {
    const id = this.selectedId();
    return id ? this.conversations().find((c) => c.id === id) ?? null : null;
  });

  totalUnread = computed(() => this.conversations().reduce((sum, c) => sum + c.unread_count, 0));

  filteredConversations = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();
    const myId = this.auth.email();
    return this.conversations()
      .filter((c) => {
        switch (filter) {
          case 'mine':       if (c.assignee_id !== myId) return false; break;
          case 'unassigned': if (c.assignee_id) return false; break;
          case 'open':       if (c.status !== 'open') return false; break;
          case 'snoozed':    if (c.status !== 'snoozed') return false; break;
          case 'resolved':   if (c.status !== 'resolved') return false; break;
        }
        if (q) {
          const hay = `${c.contact.name} ${c.contact.email ?? ''} ${c.last_message_preview}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at));
  });

  filteredCanned = computed(() => {
    const m = this.draftModel.match(/(?:^|\s)\/(\w*)$/);
    const q = (m?.[1] ?? '').toLowerCase();
    if (!q) return this.canned().slice(0, 6);
    return this.canned().filter((cr) => cr.shortcut.toLowerCase().includes(q) || cr.title.toLowerCase().includes(q)).slice(0, 6);
  });

  previousConversations = computed(() => {
    const sel = this.selectedConversation();
    if (!sel) return [];
    return this.conversations()
      .filter((c) => c.contact.id === sel.contact.id && c.id !== sel.id)
      .slice(0, 6);
  });

  attributeEntries = computed(() => {
    const sel = this.selectedConversation();
    if (!sel) return [];
    return Object.entries(sel.contact.custom_attributes ?? {}).map(([key, value]) => ({ key, value }));
  });

  // ── WebSocket lifecycle ────────────────────────────
  private ws: WebSocket | null = null;
  private wsBackoffMs = 800;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private contactTypingClearTimer: ReturnType<typeof setTimeout> | null = null;
  private typingSentAt = 0;

  // React to selection changes — connect WS to that conversation.
  private wsEffect = effect(() => {
    const id = this.selectedId();
    this.disconnectWs();
    if (id) this.connectWs(id);
  });

  constructor() {
    this.bootstrap();
    this.route.queryParamMap.subscribe((p) => {
      const f = p.get('filter') as FilterChip | null;
      const valid: FilterChip[] = ['all', 'mine', 'unassigned', 'open', 'snoozed', 'resolved'];
      if (f && valid.includes(f)) this.activeFilter.set(f);
    });
  }

  private bootstrap(): void {
    this.loading.set(true);
    // Load conversations + agents + canned in parallel. Sibling backend
    // routes — graceful empty-fallbacks so the UI ships before backend lands.
    Promise.allSettled([
      this.api.get<{ data: Conversation[] }>('/inbox/conversations').toPromise()
        .then((r) => this.conversations.set(r?.data ?? []))
        .catch(() => this.conversations.set([])),
      this.api.get<{ data: Agent[] }>('/inbox/agents').toPromise()
        .then((r) => this.agents.set(r?.data ?? []))
        .catch(() => this.agents.set([])),
      this.api.get<{ data: CannedResponse[] }>('/inbox/canned-responses').toPromise()
        .then((r) => this.canned.set(r?.data ?? []))
        .catch(() => this.canned.set([])),
      this.api.get<{ data: { inbox_id: string } }>('/inbox/widget-settings/default').toPromise()
        .then((r) => this.inboxId.set(r?.data?.inbox_id ?? 'demo'))
        .catch(() => this.inboxId.set('demo')),
    ]).finally(() => {
      this.loading.set(false);
      // Auto-select first conversation when nothing selected.
      const first = this.filteredConversations()[0];
      if (first && !this.selectedId()) this.selectConversation(first);
    });
  }

  // ── Conversation actions ──────────────────────────
  setFilter(id: FilterChip): void {
    this.activeFilter.set(id);
    this.router.navigate([], { queryParams: { filter: id === 'all' ? null : id }, queryParamsHandling: 'merge' });
  }

  selectConversation(c: Conversation): void {
    this.selectedId.set(c.id);
    this.messages.set([]);
    // Mark read locally; backend ack via WS.
    this.conversations.update((arr) => arr.map((x) => x.id === c.id ? { ...x, unread_count: 0 } : x));
    this.api.get<{ data: InboxMessage[] }>(`/inbox/conversations/${c.id}/messages`).subscribe({
      next: (r) => {
        this.messages.set(r.data ?? []);
        queueMicrotask(() => this.scrollThreadEnd());
      },
      error: () => this.messages.set([]),
    });
  }

  onAssign(agentId: string): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    const next = agentId || null;
    this.conversations.update((arr) => arr.map((c) => c.id === sel.id ? { ...c, assignee_id: next } : c));
    this.api.post(`/inbox/conversations/${sel.id}/assign`, { assignee_id: next }).subscribe({
      error: () => this.toast.error('Failed to update assignee'),
    });
  }

  onStatus(status: ConversationStatus): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    this.conversations.update((arr) => arr.map((c) => c.id === sel.id ? { ...c, status } : c));
    this.api.post(`/inbox/conversations/${sel.id}/status`, { status }).subscribe({
      error: () => this.toast.error('Failed to update status'),
    });
  }

  onPriority(priority: 'low' | 'normal' | 'high' | 'urgent'): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    this.conversations.update((arr) => arr.map((c) => c.id === sel.id ? { ...c, priority } : c));
    this.api.post(`/inbox/conversations/${sel.id}/priority`, { priority }).subscribe({
      error: () => this.toast.error('Failed to update priority'),
    });
  }

  resolve(): void {
    this.onStatus('resolved');
    this.toast.success('Conversation resolved');
  }

  // ── Composer ──────────────────────────────────────
  onDraftChange(value: string): void {
    this.draftModel = value;
    const slashMatch = /(?:^|\s)\/(\w*)$/.test(value);
    this.cannedOpen.set(slashMatch);
    // Send typing event throttled to 1.5s.
    const now = Date.now();
    if (now - this.typingSentAt > 1500 && this.composerMode() === 'reply') {
      this.typingSentAt = now;
      this.sendWs({ type: 'typing' });
    }
  }

  toggleCanned(): void {
    this.cannedOpen.update((v) => !v);
  }

  pickCanned(cr: CannedResponse): void {
    // Replace the trailing /<shortcut> with the canned body.
    this.draftModel = this.draftModel.replace(/(?:^|\s)\/\w*$/, (match) => {
      const leading = match.startsWith(' ') ? ' ' : '';
      return leading + cr.body;
    });
    this.cannedOpen.set(false);
    queueMicrotask(() => this.composerRef?.nativeElement.focus());
  }

  onComposerKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.cannedOpen.set(false);
      this.draftModel = '';
      return;
    }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      if (ev.shiftKey) this.composerMode.set('note');
      this.sendMessage();
    }
  }

  sendMessage(): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    const body = this.draftModel.trim();
    if (!body && this.pendingAttachments().length === 0) return;
    const kind = this.composerMode();
    const optimistic: InboxMessage = {
      id: `local-${Date.now()}`,
      conversation_id: sel.id,
      body,
      sender_type: 'agent',
      sender_name: 'You',
      kind,
      attachments: this.pendingAttachments(),
      created_at: new Date().toISOString(),
      pending: true,
    };
    this.messages.update((m) => [...m, optimistic]);
    this.draftModel = '';
    this.pendingAttachments.set([]);
    this.cannedOpen.set(false);
    queueMicrotask(() => this.scrollThreadEnd());

    const payload = {
      conversation_id: sel.id,
      body,
      kind,
      attachments: optimistic.attachments,
    };
    if (this.sendWs({ type: 'message', payload })) return;
    // WS unavailable — fall back to HTTP POST.
    this.api.post<{ data: InboxMessage }>(`/inbox/conversations/${sel.id}/messages`, payload).subscribe({
      next: (r) => {
        this.messages.update((m) => m.map((x) => x.id === optimistic.id ? { ...r.data, pending: false } : x));
      },
      error: () => {
        this.messages.update((m) => m.map((x) => x.id === optimistic.id ? { ...x, pending: false } : x));
        this.toast.error('Send failed. Tap to retry.');
      },
    });
  }

  onAttach(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (!input.files) return;
    const files = Array.from(input.files);
    this.uploadFiles(files);
    input.value = '';
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (files.length) this.uploadFiles(files);
  }

  private uploadFiles(files: File[]): void {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    this.api.postFormData<{ data: { assets: { key: string; name: string; size: number; type: string }[] } }>('/assets/upload', fd).subscribe({
      next: (r) => {
        const added = (r.data?.assets ?? []).map((a) => ({ r2_key: a.key, name: a.name, size: a.size, type: a.type }));
        this.pendingAttachments.update((cur) => [...cur, ...added]);
      },
      error: () => this.toast.error('Upload failed'),
    });
  }

  removeAttachment(key: string): void {
    this.pendingAttachments.update((cur) => cur.filter((a) => a.r2_key !== key));
  }

  attachmentUrl(key: string): string {
    return `/api/assets/${encodeURIComponent(key)}`;
  }

  aiAssist(): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    this.aiBusy.set(true);
    this.api.post<{ data: { drafts: string[] } }>('/inbox/ai-draft', {
      conversation_id: sel.id,
      instruction: this.draftModel.trim() || undefined,
    }).subscribe({
      next: (r) => {
        this.aiDrafts.set(r.data?.drafts ?? []);
        this.aiBusy.set(false);
      },
      error: () => {
        this.aiBusy.set(false);
        this.toast.error('AI assist unavailable');
      },
    });
  }

  useDraft(draft: string): void {
    this.draftModel = draft;
    this.aiDrafts.set([]);
    queueMicrotask(() => this.composerRef?.nativeElement.focus());
  }

  // ── Contact details ───────────────────────────────
  saveAttribute(key: string, value: string): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    const next = { ...(sel.contact.custom_attributes ?? {}), [key]: value };
    this.conversations.update((arr) => arr.map((c) => c.id === sel.id ? { ...c, contact: { ...c.contact, custom_attributes: next } } : c));
    this.api.patch(`/inbox/contacts/${sel.contact.id}`, { custom_attributes: next }).subscribe({
      error: () => this.toast.error('Failed to save attribute'),
    });
  }

  addTag(): void {
    const sel = this.selectedConversation();
    const t = this.newTag.trim();
    if (!sel || !t) return;
    const next = [...(sel.contact.tags ?? []), t];
    this.conversations.update((arr) => arr.map((c) => c.id === sel.id ? { ...c, contact: { ...c.contact, tags: next } } : c));
    this.newTag = '';
    this.api.patch(`/inbox/contacts/${sel.contact.id}`, { tags: next }).subscribe({
      error: () => this.toast.error('Failed to add tag'),
    });
  }

  removeTag(tag: string): void {
    const sel = this.selectedConversation();
    if (!sel) return;
    const next = (sel.contact.tags ?? []).filter((t) => t !== tag);
    this.conversations.update((arr) => arr.map((c) => c.id === sel.id ? { ...c, contact: { ...c.contact, tags: next } } : c));
    this.api.patch(`/inbox/contacts/${sel.contact.id}`, { tags: next }).subscribe({
      error: () => this.toast.error('Failed to remove tag'),
    });
  }

  copyWidgetSnippet(): void {
    const snippet = `<script async src="https://projectsites.dev/widget.js?inbox=${this.inboxId()}"></script>`;
    navigator.clipboard?.writeText(snippet).then(
      () => this.toast.success('Widget snippet copied'),
      () => this.toast.error('Copy failed — select + copy manually'),
    );
  }

  // ── WS plumbing ───────────────────────────────────
  private connectWs(conversationId: string): void {
    this.wsState.set('connecting');
    const token = this.auth.getToken() ?? '';
    const host = window.location.host;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${host}/api/inbox/ws/${encodeURIComponent(conversationId)}?token=${encodeURIComponent(token)}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.addEventListener('open', () => {
        this.wsState.set('connected');
        this.wsBackoffMs = 800;
      });
      ws.addEventListener('message', (ev) => this.handleWsMessage(ev));
      ws.addEventListener('close', () => this.scheduleReconnect(conversationId));
      ws.addEventListener('error', () => {
        try { ws.close(); } catch { /* swallow */ }
      });
    } catch {
      this.scheduleReconnect(conversationId);
    }
  }

  private scheduleReconnect(conversationId: string): void {
    if (this.selectedId() !== conversationId) return;
    this.wsState.set('reconnecting');
    const backoff = Math.min(this.wsBackoffMs, 15_000);
    this.wsBackoffMs = Math.min(this.wsBackoffMs * 2, 15_000);
    setTimeout(() => {
      if (this.selectedId() === conversationId) this.connectWs(conversationId);
    }, backoff);
  }

  private disconnectWs(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* swallow */ }
      this.ws = null;
    }
    this.wsState.set('idle');
    this.contactTyping.set(false);
  }

  private sendWs(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private handleWsMessage(ev: MessageEvent): void {
    let parsed: { type: string; payload?: unknown };
    try { parsed = JSON.parse(ev.data as string); } catch { return; }
    switch (parsed.type) {
      case 'message': {
        const m = parsed.payload as InboxMessage;
        this.messages.update((cur) => {
          // Reconcile optimistic pending message by body+timestamp proximity.
          const idx = cur.findIndex((x) => x.pending && x.body === m.body && Math.abs(+new Date(x.created_at) - +new Date(m.created_at)) < 30_000);
          if (idx >= 0) {
            const next = [...cur];
            next[idx] = { ...m, pending: false };
            return next;
          }
          if (cur.some((x) => x.id === m.id)) return cur;
          return [...cur, m];
        });
        // Bump the conversation row preview.
        this.conversations.update((arr) => arr.map((c) => c.id === m.conversation_id ? {
          ...c, last_message_preview: m.body, last_message_at: m.created_at,
          unread_count: m.sender_type === 'contact' && this.selectedId() !== c.id ? c.unread_count + 1 : c.unread_count,
        } : c));
        queueMicrotask(() => this.scrollThreadEnd());
        break;
      }
      case 'typing': {
        const p = parsed.payload as { sender_type: SenderType };
        if (p?.sender_type === 'contact') {
          this.contactTyping.set(true);
          if (this.contactTypingClearTimer) clearTimeout(this.contactTypingClearTimer);
          this.contactTypingClearTimer = setTimeout(() => this.contactTyping.set(false), 3000);
        }
        break;
      }
      case 'presence': {
        const p = parsed.payload as { contact_id: string; online: boolean };
        this.conversations.update((arr) => arr.map((c) => c.contact.id === p.contact_id ? { ...c, contact: { ...c.contact, is_present: p.online } } : c));
        break;
      }
      case 'status_change': {
        const p = parsed.payload as { conversation_id: string; status: ConversationStatus };
        this.conversations.update((arr) => arr.map((c) => c.id === p.conversation_id ? { ...c, status: p.status } : c));
        break;
      }
    }
  }

  private scrollThreadEnd(): void {
    const el = this.threadListRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ── Keyboard nav for list ─────────────────────────
  onListKey(ev: KeyboardEvent): void {
    const list = this.filteredConversations();
    if (list.length === 0) return;
    const currentId = this.selectedId();
    const idx = list.findIndex((c) => c.id === currentId);
    if (ev.key === 'ArrowDown' || ev.key === 'j') {
      ev.preventDefault();
      const next = list[Math.min(list.length - 1, idx + 1)] ?? list[0];
      this.selectConversation(next!);
    } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
      ev.preventDefault();
      const next = list[Math.max(0, idx - 1)] ?? list[0];
      this.selectConversation(next!);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    const inField = target?.matches('input, textarea, [contenteditable]');
    if (ev.key === '/' && !inField) {
      ev.preventDefault();
      this.searchRef?.nativeElement.focus();
    }
  }

  // ── Helpers ───────────────────────────────────────
  emptyHint(): string {
    switch (this.activeFilter()) {
      case 'unassigned': return 'All conversations are assigned. Nice.';
      case 'mine':       return 'You have no open conversations. Pick one to triage.';
      case 'snoozed':    return 'No snoozed conversations.';
      case 'resolved':   return 'No resolved conversations yet.';
      default:           return 'Drop the widget on a site or hook up email to start receiving messages.';
    }
  }

  initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  }

  channelGlyph(c: ChannelKind): string {
    const map: Record<ChannelKind, string> = {
      email: '✉', slack: '💼', discord: '🎮', telegram: '✈', website: '🌐', sms: '📱',
    };
    return map[c] ?? '💬';
  }

  channelLabel(c: ChannelKind): string {
    const map: Record<ChannelKind, string> = {
      email: 'Email', slack: 'Slack', discord: 'Discord', telegram: 'Telegram', website: 'Website widget', sms: 'SMS',
    };
    return map[c] ?? 'Chat';
  }

  sentimentGlyph(s: Sentiment): string {
    if (s === 'positive') return '😊';
    if (s === 'negative') return '😟';
    if (s === 'neutral') return '😐';
    return '';
  }

  senderLabel(t: SenderType): string {
    return t === 'ai' ? 'AI assistant' : t === 'contact' ? 'Contact' : 'You';
  }

  aiConfidencePct(c?: number | null): number {
    return Math.round(((c ?? 0) as number) * 100);
  }

  aiConfidenceLabel(c?: number | null): string {
    return 'AI confidence ' + this.aiConfidencePct(c) + '%';
  }

  cannedPreview(body: string): string {
    const trimmed = body.slice(0, 60);
    return body.length > 60 ? trimmed + '…' : trimmed;
  }

  relativeTime(iso: string): string {
    const ms = Date.now() - +new Date(iso);
    const s = Math.floor(ms / 1000);
    if (s < 60) return 'now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
