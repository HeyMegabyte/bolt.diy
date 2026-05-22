import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { DatePipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AiChatExtrasComponent } from './ai-chat-extras.component';
import { MCP_PROVIDERS } from './mcp-providers';

interface Member { id: string; email: string; name: string | null; role: string; created_at: string; }
interface Invite { id: string; email: string; role: string; created_at: string; expires_at: string; }
interface GeneralSettings { contact_email: string | null; reply_email: string | null; brand_tone: string | null; brand_primary?: string | null; brand_accent?: string | null; timezone?: string | null; default_locale?: string | null; }
interface Conn { id: string; provider: string; display_name: string; status: string; connected_at: string; metadata?: Record<string, unknown>; }

// Settings tabs are SCOPED TO THE CURRENTLY-SELECTED PROJECT. Each tab loads
// data filtered by `state.selectedSite().id`. Theme + API keys are USER-level
// (see /admin/user). 2FA + Security defaults moved to the Team tab. Domain
// management is its own route at /admin/domains.
const TABS = [
  { id: 'general',  label: 'General',     desc: 'Brand · contact email · tone · locale (this project)' },
  { id: 'team',     label: 'Team',        desc: 'Members · roles · invitations · 2FA' },
  { id: 'ai-chat',  label: 'AI Chat',     desc: 'System prompt · knowledge files · Drive · context (this project)' },
  { id: 'mcp',      label: 'MCP',         desc: 'Per-project integrations: Slack, Stripe, Notion, HubSpot +20 more' },
  { id: 'danger',   label: 'Danger zone', desc: 'Export data · transfer ownership · delete org' },
] as const;
type Tab = (typeof TABS)[number]['id'];

