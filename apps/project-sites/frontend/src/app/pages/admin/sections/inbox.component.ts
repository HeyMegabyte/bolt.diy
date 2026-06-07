/**
 * /admin/inbox — Unified Visitor Inbox.
 *
 * 3-pane layout (cyan-black compact per [[cyan-black-compact-progression]]):
 *   Left  — conversation list (virtualized, ≤36px rows)
 *   Center — thread view (messages)
 *   Right  — AI-draft panel + assign/status controls
 *
 * Stats row uses <app-rolling-counter> for animated "47 unread" etc.
 * Every section entry uses appReveal.
 * Flag: unified_inbox — component renders a flag-gate notice when off.
 */

import {
  Component, OnInit, OnDestroy, computed, inject, signal, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, interval, tap, filter, switchMap, startWith } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmInputDirective, HlmSelectDirective, HlmTablistDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';
import { EmptyStateComponent } from '../../../components/states';
import { ChannelIconComponent } from '../../../components/channel-icon/channel-icon.component';
import { AiSparkComponent } from '../../../components/ai-spark/ai-spark.component';

interface VisitorIdentity {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  visitor_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface Conversation {
  id: string;
  org_id: string;
  site_id: string;
  visitor_id: string;
  channel: string;
  subject: string | null;
  status: string;
  assigned_to: string | null;
  sla_due_at: string | null;
  last_message_at: string;
  message_count: number;
  unread_count: number;
  visitor: VisitorIdentity | null;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  author_type: 'visitor' | 'agent' | 'ai' | 'system';
  author_id: string | null;
  body: string;
  channel: string;
  ai_drafted: number;
  sent_at: string;
}

// Status accents resolve to design tokens (open/resolved) + locally-scoped
// semantic vars (pending/spam) defined in the inbox style block — no raw hex
// leaks into bound styles. Cyan/black brand cohesion per convergence r21.
const STATUS_COLORS: Record<string, string> = {
  open: 'var(--ps-accent)',
  pending: 'var(--inbox-status-pending)',
  resolved: 'var(--ps-success)',
  spam: 'var(--inbox-status-spam)',
};

@Component({
  selector: 'app-admin-inbox',
  standalone: true,
  imports: [RevealDirective, CommonModule, FormsModule, RouterModule, RollingCounterComponent, HlmInputDirective, HlmSelectDirective, HlmTablistDirective, EmptyStateComponent, ChannelIconComponent, AiSparkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="inbox-shell" appReveal>
      <!-- Header + Stats -->
      <header class="inbox-hdr">
        <div class="inbox-hdr-left">
          <span class="inbox-eyebrow">Unified Inbox</span>
          <h1 class="inbox-title">Visitor Conversations</h1>
        </div>
        <!-- Stats derive from conversations() — show only once the load resolves so
             they never assert "0 open · 0 unread" over a still-loading / errored list. -->
        @if (flagEnabled() && !loading() && !convError()) {
          <div class="inbox-stats" data-testid="inbox-stats" appReveal>
            <div class="inbox-stat">
              <app-rolling-counter [value]="openCount()" suffix=" open" />
            </div>
            <div class="inbox-stat">
              <app-rolling-counter [value]="unreadCount()" suffix=" unread" />
            </div>
          </div>
        }
      </header>

      @if (!flagEnabled()) {
        <div class="inbox-flag-gate" appReveal>
          <p class="m-0">
            The Unified Inbox is behind the <code>unified_inbox</code> feature flag. Enable it in
            <a routerLink="/admin/feature-flags" class="text-[#00E5FF] underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] rounded-sm">System&nbsp;Admin</a>.
          </p>
        </div>
      } @else {
        <!-- Filter toolbar -->
        <div class="inbox-toolbar" appReveal>
          <div class="inbox-status-pills" role="tablist" hlmTablist aria-label="Filter by task status">
            @for (s of statuses; track s) {
              <button
                class="inbox-pill"
                [class.active]="selectedStatus() === s"
                (click)="selectStatus(s)"
                [attr.aria-selected]="selectedStatus() === s"
                [attr.aria-label]="(s | titlecase) + ' — ' + statusCount(s) + ' conversations'"
                role="tab">
                {{ s | titlecase }}
                @if (statusCount(s) > 0) {
                  <span class="inbox-pill-count" aria-hidden="true">{{ statusCount(s) }}</span>
                }
              </button>
            }
          </div>
          <select hlmSelect aria-label="Filter by channel" [ngModel]="selectedChannel()" (ngModelChange)="selectedChannel.set($event)">
            <option value="">All channels</option>
            @for (ch of channels; track ch) {
              <option [value]="ch">{{ channelLabel(ch) }}</option>
            }
          </select>
          <input
            hlmInput
            type="search"
            class="flex-1 min-w-[160px]"
            placeholder="Search conversations…"
            [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)"
            aria-label="Search conversations" />
        </div>

        <!-- 3-pane layout -->
        <div class="inbox-3pane">
          <!-- Left: conversation list -->
          <aside class="inbox-list" role="list" aria-label="Conversations">
            @if (loading()) {
              <div class="inbox-skel" aria-busy="true" aria-label="Loading conversations">
                @for (i of [0,1,2,3,4,5]; track i) {
                  <div class="inbox-row inbox-row--skel" aria-hidden="true">
                    <span class="glow-skel inbox-skel-icon"></span>
                    <span class="inbox-row-body">
                      <span class="glow-skel inbox-skel-name"></span>
                      <span class="glow-skel inbox-skel-sub"></span>
                    </span>
                  </div>
                }
              </div>
            } @else if (convError()) {
              <div class="inbox-empty" data-testid="inbox-conv-error" role="alert">
                <p class="text-red-300">{{ convError() }}</p>
                <button class="btn-ghost text-xs" data-testid="inbox-conv-retry" (click)="loadConversations()">Retry</button>
              </div>
            } @else if (filterNoMatch()) {
              <app-empty-state icon="🔍"
                title="No conversations match your search"
                message="Try a different name, email, subject, or channel."
                ctaLabel="Clear search"
                (ctaClick)="clearClientFilter()"
                data-testid="inbox-filter-empty" />
            } @else if (filteredConversations().length === 0) {
              <app-empty-state icon="💬"
                [title]="selectedStatus() === 'all' ? 'No conversations yet' : 'No ' + selectedStatus() + ' conversations'"
                message="Messages from your site's contact form and chat widget land here."
                [ctaLabel]="selectedStatus() !== 'all' ? 'Show all conversations' : ''"
                (ctaClick)="selectStatus('all')"
                data-testid="inbox-empty" />
            } @else {
              @for (conv of filteredConversations(); track conv.id) {
                <div
                  class="inbox-row"
                  [class.selected]="selectedId() === conv.id"
                  [class.unread]="conv.unread_count > 0"
                  (click)="selectConversation(conv)"
                  role="listitem"
                  [attr.aria-selected]="selectedId() === conv.id"
                  tabindex="0"
                  (keydown.enter)="selectConversation(conv)"
                  (keydown.space)="selectConversation(conv)">
                  <span class="inbox-row-icon" [attr.title]="conv.channel"><app-channel-icon [channel]="conv.channel" /></span>
                  <div class="inbox-row-body">
                    <div class="inbox-row-name">{{ visitorName(conv) }}</div>
                    <div class="inbox-row-sub">{{ conv.subject || 'No subject' }}</div>
                  </div>
                  <div class="inbox-row-meta">
                    <span class="inbox-status-dot" [style.background]="statusColor(conv.status)" [attr.title]="conv.status"></span>
                    @if (conv.unread_count > 0) {
                      <span class="inbox-unread-badge">{{ conv.unread_count }}</span>
                    }
                    <span class="inbox-row-time">{{ relativeTime(conv.last_message_at) }}</span>
                  </div>
                </div>
              }
              @if (hasMore()) {
                <button class="inbox-load-more" (click)="loadMore()">Load more</button>
              }
            }
          </aside>

          <!-- Center: thread -->
          <section class="inbox-thread" aria-label="Conversation thread">
            @if (!selectedConversation()) {
              <div class="inbox-empty-thread">
                <p>Select a conversation to read the thread.</p>
              </div>
            } @else {
              <header class="inbox-thread-hdr">
                <div class="inbox-thread-hdr-top">
                  <span class="inbox-ch-chip"><app-channel-icon [channel]="selectedConversation()!.channel" /> {{ channelLabel(selectedConversation()!.channel) }}</span>
                  <span class="inbox-status-chip" [style.color]="statusColor(selectedConversation()!.status)">{{ selectedConversation()!.status }}</span>
                </div>
                <h2 class="inbox-thread-subject">{{ selectedConversation()!.subject || visitorName(selectedConversation()!) }}</h2>
                <p class="inbox-thread-visitor">{{ visitorLabel(selectedConversation()!) }}</p>
              </header>

              <div class="inbox-messages" role="log" aria-live="polite" aria-label="Messages">
                @if (messagesError()) {
                  <div class="inbox-empty" role="alert" data-testid="inbox-msg-error">
                    <p class="text-red-300">{{ messagesError() }}</p>
                    <button class="btn-ghost text-xs" data-testid="inbox-msg-retry" (click)="reloadMessages()">Retry</button>
                  </div>
                }
                @for (msg of messages(); track msg.id) {
                  <div class="inbox-msg" [class.outbound]="msg.direction === 'outbound'" [class.ai-drafted]="msg.ai_drafted">
                    <div class="inbox-msg-meta">
                      <span class="inbox-msg-author">{{ msgAuthor(msg) }}</span>
                      @if (msg.ai_drafted) {
                        <span class="inbox-msg-ai-tag">AI draft</span>
                      }
                      <span class="inbox-msg-time">{{ relativeTime(msg.sent_at) }}</span>
                    </div>
                    <div class="inbox-msg-body">{{ msg.body }}</div>
                  </div>
                }
              </div>

              <!-- Quick reply -->
              <div class="inbox-reply-bar">
                <textarea
                  hlmInput
                  [multiline]="true"
                  class="w-full resize-none"
                  rows="3"
                  placeholder="Type a reply…"
                  [(ngModel)]="replyBody"
                  aria-label="Reply text"
                  (keydown.meta.enter)="sendReply()"
                  (keydown.ctrl.enter)="sendReply()">
                </textarea>
                <div class="inbox-reply-actions">
                  <button class="inbox-btn-secondary" (click)="generateDraft()" [disabled]="draftLoading()">
                    @if (draftLoading()) { Drafting… } @else { <app-ai-spark /> AI Draft }
                  </button>
                  <button class="inbox-btn-primary" (click)="sendReply()" [disabled]="replySending() || !replyBody.trim()">
                    {{ replySending() ? 'Sending…' : 'Send ↗' }}
                  </button>
                </div>
              </div>
            }
          </section>

          <!-- Right: controls -->
          <aside class="inbox-controls" aria-label="Conversation controls">
            @if (selectedConversation()) {
              <section class="inbox-ctrl-section" appReveal>
                <h3 class="inbox-ctrl-title">Status</h3>
                <div class="inbox-ctrl-statuses">
                  @for (s of statuses.slice(0, 4); track s) {
                    <button
                      class="inbox-ctrl-status-btn"
                      [class.active]="selectedConversation()!.status === s"
                      (click)="setStatus(s)">{{ s }}</button>
                  }
                </div>
              </section>

              <section class="inbox-ctrl-section" appReveal>
                <h3 class="inbox-ctrl-title">Assign</h3>
                <input
                  hlmInput
                  type="text"
                  class="w-full"
                  placeholder="User ID or email…"
                  [(ngModel)]="assignTarget"
                  aria-label="Assign to" />
                <button class="inbox-btn-secondary" (click)="assignTo(assignTarget)">Assign</button>
                @if (selectedConversation()!.assigned_to) {
                  <p class="inbox-ctrl-note">Currently: {{ selectedConversation()!.assigned_to }}</p>
                }
              </section>

              <section class="inbox-ctrl-section" appReveal>
                <h3 class="inbox-ctrl-title">Visitor</h3>
                @if (selectedConversation()!.visitor) {
                  <dl class="inbox-ctrl-visitor">
                    @if (selectedConversation()!.visitor!.email) {
                      <dt>Email</dt>
                      <dd><a [href]="'mailto:' + selectedConversation()!.visitor!.email">{{ selectedConversation()!.visitor!.email }}</a></dd>
                    }
                    @if (selectedConversation()!.visitor!.phone) {
                      <dt>Phone</dt>
                      <dd><a [href]="'tel:' + selectedConversation()!.visitor!.phone">{{ selectedConversation()!.visitor!.phone }}</a></dd>
                    }
                    <dt>First seen</dt>
                    <dd>{{ relativeTime(selectedConversation()!.visitor!.first_seen_at) }}</dd>
                  </dl>
                } @else {
                  <p class="inbox-ctrl-note">No visitor profile.</p>
                }
              </section>

              @if (selectedConversation()!.sla_due_at) {
                <section class="inbox-ctrl-section inbox-sla" appReveal>
                  <h3 class="inbox-ctrl-title">SLA</h3>
                  <p class="inbox-ctrl-note">Due {{ relativeTime(selectedConversation()!.sla_due_at!) }}</p>
                </section>
              }
            } @else {
              <div class="inbox-ctrl-empty">Select a conversation.</div>
            }
          </aside>
        </div>
      }
    </section>

    <style>
      /* Cyan/black cohesion (convergence r21): all bound styles + chrome read
         from --ps-* design tokens (_polish.scss / _cockpit.scss). The two
         status hues without a global token (pending=amber, spam=red) are
         scoped locally here so STATUS_COLORS never binds a raw hex. ink-mix
         tints derive from --ps-ink so they track the active theme. */
      .inbox-shell {
        --inbox-status-pending: #f59e0b;
        --inbox-status-spam: #ef4444;
        --inbox-surface: color-mix(in oklch, var(--ps-ink) 2%, transparent);
        --inbox-ink-60: color-mix(in oklch, var(--ps-ink) 60%, transparent);
        --inbox-ink-45: color-mix(in oklch, var(--ps-ink) 45%, transparent);
        --inbox-ink-35: color-mix(in oklch, var(--ps-ink) 35%, transparent);
        --inbox-hairline: color-mix(in oklch, var(--ps-ink) 5%, transparent);
        padding: 20px 24px; background: var(--ps-bg); color: var(--ps-ink); min-height: 100vh; display: flex; flex-direction: column; gap: 16px;
      }
      .inbox-hdr { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
      .inbox-eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--ps-accent); font-weight: 600; }
      .inbox-title { font-size: 22px; font-weight: 700; margin: 4px 0 0; }
      .inbox-stats { display: flex; gap: 20px; flex-wrap: wrap; }
      .inbox-stat { font-size: 13px; color: var(--ps-ink); font-variant-numeric: tabular-nums; }
      .inbox-flag-gate { padding: 24px; background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 6%, transparent)); border: 1px solid var(--ps-accent-line, color-mix(in oklch, var(--ps-accent) 20%, transparent)); border-radius: var(--ps-radius-md, 12px); }
      .inbox-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .inbox-status-pills { display: flex; gap: 6px; }
      .inbox-pill { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 12px; border-radius: 20px; border: 1px solid var(--ps-accent-line, color-mix(in oklch, var(--ps-accent) 20%, transparent)); background: transparent; color: var(--inbox-ink-60); font-size: 12px; font-weight: 500; cursor: pointer; transition: color var(--ps-dur-fast, 140ms), border-color var(--ps-dur-fast, 140ms); }
      .inbox-pill.active,.inbox-pill:hover { border-color: var(--ps-accent); color: var(--ps-accent); }
      .inbox-pill-count { margin-left: 6px; font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; padding: 0 5px; border-radius: 8px; background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 14%, transparent)); color: var(--ps-accent); }
      .inbox-pill.active .inbox-pill-count { background: var(--ps-accent); color: var(--ps-bg); }
      /* .inbox-channel-sel / .inbox-search removed — now Spartan hlmSelect/hlmInput. */
      .inbox-3pane { display: grid; grid-template-columns: 280px 1fr 220px; gap: 12px; flex: 1; height: calc(100vh - 220px); min-height: 400px; }
      .inbox-list { background: var(--inbox-surface); border: 1px solid var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 10%, transparent)); border-radius: var(--ps-radius-md, 12px); overflow-y: auto; }
      .inbox-loading,.inbox-empty { padding: 24px; text-align: center; color: var(--inbox-ink-45); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .inbox-row--skel { cursor: default; }
      .inbox-row--skel:hover { background: transparent; }
      .inbox-skel-icon { width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; display: inline-block; }
      .inbox-skel-name { display: block; width: 68%; height: 11px; border-radius: 4px; margin-bottom: 5px; }
      .inbox-skel-sub { display: block; width: 90%; height: 9px; border-radius: 4px; }
      .inbox-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--inbox-hairline); cursor: pointer; transition: background var(--ps-dur-fast, 140ms); min-height: 36px; }
      .inbox-row:hover,.inbox-row.selected { background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 8%, transparent)); }
      .inbox-row.selected { box-shadow: inset 2px 0 0 var(--ps-accent); }
      .inbox-row.unread .inbox-row-name { font-weight: 600; color: var(--ps-ink); }
      .inbox-row-icon { font-size: 14px; flex-shrink: 0; }
      .inbox-row-body { flex: 1; min-width: 0; }
      .inbox-row-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .inbox-row-sub { font-size: 11px; color: var(--inbox-ink-45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .inbox-row-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
      .inbox-status-dot { width: 7px; height: 7px; border-radius: 50%; }
      .inbox-unread-badge { background: var(--ps-accent); color: var(--ps-bg); font-size: 10px; font-weight: 700; border-radius: 10px; padding: 1px 5px; }
      .inbox-row-time { font-size: 10px; color: var(--inbox-ink-35); }
      .inbox-load-more { width: 100%; min-height: 32px; padding: 8px; background: transparent; border: none; border-top: 1px solid var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 10%, transparent)); color: var(--ps-accent); font-size: 12px; cursor: pointer; }
      .inbox-thread { background: var(--inbox-surface); border: 1px solid var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 10%, transparent)); border-radius: var(--ps-radius-md, 12px); display: flex; flex-direction: column; overflow: hidden; }
      .inbox-empty-thread { display: flex; align-items: center; justify-content: center; flex: 1; color: var(--inbox-ink-35); font-size: 13px; }
      .inbox-thread-hdr { padding: 12px 16px; border-bottom: 1px solid var(--inbox-hairline); }
      .inbox-thread-hdr-top { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
      .inbox-ch-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 10%, transparent)); border: 1px solid var(--ps-accent-line, color-mix(in oklch, var(--ps-accent) 20%, transparent)); border-radius: 20px; padding: 2px 8px; }
      .inbox-status-chip { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
      .inbox-thread-subject { font-size: 15px; font-weight: 600; margin: 0 0 2px; }
      .inbox-thread-visitor { font-size: 12px; color: var(--inbox-ink-45); margin: 0; }
      .inbox-messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
      .inbox-msg { max-width: 80%; }
      .inbox-msg.outbound { align-self: flex-end; }
      .inbox-msg-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 3px; }
      .inbox-msg-author { font-size: 11px; font-weight: 600; color: var(--inbox-ink-60); }
      .inbox-msg-ai-tag { font-size: 10px; background: color-mix(in oklch, var(--ps-accent-secondary, #7c3aed) 20%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent-secondary, #7c3aed) 32%, transparent); border-radius: 10px; padding: 1px 6px; color: color-mix(in oklch, var(--ps-accent-secondary, #7c3aed) 55%, var(--ps-ink)); }
      .inbox-msg-time { font-size: 10px; color: var(--inbox-ink-35); }
      .inbox-msg-body { background: color-mix(in oklch, var(--ps-ink) 4%, transparent); border: 1px solid var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 8%, transparent)); border-radius: 10px; padding: 8px 12px; font-size: 13px; line-height: 1.5; }
      .inbox-msg.outbound .inbox-msg-body { background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 8%, transparent)); border-color: var(--ps-accent-line, color-mix(in oklch, var(--ps-accent) 18%, transparent)); }
      /* Group AI-drafted replies with a violet left-accent — cohesive with the
         "AI draft" tag (same --ps-accent-secondary). Combines with .outbound. */
      .inbox-msg.ai-drafted .inbox-msg-body { border-left: 2px solid color-mix(in oklch, var(--ps-accent-secondary, #7c3aed) 50%, transparent); }
      .inbox-reply-bar { padding: 10px 12px; border-top: 1px solid var(--inbox-hairline); display: flex; flex-direction: column; gap: 8px; }
      /* .inbox-reply-input removed — now Spartan hlmInput [multiline] (resize-none). */
      .inbox-reply-actions { display: flex; justify-content: flex-end; gap: 8px; }
      .inbox-btn-primary { background: var(--ps-accent); color: var(--ps-bg); border: none; border-radius: var(--ps-radius-sm, 8px); min-height: 32px; padding: 6px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
      .inbox-btn-primary:disabled { opacity: 0.5; cursor: default; }
      .inbox-btn-secondary { background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 8%, transparent)); border: 1px solid var(--ps-accent-line, color-mix(in oklch, var(--ps-accent) 20%, transparent)); border-radius: var(--ps-radius-sm, 8px); min-height: 32px; padding: 6px 14px; color: var(--ps-accent); font-size: 13px; cursor: pointer; }
      .inbox-btn-secondary:disabled { opacity: 0.5; cursor: default; }
      .inbox-controls { background: var(--inbox-surface); border: 1px solid var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 10%, transparent)); border-radius: var(--ps-radius-md, 12px); overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
      .inbox-ctrl-empty { padding: 24px 0; text-align: center; color: var(--inbox-ink-35); font-size: 12px; }
      .inbox-ctrl-section { display: flex; flex-direction: column; gap: 6px; }
      .inbox-ctrl-title { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--inbox-ink-45); font-weight: 600; margin: 0; }
      .inbox-ctrl-statuses { display: flex; flex-wrap: wrap; gap: 5px; }
      .inbox-ctrl-status-btn { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 10px; border-radius: 20px; border: 1px solid var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent) 15%, transparent)); background: transparent; color: var(--inbox-ink-60); font-size: 11px; cursor: pointer; }
      .inbox-ctrl-status-btn.active { border-color: var(--ps-accent); color: var(--ps-accent); }
      /* .inbox-ctrl-assign-input removed — now Spartan hlmInput. */
      .inbox-ctrl-visitor dt { font-size: 10px; color: var(--inbox-ink-45); text-transform: uppercase; letter-spacing: 0.5px; margin: 4px 0 1px; }
      .inbox-ctrl-visitor dd { margin: 0; font-size: 12px; }
      .inbox-ctrl-visitor a { color: var(--ps-accent); border-radius: 3px; }
      .inbox-ctrl-note { font-size: 11px; color: var(--inbox-ink-45); margin: 0; }
      .inbox-sla { background: color-mix(in oklch, var(--inbox-status-spam) 8%, transparent); border: 1px solid color-mix(in oklch, var(--inbox-status-spam) 24%, transparent); border-radius: var(--ps-radius-sm, 8px); padding: 8px; }
      /* WCAG 2.4.11 — every keyboard-reachable control gets a ≥3:1 cyan ring. */
      .inbox-pill:focus-visible,
      .inbox-row:focus-visible,
      .inbox-load-more:focus-visible,
      .inbox-btn-primary:focus-visible,
      .inbox-btn-secondary:focus-visible,
      .inbox-ctrl-status-btn:focus-visible,
      .inbox-ctrl-visitor a:focus-visible {
        outline: var(--ps-ring-focus, 2px solid #00E5FF);
        outline-offset: var(--ps-ring-focus-offset, 2px);
      }
      .inbox-row:focus-visible { outline-offset: -2px; }
      @media (prefers-reduced-motion: reduce) {
        .inbox-pill, .inbox-row { transition: none; }
      }
      @media (max-width: 1100px) { .inbox-3pane { grid-template-columns: 220px 1fr; } .inbox-controls { display: none; } }
      @media (max-width: 720px) { .inbox-3pane { grid-template-columns: 1fr; height: auto; } .inbox-list { height: 40vh; } }
    </style>
  `,
})
export class AdminInboxComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private flags = inject(FeatureFlagService);
  private destroy$ = new Subject<void>();

  conversations = signal<Conversation[]>([]);
  loading = signal(true);
  /** Persistent non-404 conversations-load failure — so a fetch error shows a retry, not a fake "no conversations" empty state. */
  convError = signal<string | null>(null);
  /** Thread-load failure — so a failed message fetch shows a retry in the thread panel, not a silent blank thread. */
  messagesError = signal<string | null>(null);
  hasMore = signal(false);
  flagEnabled = signal(true); // assume on until 404 proves otherwise
  selectedId = signal<string | null>(null);
  messages = signal<Message[]>([]);
  draftLoading = signal(false);
  replySending = signal(false);

  selectedStatus = signal<string>('open');
  /** Client-side filters — SIGNALS so filteredConversations re-filters live (a plain field never re-triggered the computed → stale search). */
  selectedChannel = signal<string>('');
  searchQuery = signal<string>('');
  replyBody = '';
  assignTarget = '';

  statuses = ['open', 'pending', 'resolved', 'spam', 'all'];
  channels = ['form', 'chat', 'voice', 'sms', 'email'];

  /**
   * Human-friendly channel labels. A bare CSS `text-transform: capitalize`
   * mis-cases the initialisms ("sms" → "Sms"); this map keeps "SMS" correct
   * and titlecases the rest, with a safe titlecase fallback for any future key.
   */
  private static readonly CHANNEL_LABELS: Record<string, string> = {
    form: 'Form', chat: 'Chat', voice: 'Voice', sms: 'SMS', email: 'Email',
  };
  channelLabel(ch: string): string {
    return AdminInboxComponent.CHANNEL_LABELS[ch] ?? (ch ? ch.charAt(0).toUpperCase() + ch.slice(1) : ch);
  }

  selectedConversation = computed(() =>
    this.conversations().find((c) => c.id === this.selectedId()) ?? null,
  );

  filteredConversations = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const ch = this.selectedChannel();
    return this.conversations().filter((c) => {
      if (ch && c.channel !== ch) return false;
      if (!q) return true;
      return (
        (c.visitor?.email ?? '').toLowerCase().includes(q) ||
        (c.visitor?.display_name ?? '').toLowerCase().includes(q) ||
        (c.subject ?? '').toLowerCase().includes(q)
      );
    });
  });

  /** A client-side search/channel filter is active (status is server-side, excluded here). */
  hasClientFilter = computed(() => this.searchQuery().trim() !== '' || this.selectedChannel() !== '');
  /**
   * True when conversations are loaded but the client filter excludes every one →
   * drives a search-aware "no matches" empty state (with Clear) instead of the
   * status empty state's misleading "No conversations yet".
   */
  filterNoMatch = computed(() => this.hasClientFilter() && this.conversations().length > 0 && this.filteredConversations().length === 0);
  /** Reset the client-side search + channel filter (the "Clear search" CTA). */
  clearClientFilter(): void {
    this.searchQuery.set('');
    this.selectedChannel.set('');
  }

  openCount = computed(() => this.conversations().filter((c) => c.status === 'open').length);
  unreadCount = computed(() => this.conversations().reduce((s, c) => s + c.unread_count, 0));

  /** Loaded-conversation count for a status pill ('all' = every loaded row). */
  statusCount(status: string): number {
    const convs = this.conversations();
    return status === 'all' ? convs.length : convs.filter((c) => c.status === status).length;
  }

  ngOnInit(): void {
    // Gate the authed fetch + 30s poll on the actual flag (toast-safe public
    // probe). When unified_inbox is off we show the disabled state and never
    // fire the org-scoped fetch — which would otherwise toast "can't reach the
    // server" on load AND every 30s for an intentionally-disabled feature.
    this.flags
      .isOn('unified_inbox')
      .pipe(
        tap((on) => {
          this.flagEnabled.set(on);
          if (!on) this.loading.set(false);
        }),
        filter((on) => on),
        switchMap(() => interval(30000).pipe(startWith(0))),
        takeUntil(this.destroy$),
      )
      .subscribe(() => this.loadConversations());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Switch the status filter. Status is a SERVER-side param (not client-filtered
   * in filteredConversations), so it must refetch — otherwise the pill highlights
   * but the list never changes (a dead filter).
   */
  selectStatus(status: string): void {
    if (this.selectedStatus() === status) return;
    this.selectedStatus.set(status);
    this.loadConversations();
  }

  loadConversations(append = false): void {
    this.loading.set(true);
    this.convError.set(null);
    const params: Record<string, string> = { status: this.selectedStatus(), limit: '50' };
    if (this.selectedChannel()) params['channel'] = this.selectedChannel();

    this.api.get<{ conversations: Conversation[]; hasMore: boolean }>('/inbox/conversations', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          // Stale-route guard (canonical: site-features). A worker that predates
          // /api/inbox/conversations serves the SPA HTML at 200 → res.conversations
          // is undefined/non-array. Without this guard that set undefined (later
          // crashing filteredConversations().filter()) or faked a "no conversations"
          // empty state masking a broken route. Surface an honest retryable error.
          if (!res || !Array.isArray(res.conversations)) {
            this.convError.set("Couldn't load conversations — retry.");
            this.loading.set(false);
            return;
          }
          this.conversations.set(append ? [...this.conversations(), ...res.conversations] : res.conversations);
          this.hasMore.set(!!res.hasMore);
          this.flagEnabled.set(true);
          this.convError.set(null);
          this.loading.set(false);
        },
        error: (err) => {
          // 404 = flag off (handled by the disabled banner). A non-404 error must
          // NOT fall through to the "No conversations" empty state — surface a
          // retryable in-panel error so a failed load never looks like an empty inbox.
          if (err.status === 404) this.flagEnabled.set(false);
          else this.convError.set("Couldn't load conversations — retry.");
          this.loading.set(false);
        },
      });
  }

  loadMore(): void {
    const last = this.conversations().at(-1);
    if (!last) return;
    const params: Record<string, string> = { status: this.selectedStatus(), limit: '50', cursor: last.last_message_at };
    this.api.get<{ conversations: Conversation[]; hasMore: boolean }>('/inbox/conversations', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        // Same stale-route guard on the paginated page — never append a non-array
        // (which would corrupt the loaded rows with undefined).
        next: (res) => {
          if (!res || !Array.isArray(res.conversations)) return;
          this.conversations.set([...this.conversations(), ...res.conversations]);
          this.hasMore.set(!!res.hasMore);
        },
        error: () => {},
      });
  }

  selectConversation(conv: Conversation): void {
    this.selectedId.set(conv.id);
    this.replyBody = '';
    this.loadMessages(conv.id);
  }

  private loadMessages(convId: string): void {
    this.messagesError.set(null);
    this.api.get<{ conversation: Conversation; messages: Message[] }>(`/inbox/conversations/${convId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.messages.set(res.messages); this.messagesError.set(null); },
        // Don't leave a silent blank thread — surface a retryable error in-panel.
        error: () => { this.messages.set([]); this.messagesError.set('Could not load this conversation — retry.'); },
      });
  }

  /** Retry the thread load for the currently-selected conversation. */
  reloadMessages(): void {
    const id = this.selectedId();
    if (id) this.loadMessages(id);
  }

  generateDraft(): void {
    const id = this.selectedId();
    if (!id) return;
    this.draftLoading.set(true);
    this.api.post<{ draft: string }>(`/inbox/conversations/${id}/draft-with-ai`, {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.replyBody = res.draft; this.draftLoading.set(false); },
        error: () => this.draftLoading.set(false),
      });
  }

  sendReply(): void {
    const id = this.selectedId();
    if (!id || !this.replyBody.trim()) return;
    this.replySending.set(true);
    this.api.post<{ message: Message }>(`/inbox/conversations/${id}/reply`, { body: this.replyBody })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.messages.update((msgs) => [...msgs, res.message]);
          this.replyBody = '';
          this.replySending.set(false);
        },
        error: () => this.replySending.set(false),
      });
  }

  setStatus(status: string): void {
    const id = this.selectedId();
    if (!id) return;
    this.api.post<{ ok: boolean }>(`/inbox/conversations/${id}/status`, { status })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.conversations.update((cs) =>
            cs.map((c) => c.id === id ? { ...c, status } : c),
          );
        },
        error: () => {},
      });
  }

  assignTo(target: string): void {
    const id = this.selectedId();
    if (!id || !target.trim()) return;
    this.api.post<{ ok: boolean }>(`/inbox/conversations/${id}/assign`, { assigned_to: target.trim() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.conversations.update((cs) =>
            cs.map((c) => c.id === id ? { ...c, assigned_to: target.trim() } : c),
          );
          this.assignTarget = '';
        },
        error: () => {},
      });
  }

  statusColor(status: string): string {
    return STATUS_COLORS[status] ?? 'rgba(244,244,255,0.3)';
  }

  visitorName(conv: Conversation): string {
    if (conv.visitor?.display_name) return conv.visitor.display_name;
    if (conv.visitor?.email) return conv.visitor.email.split('@')[0];
    if (conv.visitor?.phone) return conv.visitor.phone;
    return 'Unknown visitor';
  }

  visitorLabel(conv: Conversation): string {
    const parts: string[] = [];
    if (conv.visitor?.email) parts.push(conv.visitor.email);
    if (conv.visitor?.phone) parts.push(conv.visitor.phone);
    return parts.join(' · ') || 'Anonymous';
  }

  msgAuthor(msg: Message): string {
    if (msg.author_type === 'visitor') return 'Visitor';
    if (msg.author_type === 'ai') return 'AI';
    if (msg.author_type === 'system') return 'System';
    return msg.author_id ?? 'Agent';
  }

  relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.round(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString();
  }
}
