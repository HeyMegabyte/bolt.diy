/**
 * First-visit onboarding checklist — collapsible, dismissable, persists to
 * localStorage. Shows on the Editor (default) page when the user has < 4
 * completed steps. Each step links into the relevant admin tab.
 */
import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

interface Step { id: string; title: string; hint: string; route: string; done: boolean; }

const DONE_KEY = 'ps_onboard_done_v1';
const HIDDEN_KEY = 'ps_onboard_hidden_v1';

@Component({
  selector: 'app-onboarding-checklist',
  standalone: true,
  template: `
    @if (visible()) {
      <section class="card onboarding" aria-label="Setup checklist">
        <header class="flex items-center justify-between">
          <div>
            <div class="text-[0.65rem] uppercase tracking-wider text-text-secondary font-bold">Getting started</div>
            <h3 class="m-0 text-base font-semibold text-white mt-0.5">Setup checklist
              <span class="glow-chip ml-2">{{ doneCount() }} / {{ steps().length }}</span>
            </h3>
          </div>
          <div class="flex items-center gap-2">
            <svg class="progress-ring" width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4"/>
              <circle cx="22" cy="22" r="18" fill="none" stroke="url(#og)" stroke-width="4" stroke-linecap="round"
                      [attr.stroke-dasharray]="circumference"
                      [attr.stroke-dashoffset]="dashOffset()"
                      transform="rotate(-90 22 22)" />
              <defs>
                <linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#00E5FF"/>
                  <stop offset="100%" stop-color="#7C3AED"/>
                </linearGradient>
              </defs>
            </svg>
            <button class="text-text-secondary hover:text-white" (click)="hide()" title="Hide checklist" aria-label="Hide onboarding checklist">×</button>
          </div>
        </header>

        <ul class="step-list mt-3">
          @for (s of steps(); track s.id) {
            <li class="step-row" [class.done]="s.done">
              <button class="step-check" [class.done]="s.done" (click)="toggle(s)" [attr.aria-label]="s.done ? 'Mark not done' : 'Mark done'">
                @if (s.done) {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                }
              </button>
              <div class="flex-1 min-w-0">
                <div class="step-title">{{ s.title }}</div>
                <div class="step-hint">{{ s.hint }}</div>
              </div>
              <button class="step-go" (click)="go(s)">{{ s.done ? 'Review' : 'Open' }} →</button>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .onboarding { position: relative; }
    .progress-ring { transform: rotate(0deg); }
    .step-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .step-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 10px;
      transition: background 160ms ease, border-color 160ms ease, opacity 200ms ease;
    }
    .step-row:hover { background: rgba(0,229,255,0.05); border-color: rgba(0,229,255,0.2); }
    .step-row.done { opacity: 0.62; }
    .step-check {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 6px;
      border: 1.5px solid rgba(255,255,255,0.18);
      background: transparent;
      color: transparent;
      cursor: pointer; flex-shrink: 0;
      transition: all 150ms ease;
    }
    .step-check.done {
      background: linear-gradient(135deg, #00E5FF, #7C3AED);
      border-color: transparent;
      color: #fff;
      box-shadow: 0 0 0 3px rgba(0,229,255,0.12);
    }
    .step-title { font-size: 0.85rem; font-weight: 600; color: #fff; }
    .step-hint  { font-size: 0.72rem; color: rgba(255,255,255,0.55); margin-top: 1px; }
    .step-go {
      font-size: 0.72rem; font-weight: 600;
      color: #00E5FF; background: transparent; border: 0; cursor: pointer; padding: 6px 10px;
      border-radius: 6px;
    }
    .step-go:hover { background: rgba(0,229,255,0.1); }
  `],
})
export class OnboardingChecklistComponent implements OnInit {
  private router = inject(Router);
  private api = inject(ApiService);
  circumference = 2 * Math.PI * 18; // r=18

  steps = signal<Step[]>([
    { id: 'select-site',      title: 'Pick a site to work on',        hint: 'Top-left dropdown — choose one of your sites',                       route: '/admin',           done: false },
    { id: 'connect-mcp',      title: 'Connect at least one MCP',      hint: 'MailChimp, Slack, Resend — the AI router uses these to dispatch',     route: '/admin/settings#mcp', done: false },
    { id: 'tune-router',      title: 'Edit the form router prompt',   hint: 'Forms tab — single prompt routes every submission',                  route: '/admin/forms',      done: false },
    { id: 'set-spend',        title: 'Set a spend alert',             hint: 'Get emailed if your AI credit balance drops below a threshold',       route: '/admin/billing',    done: false },
    { id: 'install-appjs',    title: 'Drop app.js on your website',   hint: 'Press ⌘K → "Copy app.js install snippet"',                            route: '/admin/ai-endpoints', done: false },
    { id: 'invite-team',      title: 'Invite a teammate (optional)',  hint: 'Settings → Team — owner / editor / viewer roles',                    route: '/admin/settings#team', done: false },
  ]);

  hidden = signal(false);
  doneCount = computed(() => this.steps().filter((s) => s.done).length);
  visible = computed(() => !this.hidden() && this.doneCount() < this.steps().length);
  dashOffset = computed(() => {
    const pct = this.doneCount() / this.steps().length;
    return this.circumference * (1 - pct);
  });

  ngOnInit(): void {
    try {
      const done: string[] = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
      this.steps.update((list) => list.map((s) => ({ ...s, done: done.includes(s.id) })));
      this.hidden.set(localStorage.getItem(HIDDEN_KEY) === '1');
    } catch { /* ignore */ }
  }

  toggle(s: Step): void {
    this.steps.update((list) => list.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)));
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(this.steps().filter((x) => x.done).map((x) => x.id)));
    } catch { /* ignore */ }
  }
  go(s: Step): void {
    if (!s.done) this.toggle(s);
    this.router.navigateByUrl(s.route);
  }
  hide(): void {
    this.hidden.set(true);
    try { localStorage.setItem(HIDDEN_KEY, '1'); } catch { /* ignore */ }
  }
}