// Provider catalogue moved to ./mcp-providers.ts (single source of truth shared
// with forms.component.ts — see task #34 deduplication).
const PROVIDERS = MCP_PROVIDERS;

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [FormsModule, DatePipe, SlicePipe, RouterLink, AiChatExtrasComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Settings</h2>
          @if (state.selectedSite(); as site) {
            <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
              Scoped to <strong class="text-white">{{ site.business_name || site.slug }}</strong>
              <span class="text-text-secondary/60"> · per-project settings. For personal preferences (theme, API keys) see </span>
              <a routerLink="/admin/user" class="text-primary hover:underline">your user settings</a>.
            </p>
          } @else {
            <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Select a project from the top dropdown to edit its settings.</p>
          }
        </div>
        <input class="input-field" placeholder="Filter tabs (Cmd-K)…" [(ngModel)]="q" />
      </header>

      <nav class="flex gap-2 flex-wrap text-[0.78rem]">
        @for (t of filteredTabs(); track t.id) {
          <button class="tab" [class.active]="tab() === t.id" (click)="setTab(t.id)" [title]="t.desc">{{ t.label }}</button>
        }
      </nav>

      <!-- ─────────────────── GENERAL ─────────────────── -->
      @if (tab() === 'general') {
        <section class="card grid md:grid-cols-2 gap-5">
          <div class="md:col-span-2">
            <h3 class="m-0 text-base font-semibold text-white mb-1">General</h3>
            <p class="text-[0.7rem] text-text-secondary m-0">Public-facing details + how the AI router responds.</p>
          </div>
          <label class="block">
            <span class="muted-h">Contact email <small class="text-text-secondary/60">(shown on your site)</small></span>
            <input type="email" class="input-field w-full mt-1" placeholder="hello@yourbiz.com" [(ngModel)]="settings.contact_email" />
          </label>
          <label class="block">
            <span class="muted-h">Reply email <small class="text-text-secondary/60">(where the AI router sends contact-form messages)</small></span>
            <input type="email" class="input-field w-full mt-1" placeholder="owner@yourbiz.com" [(ngModel)]="settings.reply_email" />
          </label>
          <label class="block">
            <span class="muted-h">Brand tone</span>
            <input type="text" class="input-field w-full mt-1" placeholder="warm · plainspoken · never pushy" [(ngModel)]="settings.brand_tone" />
          </label>
          <label class="block">
            <span class="muted-h">Timezone</span>
            <select class="input-field w-full mt-1" [(ngModel)]="settings.timezone">
              <option value="">Auto-detect</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="America/Chicago">America/Chicago</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
            </select>
          </label>
          <label class="block">
            <span class="muted-h">Default locale</span>
            <select class="input-field w-full mt-1" [(ngModel)]="settings.default_locale">
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Español</option>
              <option value="fr-FR">Français</option>
              <option value="de-DE">Deutsch</option>
              <option value="ja-JP">日本語</option>
            </select>
          </label>
          <label class="block">
            <span class="muted-h">Brand primary color</span>
            <div class="flex items-center gap-2 mt-1">
              <input type="color" class="h-9 w-12 rounded border-0 bg-transparent cursor-pointer" [(ngModel)]="settings.brand_primary" />
              <input type="text" class="input-field flex-1 font-mono" placeholder="#00E5FF" [(ngModel)]="settings.brand_primary" />
            </div>
          </label>
          <label class="block">
            <span class="muted-h">Brand accent color</span>
            <div class="flex items-center gap-2 mt-1">
              <input type="color" class="h-9 w-12 rounded border-0 bg-transparent cursor-pointer" [(ngModel)]="settings.brand_accent" />
              <input type="text" class="input-field flex-1 font-mono" placeholder="#7C3AED" [(ngModel)]="settings.brand_accent" />
            </div>
          </label>
          <!-- Live brand preview -->
          <div class="md:col-span-2">
            <span class="muted-h">Brand preview</span>
            <div class="brand-preview mt-1" [style.--bp-primary]="settings.brand_primary || '#00E5FF'" [style.--bp-accent]="settings.brand_accent || '#7C3AED'">
              <div class="bp-bar"><span class="bp-dot"></span><span class="bp-dot bp-dot-accent"></span><span class="bp-flush">{{ settings.contact_email || 'hello@yourbiz.com' }}</span></div>
              <div class="bp-cta">Book a call →</div>
              <div class="bp-chip">{{ settings.brand_tone || 'warm · plainspoken · brief' }}</div>
            </div>
          </div>

          <div class="md:col-span-2 flex justify-end gap-2">
            <button class="btn-ghost" (click)="loadGeneral()">Cancel</button>
            <button class="btn-primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save general settings' }}</button>
          </div>
        </section>
      }

      <!-- ─────────────────── TEAM ─────────────────── -->
      @else if (tab() === 'team') {
        <section class="card">
          <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h3 class="m-0 text-base font-semibold text-white">Team members</h3>
            <div class="flex items-center gap-3">
              <!-- 2FA toggle — moved from the deleted Security tab. Lives directly
                   to the LEFT of "Invite" so the workspace-owner can flip it in
                   the same context as inviting people. Persists to /admin/security. -->
              <label class="flex items-center gap-2 text-[0.74rem] cursor-pointer select-none px-2.5 py-1.5 rounded-lg border border-white/[0.08] hover:border-primary/40 transition-colors"
                     title="Require every member of this workspace to enroll a TOTP authenticator before signing in.">
                <input type="checkbox"
                       class="accent-primary"
                       [checked]="security.require_2fa"
                       (change)="toggleRequire2FA($event)"
                       [disabled]="savingSecurity()" />
                <span class="text-text-secondary">Require 2FA</span>
                @if (savingSecurity()) {
                  <span class="text-[0.6rem] text-text-secondary/60">saving…</span>
                }
              </label>
              <button class="btn-primary" (click)="inviting.set(true)">+ Invite</button>
            </div>
          </div>
          @if (inviting()) {
            <div class="card-light p-3 mb-3 grid sm:grid-cols-3 gap-2">
              <input type="email" class="input-field" placeholder="teammate@email.com" [(ngModel)]="invite.email" />
              <select class="input-field" [(ngModel)]="invite.role">
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <div class="flex gap-2 justify-end">
                <button class="btn-ghost" (click)="inviting.set(false)">Cancel</button>
                <button class="btn-primary" (click)="sendInvite()">Send invite</button>
              </div>
            </div>
          }
          @if (members().length === 0 && invites().length === 0) {
            <div class="p-6 text-center text-text-secondary text-sm">Just you on this org.</div>
          } @else {
            <table class="w-full text-[0.78rem]">
              <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
                <tr class="border-b border-white/[0.06]">
                  <th class="text-left p-2">Email</th><th class="text-left p-2">Role</th><th class="text-left p-2">Joined</th><th class="text-right p-2"></th>
                </tr>
              </thead>
              <tbody>
                @for (m of members(); track m.id) {
                  <tr class="border-b border-white/[0.04]">
                    <td class="p-2">{{ m.email }}</td>
                    <td class="p-2"><span class="badge">{{ m.role }}</span></td>
                    <td class="p-2 text-text-secondary">{{ m.created_at | date:'short' }}</td>
                    <td class="p-2 text-right">
                      <button class="text-red-400 text-[0.72rem] disabled:text-text-secondary/40 disabled:cursor-not-allowed"
                              [disabled]="isLastOwner(m)"
                              [title]="isLastOwner(m) ? 'Cannot remove the last owner — promote someone else first.' : 'Remove ' + m.email"
                              (click)="removeMember(m)">Remove</button>
                    </td>
                  </tr>
                }
                @for (i of invites(); track i.id) {
                  <tr class="border-b border-white/[0.04] bg-amber-500/[0.04]">
                    <td class="p-2">{{ i.email }} <span class="text-[0.6rem] text-amber-300 ml-1">PENDING</span></td>
                    <td class="p-2"><span class="badge">{{ i.role }}</span></td>
                    <td class="p-2 text-text-secondary">invited {{ i.created_at | date:'short' }}</td>
                    <td class="p-2 text-right"><button class="text-red-400 text-[0.72rem]" (click)="revokeInvite(i)">Revoke</button></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }

      <!-- ─────────────────── AI CHAT ─────────────────── -->
      @else if (tab() === 'ai-chat') {
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-1">AI Chat</h3>
          <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Persona + system prompt + MCP allow-list for the AI chat widget on your published site.</p>
          <label class="block mb-3">
            <div class="flex items-center justify-between">
              <span class="muted-h">Persona (one line)</span>
              <button class="btn-ghost text-[0.66rem]" (click)="improveChatField('persona')" [disabled]="improvingField() === 'persona'" title="Rewrite this persona with the brand AI">{{ improvingField() === 'persona' ? 'Improving…' : '✨ Improve with AI' }}</button>
            </div>
            <input type="text" class="input-field w-full mt-1" placeholder="warm, plainspoken, never pushy" [(ngModel)]="chat.persona" />
          </label>
          <label class="block mb-3">
            <div class="flex items-center justify-between">
              <span class="muted-h">System prompt</span>
              <button class="btn-ghost text-[0.66rem]" (click)="improveChatField('system')" [disabled]="improvingField() === 'system'" title="Rewrite this system prompt for clarity + concrete behavioral rules">{{ improvingField() === 'system' ? 'Improving…' : '✨ Improve with AI' }}</button>
            </div>
            <textarea class="input-field w-full mt-1 font-mono text-[0.72rem]" rows="8"
                      [placeholder]="chat.system_prompt_default || 'You are the AI concierge for [business]. Concise. Never invent prices.'"
                      [(ngModel)]="chat.system_prompt"></textarea>
            @if (chat.system_prompt_default) {
              <button type="button" class="btn-ghost text-[0.62rem] mt-1"
                      (click)="chat.system_prompt = chat.system_prompt_default || ''" title="Replace with the latest factory v2 default">Use the v2 best-prompt default</button>
            }
          </label>

          <!-- MCP allow-list — mirrors the Form Handling Prompt modal -->
          <div class="block mb-3">
            <span class="muted-h">MCP integrations available to AI Chat</span>
            <p class="text-[0.66rem] text-text-secondary m-0 mt-1 mb-2">Check any connected MCP you want the chat to be allowed to call. Unchecked = connected but never offered as a tool to the chat.</p>
            <div class="space-y-1.5">
              @for (m of connections(); track m.id) {
                <label class="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-white/[0.04]" [title]="m.provider + ' — toggle availability for AI Chat'">
                  <input type="checkbox" [checked]="chatMcps().includes(m.provider)" (change)="toggleChatMcp(m.provider)" />
                  <span class="badge">{{ m.provider }}</span>
                  <span class="text-[0.66rem] text-text-secondary flex-1 truncate">{{ m.display_name || m.provider }}</span>
                </label>
              }
              @if (connections().length === 0) {
                <a routerLink="." [fragment]="'mcp'" class="text-[0.7rem] text-primary underline">+ Connect MCPs in the MCP tab</a>
              }
            </div>
          </div>

          <div class="flex justify-end">
            <button class="btn-primary" [disabled]="savingChat()" (click)="saveChat()">{{ savingChat() ? 'Saving…' : 'Save AI Chat settings' }}</button>
          </div>
        </section>

        <!-- Extras: web research toggle, knowledge file uploads, Google Drive
             folder monitoring, and the "View Context Summary" modal. Lives in
             its own component so settings.component.ts stays focused on the
             tabbed shell. siteId is reactive — switching projects re-runs the
             extras' effects automatically. -->
        @if (state.selectedSite(); as site) {
          <app-ai-chat-extras [siteId]="site.id" />
        }
      }

      <!-- Theme moved → /admin/user (user-level, not per-project). -->

      <!-- ─────────────────── MCP ─────────────────── -->
      @else if (tab() === 'mcp') {
        <section class="card">
          <h3 class="m-0 text-base font-semibold text-white mb-1">MCP integrations</h3>
          <p class="text-[0.7rem] text-text-secondary m-0 mb-4">
            Connect the tools your AI form router + custom endpoints can call. Tokens are encrypted at rest (AES-GCM).
            OAuth follows the MCP authorization spec (OAuth 2.1 + PKCE where supported); paste-key for the rest.
          </p>
          <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            @for (p of providers; track p.id) {
              <article class="card-light p-4 flex flex-col gap-2">
                <div class="flex items-start gap-3">
                  <div class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[0.9rem]"
                       [style.background]="p.color + '20'" [style.color]="p.color">{{ p.label[0] }}</div>
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-white">{{ p.label }}</div>
                    <div class="text-[0.68rem] text-text-secondary leading-snug">{{ p.desc }}</div>
                  </div>
                </div>
                @if (isConnected(p.id); as c) {
                  <div class="flex items-center justify-between mt-1 text-[0.72rem]">
                    <span class="text-emerald-400">● Connected · {{ c.connected_at | slice:0:10 }}</span>
                    <button class="text-red-400 underline" (click)="disconnect(c)">Disconnect</button>
                  </div>
                } @else if (pasteMode() === p.id) {
                  <div class="mt-1 flex gap-2">
                    <input type="password" class="input-field flex-1 font-mono text-[0.72rem]"
                           [placeholder]="pastePlaceholder(p.id)" [(ngModel)]="pastedKey" />
                    <button class="btn-primary" (click)="submitPaste(p.id)">Save</button>
                  </div>
                } @else {
                  <button class="btn-primary mt-1 self-start" (click)="connect(p)">
                    {{ p.needsOauth ? 'Connect ' + p.label : 'Paste API key' }}
                  </button>
                }
              </article>
            }
          </div>
        </section>
      }

      <!-- Security tab removed entirely:
           · API keys → /admin/user
           · 2FA toggle → Team tab (next to Invite)
           · Session lifetime + idle timeout removed (too complex for our users) -->

      <!-- Domains UI moved to its own per-project route at /admin/domains. -->

      <!-- ─────────────────── DANGER ZONE ─────────────────── -->
      @else if (tab() === 'danger') {
        <section class="card border border-red-500/30 bg-red-500/[0.04]">
          <h3 class="m-0 text-base font-semibold text-white mb-1">Danger zone</h3>
          <p class="text-[0.7rem] text-text-secondary m-0 mb-4">Irreversible actions. Each requires a confirmation prompt.</p>
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="font-semibold text-white">Export all data</div>
                <div class="text-[0.7rem] text-text-secondary">Download a single zip with all sites, snapshots, form submissions, and AI logs.</div>
              </div>
              <button class="btn-ghost border-amber-500/40 text-amber-300" (click)="exportData()">Export</button>
            </div>
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="font-semibold text-white">Transfer ownership</div>
                <div class="text-[0.7rem] text-text-secondary">Move this org to another owner. They must accept within 14 days.</div>
                @if (pendingTransfers().length > 0) {
                  <div class="mt-2 text-[0.7rem]">
                    @for (t of pendingTransfers(); track t.id) {
                      <div class="flex items-center justify-between gap-3 py-1">
                        <span class="text-amber-300">Pending → {{ t.to_email }} (expires {{ t.expires_at | date:'mediumDate' }})</span>
                        <button class="text-red-400 underline" (click)="cancelTransfer(t.id)">Cancel</button>
                      </div>
                    }
                  </div>
                }
              </div>
              @if (transferOpen()) {
                <div class="flex items-center gap-2">
                  <input type="email" class="input-field w-56" placeholder="new-owner@example.com" [(ngModel)]="transferEmail" />
                  <button class="btn-primary" (click)="submitTransfer()" [disabled]="submittingTransfer()">{{ submittingTransfer() ? '…' : 'Confirm' }}</button>
                  <button class="btn-ghost" (click)="transferOpen.set(false)">Cancel</button>
                </div>
              } @else {
                <button class="btn-ghost border-amber-500/40 text-amber-300" (click)="openTransfer()">Transfer…</button>
              }
            </div>
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="font-semibold text-red-300">Delete organization</div>
                <div class="text-[0.7rem] text-text-secondary">Permanently delete this org, all sites, and all data. Cannot be undone.</div>
              </div>
              <button class="btn-ghost border-red-500/40 text-red-300" (click)="deleteOrg()">Delete org…</button>
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    .card-light { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
    .tab { padding: 0.4rem 0.95rem; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); cursor: pointer; font-size: 0.74rem; font-weight: 600; transition: all 120ms ease; }
    .tab:hover { color: #fff; border-color: rgba(0,229,255,0.25); }
    .tab.active { background: rgba(0,229,255,0.12); color: #00E5FF; border-color: rgba(0,229,255,0.35); }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(0,229,255,0.1); color: #00E5FF; }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field:focus { outline: none; border-color: rgba(0,229,255,0.45); }
    .btn-primary { padding: 0.45rem 0.95rem; border-radius: 8px; background: rgba(0,229,255,0.12); color: #00E5FF; font-weight: 600; border: 1px solid rgba(0,229,255,0.35); cursor: pointer; font-size: 0.74rem; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
    .brand-preview { display: flex; align-items: center; gap: 0.85rem; padding: 0.95rem 1.1rem; border-radius: 12px; background: linear-gradient(135deg, color-mix(in oklab, var(--bp-primary) 22%, transparent), color-mix(in oklab, var(--bp-accent) 14%, transparent)); border: 1px solid color-mix(in oklab, var(--bp-primary) 28%, transparent); }
    .bp-bar { display: inline-flex; align-items: center; gap: 6px; padding: 0.32rem 0.7rem; border-radius: 999px; background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.8); font-size: 0.72rem; }
    .bp-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--bp-primary); box-shadow: 0 0 8px var(--bp-primary); }
    .bp-dot-accent { background: var(--bp-accent); box-shadow: 0 0 8px var(--bp-accent); }
    .bp-flush { font-family: ui-monospace, monospace; font-size: 0.66rem; opacity: 0.8; }
    .bp-cta { padding: 0.4rem 0.95rem; border-radius: 999px; background: linear-gradient(135deg, var(--bp-primary), var(--bp-accent)); color: #060610; font-weight: 700; font-size: 0.78rem; }
    .bp-chip { padding: 0.18rem 0.6rem; border-radius: 999px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); font-size: 0.66rem; }
    .theme-card { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.85rem; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: all 160ms ease; text-align: left; }
    .theme-card:hover { border-color: rgba(0,229,255,0.35); transform: translateY(-1px); }
    .theme-card.active { border-color: rgba(0,229,255,0.6); background: rgba(0,229,255,0.08); box-shadow: 0 0 0 3px rgba(0,229,255,0.12); }
    .theme-swatch { width: 100%; height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); }
    .theme-swatch.dk { background: linear-gradient(135deg, #06061a, #0a0a28); }
    .theme-swatch.lt { background: linear-gradient(135deg, #f8fafc, #cbd5e1); }
    .theme-swatch.sy { background: linear-gradient(135deg, #06061a 0 50%, #f8fafc 50% 100%); }
    .status-pill { font-size: 0.62rem; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.75); border: 1px solid rgba(255,255,255,0.08); }
    .status-pill.is-active { background: rgba(16,185,129,0.12); color: #34d399; border-color: rgba(16,185,129,0.3); }
    .status-pill.is-pending { background: rgba(251,191,36,0.12); color: #fbbf24; border-color: rgba(251,191,36,0.3); }
    .status-pill.is-error { background: rgba(239,68,68,0.12); color: #f87171; border-color: rgba(239,68,68,0.3); }
  `],
})
export class AdminSettingsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  tab = signal<Tab>('general');
  q = '';
  saving = signal(false);
  savingChat = signal(false);
  inviting = signal(false);

  // AI Chat tab
  chat: { persona: string; system_prompt: string; system_prompt_default: string } = { persona: '', system_prompt: '', system_prompt_default: '' };
  saveChat(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.savingChat.set(true);
    this.api.put(`/sites/${s.id}/ai-settings`, { chat_persona: this.chat.persona, chat_system_prompt: this.chat.system_prompt }).subscribe({
      next: () => { this.toast.success('AI Chat settings saved'); this.savingChat.set(false); },
      error: () => { this.toast.error('Save failed'); this.savingChat.set(false); },
    });
  }

  // Theme picker moved to /admin/user (user-level, not per-project).
  settings: GeneralSettings = { contact_email: '', reply_email: '', brand_tone: '', brand_primary: '#00E5FF', brand_accent: '#7C3AED', timezone: '', default_locale: 'en-US' };
  security: { session_hours: number; idle_minutes: number; allowed_domains: string; require_2fa: boolean } = { session_hours: 168, idle_minutes: 60, allowed_domains: '', require_2fa: false };
  members = signal<Member[]>([]);
  invites = signal<Invite[]>([]);
  invite: { email: string; role: string } = { email: '', role: 'editor' };

  providers = PROVIDERS;
  connections = signal<Conn[]>([]);
  pasteMode = signal<string | null>(null);
  pastedKey = '';

  filteredTabs = computed(() => {
    const q = this.q.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((t) => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
  });

  ngOnInit(): void {
    const child = this.route.firstChild;
    const initial = (child?.snapshot.url[0]?.path ?? this.route.snapshot.fragment ?? 'general') as Tab;
    if (TABS.some((t) => t.id === initial)) this.tab.set(initial);
    this.loadGeneral();
    this.loadTeam();
    this.loadConnections();
    this.handleMcpReturn();
  }

  setTab(id: Tab): void {
    this.tab.set(id);
    this.router.navigate([], { fragment: id, replaceUrl: true });
    // Lazy-load per-tab data on open.
    if (id === 'team') this.loadSecurity();
  }

  /**
   * Loads org-level 2FA-required flag. Other "security defaults" (session_hours,
   * idle_minutes, allowed_domains) were removed from the UI — backend keeps the
   * columns for forward-compat but the admin no longer surfaces them.
   */
  loadSecurity(): void {
    type Sec = { session_hours: number; idle_minutes: number; allowed_domains: string | null; require_2fa: number };
    this.api.get<{ data: Sec }>('/admin/security').subscribe({
      next: (r) => {
        if (!r.data) return;
        this.security = {
          ...this.security,
          require_2fa: !!r.data.require_2fa,
        };
      },
    });
  }

  /**
   * 2FA toggle handler on the Team tab. Persists the new value immediately —
   * no separate "Save" button to match the spec ("just enable/disable").
   */
  toggleRequire2FA(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    const next = target.checked;
    this.security = { ...this.security, require_2fa: next };
    this.savingSecurity.set(true);
    this.api.put('/admin/security', { ...this.security, require_2fa: next }).subscribe({
      next: () => {
        this.savingSecurity.set(false);
        this.toast.success(next ? '2FA now required for all members' : '2FA requirement disabled');
      },
      error: () => {
        this.savingSecurity.set(false);
        // Revert optimistic toggle on failure.
        this.security = { ...this.security, require_2fa: !next };
        target.checked = !next;
        this.toast.error('Could not update 2FA setting');
      },
    });
  }

  loadGeneral(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: GeneralSettings & { chat_persona?: string; chat_system_prompt?: string; chat_system_prompt_default?: string } }>(`/sites/${s.id}/ai-settings`).subscribe({
      next: (r) => {
        this.settings = {
          contact_email: r.data?.contact_email ?? '',
          reply_email: r.data?.reply_email ?? '',
          brand_tone: r.data?.brand_tone ?? '',
          brand_primary: r.data?.brand_primary ?? '#00E5FF',
          brand_accent: r.data?.brand_accent ?? '#7C3AED',
          timezone: r.data?.timezone ?? '',
          default_locale: r.data?.default_locale ?? 'en-US',
        };
        this.chat = {
          persona: r.data?.chat_persona ?? '',
          system_prompt: r.data?.chat_system_prompt ?? '',
          system_prompt_default: r.data?.chat_system_prompt_default ?? '',
        };
      },
    });
  }
  save(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.saving.set(true);
    this.api.put(`/sites/${s.id}/ai-settings`, this.settings).subscribe({
      next: () => { this.toast.success('Saved'); this.saving.set(false); },
      error: () => { this.toast.error('Save failed'); this.saving.set(false); },
    });
  }
  loadTeam(): void {
    this.api.get<{ data: { members: Member[]; invites: Invite[] } }>('/team').subscribe({
      next: (r) => { this.members.set(r.data?.members ?? []); this.invites.set(r.data?.invites ?? []); },
    });
  }
  sendInvite(): void {
    this.api.post('/team/invites', this.invite).subscribe({
      next: () => { this.toast.success(`Invited ${this.invite.email}`); this.invite = { email: '', role: 'editor' }; this.inviting.set(false); this.loadTeam(); },
      error: () => this.toast.error('Invite failed'),
    });
  }
  revokeInvite(i: Invite): void {
    this.api.delete(`/team/invites/${i.id}`).subscribe({ next: () => { this.toast.success('Revoked'); this.loadTeam(); } });
  }
  removeMember(m: Member): void {
    if (this.isLastOwner(m)) {
      this.toast.error('Cannot remove the last owner. Promote another member to owner first.');
      return;
    }
    if (!confirm(`Remove ${m.email}?`)) return;
    this.api.delete(`/team/members/${m.id}`).subscribe({ next: () => { this.toast.success('Removed'); this.loadTeam(); } });
  }
  isLastOwner(m: Member): boolean {
    if (m.role !== 'owner') return false;
    return this.members().filter((x) => x.role === 'owner').length <= 1;
  }

  // ── MCP ──
  loadConnections(): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.get<{ data: { connections: Conn[] } }>(`/sites/${s.id}/mcp/connections`).subscribe({
      next: (r) => this.connections.set(r.data?.connections ?? []),
    });
  }
  isConnected(provider: string): Conn | null {
    return this.connections().find((c) => c.provider === provider) ?? null;
  }
  pastePlaceholder(provider: string): string {
    switch (provider) {
      case 'resend': return 're_xxx';
      case 'slack': return 'xoxb-xxx (Slack bot token)';
      case 'notion': return 'secret_xxx (Notion integration token)';
      case 'github': return 'ghp_xxx (fine-grained PAT)';
      case 'linear': return 'lin_api_xxx';
      case 'discord': return 'https://discord.com/api/webhooks/…';
      case 'google_calendar': return 'ya29.xxx (OAuth access token)';
      case 'twilio': return 'ACxxxx:yourAuthToken';
      case 'calendly': return 'eyJ… (personal access token)';
      case 'airtable': return 'patxxx';
      case 'zapier': return 'https://hooks.zapier.com/…';
      default: return 'paste API key';
    }
  }
  connect(p: { id: string; needsOauth: boolean }): void {
    const s = this.state.selectedSite(); if (!s) return;
    if (!p.needsOauth || p.id === 'resend') { this.pasteMode.set(p.id); return; }
    window.location.href = `/api/mcp/${p.id}/connect?site_id=${s.id}&return_url=${encodeURIComponent('/admin/settings#mcp')}`;
  }
  submitPaste(provider: string): void {
    const s = this.state.selectedSite(); if (!s) return;
    this.api.post(`/api/mcp/${provider}/paste?site_id=${s.id}`, { api_key: this.pastedKey }).subscribe({
      next: () => { this.pastedKey = ''; this.pasteMode.set(null); this.toast.success(`Connected ${provider}`); this.loadConnections(); },
      error: () => this.toast.error('Failed'),
    });
  }
  disconnect(c: Conn): void {
    if (!confirm(`Disconnect ${c.provider}?`)) return;
    const s = this.state.selectedSite(); if (!s) return;
    this.api.delete(`/sites/${s.id}/mcp/connections/${c.id}`).subscribe({
      next: () => { this.toast.success('Disconnected'); this.loadConnections(); },
    });
  }
  handleMcpReturn(): void {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (connected) {
      this.toast.success(`${connected} connected`);
      history.replaceState({}, '', '/admin/settings#mcp');
      this.tab.set('mcp');
      setTimeout(() => this.loadConnections(), 200);
    }
  }

  // API keys moved to /admin/user. Domain management moved to /admin/domains.

  // ── Danger zone ──
  exportData(): void {
    if (!confirm('Generate a data-export bundle? You will get a JSON file with every site, snapshot, AI log, hostname, form submission, and team record for this org.')) return;
    this.api.post<{ data: { id: string; status: string; poll: string } }>('/admin/org/export', {}).subscribe({
      next: (r) => {
        const exportId = r.data.id;
        this.toast.success('Export queued — polling for download link…');
        // Poll every 2 s until the export finishes (typical: 1-5 s for an org-sized JSON).
        const tick = (): void => {
          this.api.get<{ data: { status: string; download_url: string | null; error: string | null } }>(`/admin/org/export/${exportId}`).subscribe({
            next: (s) => {
              if (s.data.status === 'ready' && s.data.download_url) {
                this.toast.success('Export ready — opening…');
                // Auth-aware download: fetch via ApiService blob, trigger save.
                this.api.get<Blob>(`/admin/org/export/${exportId}/download`).subscribe({
                  next: (blob) => {
                    const url = URL.createObjectURL(blob as Blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `projectsites-export-${exportId}.json`; a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1500);
                  },
                  error: () => this.toast.error('Download failed — try again'),
                });
              } else if (s.data.status === 'error') {
                this.toast.error(`Export failed: ${s.data.error ?? 'unknown'}`);
              } else {
                setTimeout(tick, 2000);
              }
            },
            error: () => this.toast.error('Lost export status; check Audit Log'),
          });
        };
        setTimeout(tick, 1500);
      },
      error: () => this.toast.error('Could not queue export'),
    });
  }
  deleteOrg(): void {
    const txt = prompt(
      'Type DELETE to permanently delete this organization and ALL its data.\n\n' +
      'This soft-deletes all sites, members, invites, API keys, and the org itself. A 30-day grace window applies before R2 + D1 purge.',
    );
    if (txt !== 'DELETE') return;
    this.api.post<{ data: { deleted: boolean } }>('/admin/org/delete', { confirm: 'DELETE' }).subscribe({
      next: () => {
        this.toast.success('Org deleted — signing you out');
        try { localStorage.removeItem('ps_session'); } catch { /* */ }
        setTimeout(() => { window.location.href = '/'; }, 1200);
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Delete failed'),
    });
  }

  // ── Security defaults (only 2FA toggle is surfaced — see toggleRequire2FA above) ──
  savingSecurity = signal(false);

  // ── AI Chat: Improve persona / system prompt + MCP allow-list ──
  improvingField = signal<'persona' | 'system' | null>(null);
  chatMcps = signal<string[]>(((): string[] => {
    try { return JSON.parse(localStorage.getItem('ps_chat_mcps') ?? '[]'); } catch { return []; }
  })());
  toggleChatMcp(provider: string): void {
    const cur = this.chatMcps();
    const next = cur.includes(provider) ? cur.filter((p) => p !== provider) : [...cur, provider];
    this.chatMcps.set(next);
    try { localStorage.setItem('ps_chat_mcps', JSON.stringify(next)); } catch { /* */ }
  }
  improveChatField(field: 'persona' | 'system'): void {
    const s = this.state.selectedSite(); if (!s) { this.toast.error('Select a site first'); return; }
    const value = field === 'persona' ? this.chat.persona : this.chat.system_prompt;
    this.improvingField.set(field);
    this.api.post<{ data: { improved: string; original: string } }>(
      `/sites/${s.id}/ai-settings/improve`,
      { field, value },
    ).subscribe({
      next: (r) => {
        this.improvingField.set(null);
        const improved = r.data?.improved?.trim();
        if (!improved) { this.toast.info('No improvement suggested'); return; }
        if (field === 'persona') this.chat.persona = improved;
        else this.chat.system_prompt = improved;
        this.toast.success('Improved with AI — review + save');
      },
      error: () => { this.improvingField.set(null); this.toast.error('AI improve failed'); },
    });
  }

  // ── Transfer ownership ──
  transferOpen = signal(false);
  submittingTransfer = signal(false);
  transferEmail = '';
  pendingTransfers = signal<{ id: string; to_email: string; expires_at: string; created_at: string }[]>([]);
  openTransfer(): void {
    this.transferOpen.set(true);
    this.loadTransfers();
  }
  loadTransfers(): void {
    this.api.get<{ data: { id: string; to_email: string; expires_at: string; created_at: string }[] }>('/team/transfer').subscribe({
      next: (r) => this.pendingTransfers.set(r.data ?? []),
      error: () => this.pendingTransfers.set([]),
    });
  }
  submitTransfer(): void {
    const to = this.transferEmail.trim();
    if (!to.includes('@')) { this.toast.error('Enter a valid email'); return; }
    if (!confirm(`Transfer org ownership to ${to}? They have 14 days to accept.`)) return;
    this.submittingTransfer.set(true);
    this.api.post('/team/transfer', { to_email: to }).subscribe({
      next: () => {
        this.submittingTransfer.set(false);
        this.transferEmail = '';
        this.transferOpen.set(false);
        this.toast.success(`Transfer sent to ${to}. They have 14 days to accept.`);
        this.loadTransfers();
      },
      error: () => { this.submittingTransfer.set(false); this.toast.error('Transfer failed — only the owner can initiate.'); },
    });
  }
  cancelTransfer(id: string): void {
    if (!confirm('Cancel this pending transfer?')) return;
    this.api.delete(`/team/transfer/${id}`).subscribe({
      next: () => { this.toast.success('Transfer cancelled'); this.loadTransfers(); },
    });
  }
}
