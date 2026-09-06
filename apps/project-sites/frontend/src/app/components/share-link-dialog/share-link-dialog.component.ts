/**
 * @component ShareLinkDialogComponent
 * @description The "Share link" modal — replaces the old `/admin/review-links`
 * page. One click creates a shareable preview+approve link for the selected
 * site, auto-copies it to the clipboard, and (optionally) protects it with a
 * password. Built on the shared {@link DialogShellComponent} (cyan/black
 * cockpit) and the existing `approval_workflow`-gated `/api/sites/:id/review-links`
 * endpoint.
 *
 * Beyond the de-facto "Share link" flow, this adds:
 *   - auto-copy on create (link, and link+password together when protected),
 *   - an auto-generated *memorable* passphrase (word-word-NN! — easy to read aloud),
 *   - a live password-strength meter + show/hide,
 *   - expiry presets (1 / 7 / 30 / 90 days),
 *   - the list of existing links (so removing the page loses nothing), each copyable.
 *
 * Flag OFF (404) → a calm "enable in Feature Flags" notice, never an alarming error.
 */

import { Component, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';
import { HlmButtonDirective, HlmInputDirective } from '../../ui';

interface ShareLink {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
  url: string;
  expiresAt: string;
  usedAt: string | null;
  passwordProtected: boolean;
}

interface CreatedLink {
  url: string;
  passwordProtected: boolean;
  /** The plaintext password is held in memory ONLY for the "copy" affordance — never persisted. */
  password: string | null;
}

/** Readable passphrase parts — adjective-noun keeps generated passwords easy to dictate. */
const PW_ADJECTIVES = ['amber', 'brisk', 'cobalt', 'dapper', 'eager', 'fleet', 'golden', 'hardy', 'ivory', 'jolly', 'keen', 'lucid', 'mellow', 'nimble', 'opal', 'prime', 'quartz', 'rapid', 'solar', 'tidal', 'vivid', 'witty', 'zesty'];
const PW_NOUNS = ['otter', 'falcon', 'cedar', 'harbor', 'comet', 'meadow', 'lantern', 'canyon', 'ember', 'willow', 'beacon', 'pebble', 'marlin', 'thistle', 'cobble', 'summit', 'ripple', 'maple', 'quasar', 'cinder'];

@Component({
  selector: 'app-share-link-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DialogShellComponent, HlmButtonDirective, HlmInputDirective],
  template: `
    <app-dialog-shell (closed)="close()">
      <svg dialogIcon width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
      </svg>
      <span dialogTitle>Share link</span>

      <div class="px-5 py-4 w-full" style="min-width: min(92vw, 30rem); max-width: 34rem;">
        @if (flagDisabled()) {
          <div data-testid="share-link-flag-gate" class="rounded-xl border border-primary/30 bg-primary/[0.06] p-4 text-sm text-text-secondary">
            Sharing isn't enabled yet. Turn on <strong class="text-light">approval_workflow</strong> in
            <a class="text-primary underline" routerLink="/admin/feature-flags" (click)="close()">Feature Flags</a> to create share links.
          </div>
        } @else if (created(); as c) {
          <!-- Result view: link is already on the clipboard. -->
          <div data-testid="share-link-created" role="status" class="rounded-xl border border-primary/30 bg-primary/[0.06] p-4">
            <p class="text-sm text-light font-semibold mb-2 flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-primary" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              Link created &amp; copied
            </p>
            <code class="block text-[0.8rem] text-primary break-all bg-black/30 rounded-lg px-3 py-2 mb-3" data-testid="share-link-url">{{ c.url }}</code>

            @if (c.passwordProtected && c.password) {
              <div class="rounded-lg bg-black/30 px-3 py-2 mb-3 flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <span class="block text-[0.65rem] uppercase tracking-wide text-text-secondary">Password</span>
                  <code class="text-[0.85rem] text-light break-all" data-testid="share-link-created-password">{{ c.password }}</code>
                </div>
                <span class="text-[0.6rem] uppercase tracking-wide text-amber-300/90 shrink-0">share separately</span>
              </div>
            }

            <div class="flex flex-wrap gap-2">
              <button hlmBtn size="sm" data-testid="share-link-copy" (click)="copy(c.url, 'Link')">{{ copiedLabel() === 'Link' ? 'Copied!' : 'Copy link' }}</button>
              @if (c.passwordProtected && c.password) {
                <button hlmBtn variant="outline" size="sm" data-testid="share-link-copy-both" (click)="copyLinkAndPassword(c)">{{ copiedLabel() === 'Both' ? 'Copied!' : 'Copy link + password' }}</button>
              }
              <button hlmBtn variant="ghost" size="sm" data-testid="share-link-new" (click)="reset()">Create another</button>
            </div>
          </div>
        } @else {
          <!-- Create form -->
          <p class="text-sm text-text-secondary mb-4">Create a private link a stakeholder can open to preview and approve this site before it goes live.</p>

          <label class="block text-[0.72rem] uppercase tracking-wide text-text-secondary mb-1.5">Expires after</label>
          <div class="flex flex-wrap gap-2 mb-4" role="group" aria-label="Link expiry">
            @for (p of expiryPresets; track p.days) {
              <button type="button" [attr.data-testid]="'share-link-expiry-' + p.days"
                      [attr.aria-pressed]="expiryDays() === p.days"
                      (click)="expiryDays.set(p.days)"
                      class="px-3 py-1.5 rounded-lg text-[0.8rem] border transition-colors"
                      [class.border-primary]="expiryDays() === p.days" [class.text-primary]="expiryDays() === p.days" [class.bg-primary]="false"
                      [class.bg-primary\\/10]="expiryDays() === p.days"
                      [class.border-white\\/10]="expiryDays() !== p.days" [class.text-text-secondary]="expiryDays() !== p.days">
                {{ p.label }}
              </button>
            }
          </div>

          <label class="flex items-center gap-2.5 mb-3 cursor-pointer select-none">
            <input type="checkbox" data-testid="share-link-password-toggle" [checked]="passwordEnabled()" (change)="togglePassword($event)" class="accent-[color:var(--ps-accent)] w-4 h-4" />
            <span class="text-sm text-light">Require a password</span>
          </label>

          @if (passwordEnabled()) {
            <div class="mb-4" data-testid="share-link-password-row">
              <div class="flex gap-2">
                <input hlmInput [type]="showPassword() ? 'text' : 'password'" data-testid="share-link-password-input"
                       [ngModel]="password()" (ngModelChange)="password.set($event)"
                       placeholder="Set a password" autocomplete="new-password" class="flex-1"
                       [attr.aria-invalid]="!!passwordError()" aria-describedby="share-link-pw-hint" />
                <button hlmBtn variant="outline" size="sm" type="button" data-testid="share-link-password-show" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'" (click)="showPassword.set(!showPassword())">{{ showPassword() ? 'Hide' : 'Show' }}</button>
                <button hlmBtn variant="ghost" size="sm" type="button" data-testid="share-link-password-generate" (click)="generatePassword()">Generate</button>
              </div>
              <!-- Strength meter -->
              <div class="flex items-center gap-2 mt-2" aria-hidden="true">
                <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div class="h-full rounded-full transition-all" [style.width.%]="(strength().score / 4) * 100" [class]="strength().barClass"></div>
                </div>
                <span class="text-[0.68rem] tabular-nums" [class]="strength().textClass">{{ strength().label }}</span>
              </div>
              <p id="share-link-pw-hint" class="text-[0.7rem] mt-1" [class.text-red-300]="!!passwordError()" [class.text-text-secondary]="!passwordError()" [attr.role]="passwordError() ? 'alert' : null">
                {{ passwordError() || 'At least 6 characters. Tip: use Generate for a memorable passphrase.' }}
              </p>
            </div>
          }

          @if (createError()) {
            <p class="text-[0.8rem] text-red-300 mb-3" role="alert" data-testid="share-link-error">{{ createError() }}</p>
          }

          <button hlmBtn class="w-full justify-center" data-testid="share-link-create"
                  [disabled]="!canCreate()" [attr.aria-busy]="creating()" (click)="create()">
            {{ creating() ? 'Creating…' : 'Create & copy link' }}
          </button>

          <!-- Existing links (folded in from the removed page) -->
          @if (links().length > 0) {
            <div class="mt-5 pt-4 border-t border-white/[0.06]">
              <p class="text-[0.7rem] uppercase tracking-wide text-text-secondary mb-2">Existing links</p>
              <ul class="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                @for (l of links(); track l.id) {
                  <li class="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5" data-testid="share-link-existing-row">
                    <div class="min-w-0">
                      <code class="text-[0.76rem] text-light truncate block" [attr.title]="absolute(l.url)">{{ l.url }}</code>
                      <span class="text-[0.64rem] text-text-secondary tabular-nums">{{ l.status }} · expires {{ l.expiresAt | date: 'MMM d' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                      @if (l.passwordProtected) {
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-text-secondary" aria-label="Password protected"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      }
                      <button hlmBtn variant="ghost" size="sm" data-testid="share-link-existing-copy" (click)="copy(absolute(l.url), l.id)">{{ copiedLabel() === l.id ? 'Copied!' : 'Copy' }}</button>
                    </div>
                  </li>
                }
              </ul>
            </div>
          }
        }
      </div>
    </app-dialog-shell>
  `,
})
export class ShareLinkDialogComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly siteId = input.required<string>();
  readonly closed = output<void>();

  readonly expiryPresets = [
    { days: 1, label: '24 hours' },
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
  ];

  readonly expiryDays = signal(7);
  readonly passwordEnabled = signal(false);
  readonly password = signal('');
  readonly showPassword = signal(false);
  readonly creating = signal(false);
  readonly created = signal<CreatedLink | null>(null);
  readonly createError = signal<string | null>(null);
  readonly flagDisabled = signal(false);
  readonly links = signal<ShareLink[]>([]);
  /** Which item last showed "Copied!" — keyed by 'Link' | 'Both' | a link id. */
  readonly copiedLabel = signal<string | null>(null);

  /** Min length mirrors the worker's Zod `password: min(6)`. */
  readonly passwordError = computed(() => {
    if (!this.passwordEnabled()) return '';
    const p = this.password();
    if (p.length === 0) return '';
    return p.length < 6 ? 'Password must be at least 6 characters.' : '';
  });

  readonly canCreate = computed(() => {
    if (this.creating() || !this.siteId()) return false;
    if (!this.passwordEnabled()) return true;
    return this.password().length >= 6;
  });

  /** Cheap strength estimate (length + character classes) → 0–4 + brand-tinted bar. */
  readonly strength = computed(() => {
    const p = this.password();
    let s = 0;
    if (p.length >= 6) s++;
    if (p.length >= 12) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    const score = Math.min(s, 4);
    const map = [
      { label: '—', barClass: 'bg-white/20', textClass: 'text-text-secondary' },
      { label: 'Weak', barClass: 'bg-red-400', textClass: 'text-red-300' },
      { label: 'Fair', barClass: 'bg-amber-400', textClass: 'text-amber-300' },
      { label: 'Good', barClass: 'bg-lime-400', textClass: 'text-lime-300' },
      { label: 'Strong', barClass: 'bg-primary', textClass: 'text-primary' },
    ];
    return { score, ...(map[score] ?? map[0]) };
  });

  ngOnInit(): void {
    this.loadLinks();
  }

  /** Absolute reviewer URL (the API returns a relative `/review/:id`). */
  absolute(url: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://projectsites.dev';
    return url.startsWith('http') ? url : `${origin}${url}`;
  }

  togglePassword(ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    this.passwordEnabled.set(on);
    if (on && !this.password()) this.generatePassword();
    if (!on) this.password.set('');
  }

  /** Cryptographically-random pick from a list (avoids Math.random bias for security UX). */
  private pick<T>(list: T[]): T {
    const idx = crypto.getRandomValues(new Uint32Array(1))[0] % list.length;
    return list[idx]!;
  }

  /** Generate a memorable adjective-noun-NN! passphrase, reveal it, and clear errors. */
  generatePassword(): void {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10; // 10–99
    this.password.set(`${this.pick(PW_ADJECTIVES)}-${this.pick(PW_NOUNS)}-${n}!`);
    this.showPassword.set(true);
  }

  loadLinks(): void {
    const id = this.siteId();
    if (!id) return;
    this.api.get<{ ok: boolean; links: ShareLink[] }>(`/sites/${id}/review-links`, undefined, { silent: true }).subscribe({
      next: (res) => {
        if (res && Array.isArray(res.links)) this.links.set(res.links);
      },
      error: (err: { status?: number }) => {
        if (err?.status === 404) this.flagDisabled.set(true);
      },
    });
  }

  create(): void {
    const id = this.siteId();
    if (!id || !this.canCreate()) return;
    this.creating.set(true);
    this.createError.set(null);
    const pw = this.passwordEnabled() ? this.password() : undefined;
    const body: { ttlDays: number; password?: string } = { ttlDays: this.expiryDays() };
    if (pw) body.password = pw;
    this.api
      .post<{ ok: boolean; id: string; url: string; expiresAt: string; passwordProtected?: boolean }>(`/sites/${id}/review-links`, body, { silent: true })
      .subscribe({
        next: (res) => {
          const url = this.absolute(res.url);
          const result: CreatedLink = { url, passwordProtected: !!res.passwordProtected, password: pw ?? null };
          this.created.set(result);
          this.creating.set(false);
          // Auto-copy: link+password together when protected, otherwise just the link.
          if (result.passwordProtected && result.password) {
            void this.copyLinkAndPassword(result, true);
          } else {
            void this.copy(url, 'Link', true);
          }
          this.loadLinks();
        },
        error: (err: unknown) => {
          if ((err as { status?: number })?.status === 404) {
            this.flagDisabled.set(true);
          } else {
            const msg = (err as { error?: { error?: { message?: string } } })?.error?.error?.message ?? 'Could not create the link.';
            this.createError.set(msg);
          }
          this.creating.set(false);
        },
      });
  }

  async copy(text: string, key: string, silentToast = false): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copiedLabel.set(key);
      if (!silentToast) this.toast.success('Copied to clipboard.');
    } catch {
      this.toast.error(`Copy failed — copy manually: ${text}`);
    }
  }

  async copyLinkAndPassword(c: CreatedLink, silentToast = false): Promise<void> {
    const block = `Link: ${c.url}\nPassword: ${c.password ?? ''}`;
    try {
      await navigator.clipboard.writeText(block);
      this.copiedLabel.set('Both');
      if (!silentToast) this.toast.success('Link + password copied.');
    } catch {
      this.toast.error('Copy failed — copy manually.');
    }
  }

  /** Back to the create form to make another link in the same session. */
  reset(): void {
    this.created.set(null);
    this.createError.set(null);
    this.copiedLabel.set(null);
  }

  close(): void {
    this.closed.emit();
  }
}
