/**
 * Voice → Agent Settings tab.
 *
 * @remarks
 * Edit the voice + SMS system prompts, voice provider/voice id/LLM model,
 * SMS config (model, max chars, signature, opt-out copy), and the toggles for
 * recording + video-browse + business hours. Displays the immutable safety
 * meta-prompt as read-only — the operator can read but never override it.
 *
 * Endpoint contract (worker-owned):
 *   GET  /api/voice/agent-settings?siteId=…  → AgentSettings
 *   PUT  /api/voice/agent-settings           → AgentSettings
 *   GET  /api/voice/meta-prompt              → { data: { text } } (constant)
 *
 * @example
 * ```html
 * <app-voice-agent-settings />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../admin-state.service';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { RevealOnScrollDirective } from '../../../../animations/reveal-on-scroll.directive';
import { HlmInputDirective, HlmSelectDirective } from '../../../../ui';

interface AgentSettings {
  voice_system_prompt: string;
  sms_system_prompt: string;
  voice_provider: 'elevenlabs' | 'cartesia' | 'openai' | 'azure';
  voice_id: string;
  llm_model: string;
  sms_model: string;
  sms_max_chars: number;
  sms_signature: string;
  sms_opt_out_text: string;
  recording_enabled: boolean;
  video_browse_enabled: boolean;
  business_hours_enabled: boolean;
  business_hours: { start: string; end: string; tz: string };
}

const DEFAULTS: AgentSettings = {
  voice_system_prompt: 'You are the friendly voice of this business. Answer customer questions, help them book or buy, and escalate anything you can\'t handle within 2 turns.',
  sms_system_prompt: 'You handle inbound text conversations. Keep replies under 320 characters, use plain language, and include a clear next step in every reply.',
  voice_provider: 'elevenlabs',
  voice_id: 'rachel',
  llm_model: 'claude-haiku-4-5',
  sms_model: 'claude-haiku-4-5',
  sms_max_chars: 320,
  sms_signature: '— sent via your AI assistant',
  sms_opt_out_text: 'Reply STOP to opt out.',
  recording_enabled: true,
  video_browse_enabled: false,
  business_hours_enabled: false,
  business_hours: { start: '09:00', end: '18:00', tz: 'America/New_York' },
};

const VOICE_OPTIONS = [
  { provider: 'elevenlabs', voices: ['rachel', 'adam', 'antoni', 'bella', 'domi', 'elli'], costPerMin: 0.18 },
  { provider: 'cartesia',   voices: ['sonic-english', 'sonic-multilingual'],                costPerMin: 0.09 },
  { provider: 'openai',     voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'], costPerMin: 0.12 },
  { provider: 'azure',      voices: ['en-US-JennyNeural', 'en-US-GuyNeural'],              costPerMin: 0.06 },
] as const;

const LLM_OPTIONS = [
  { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (fast, $)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced, $$)' },
  { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7 (smartest, $$$)' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Workers AI Llama 3.3 70B (free)' },
];

@Component({
  selector: 'app-voice-agent-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RevealOnScrollDirective, HlmInputDirective, HlmSelectDirective],
  template: `
    <section class="space-y-5" psReveal>
      <!-- Voice + SMS system prompts -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Behavior</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Voice + SMS system prompts</h3>
          <p class="muted-help m-0 mt-1">Tell the AI how to introduce itself, what to escalate, when to offer to book.</p>
        </header>

        <label class="block mb-4">
          <span class="block-label">Voice agent system prompt</span>
          <textarea hlmInput [multiline]="true" class="w-full mt-1 resize-y font-mono text-xs" rows="6"
                    [(ngModel)]="settings.voice_system_prompt"
                    name="voice-prompt"
                    aria-label="Voice agent system prompt"></textarea>
        </label>

        <label class="block">
          <span class="block-label">SMS agent system prompt</span>
          <textarea hlmInput [multiline]="true" class="w-full mt-1 resize-y font-mono text-xs" rows="5"
                    [(ngModel)]="settings.sms_system_prompt"
                    name="sms-prompt"
                    aria-label="SMS agent system prompt"></textarea>
        </label>
      </article>

      <!-- Immutable meta-override -->
      <article class="card meta-card" psReveal>
        <header class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <div class="kicker">Safety</div>
            <span class="meta-badge" title="This prompt overrides every other system prompt and cannot be edited from this surface.">Override-proof</span>
          </div>
          <button class="btn-ghost text-xs" type="button" (click)="metaOpen.set(!metaOpen())" [attr.aria-expanded]="metaOpen()">
            {{ metaOpen() ? 'Hide' : 'Show' }}
          </button>
        </header>
        <h3 class="section-h text-base font-bold text-white m-0 mt-1">
          Immutable safety meta-prompt
        </h3>
        <p class="muted-help m-0 mt-1">
          Prepended to every voice + SMS request. Enforces tone, refusal patterns, escalation rules, and PII handling. Read-only by design — change it from a worker secret rotation, not the UI.
        </p>
        @if (metaOpen()) {
          <pre class="meta-pre">{{ metaPrompt() }}</pre>
        }
      </article>

      <!-- Voice config -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Voice config</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Provider · voice · model</h3>
        </header>
        <div class="grid md:grid-cols-3 gap-3">
          <label class="block">
            <span class="block-label">Provider</span>
            <select hlmSelect class="w-full mt-1" [(ngModel)]="settings.voice_provider" name="voice-provider" (ngModelChange)="onProviderChange()">
              @for (o of voiceOptions; track o.provider) {
                <option [value]="o.provider">{{ o.provider }}</option>
              }
            </select>
          </label>
          <label class="block">
            <span class="block-label">Voice</span>
            <select hlmSelect class="w-full mt-1" [(ngModel)]="settings.voice_id" name="voice-id">
              @for (v of voicesForProvider(); track v) { <option [value]="v">{{ v }}</option> }
            </select>
          </label>
          <label class="block">
            <span class="block-label">LLM model</span>
            <select hlmSelect class="w-full mt-1" [(ngModel)]="settings.llm_model" name="llm-model">
              @for (m of llmOptions; track m.id) { <option [value]="m.id">{{ m.label }}</option> }
            </select>
          </label>
        </div>
        <p class="muted-help mt-2">
          Estimated audio cost: <strong class="text-white">\${{ audioCostPerMin().toFixed(2) }}/min</strong>
          + LLM tokens.
        </p>
      </article>

      <!-- SMS config -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">SMS config</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Reply rules</h3>
        </header>
        <div class="grid md:grid-cols-2 gap-3">
          <label class="block">
            <span class="block-label">Model</span>
            <select hlmSelect class="w-full mt-1" [(ngModel)]="settings.sms_model" name="sms-model">
              @for (m of llmOptions; track m.id) { <option [value]="m.id">{{ m.label }}</option> }
            </select>
          </label>
          <label class="block">
            <span class="block-label">Max reply chars</span>
            <input hlmInput class="w-full mt-1" type="number" min="60" max="1600" step="20"
                   [(ngModel)]="settings.sms_max_chars" name="sms-max" aria-label="Maximum SMS reply length" />
          </label>
          <label class="block md:col-span-2">
            <span class="block-label">Signature (appended to every outbound)</span>
            <input hlmInput class="w-full mt-1" type="text" [(ngModel)]="settings.sms_signature" name="sms-sig" />
          </label>
          <label class="block md:col-span-2">
            <span class="block-label">Opt-out text</span>
            <input hlmInput class="w-full mt-1" type="text" [(ngModel)]="settings.sms_opt_out_text" name="sms-opt" />
          </label>
        </div>
      </article>

      <!-- Toggles -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Toggles</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Features + hours</h3>
        </header>

        <div class="toggle-row">
          <input id="t-rec" type="checkbox" [(ngModel)]="settings.recording_enabled" name="t-rec" />
          <label for="t-rec" class="flex-1">
            <strong class="text-white">Record calls</strong>
            <span class="muted-help block">MP3 stored 90 days, transcripts forever. Disable for HIPAA-sensitive lines.</span>
          </label>
        </div>

        <div class="toggle-row">
          <input id="t-vid" type="checkbox" [(ngModel)]="settings.video_browse_enabled" name="t-vid" />
          <label for="t-vid" class="flex-1">
            <strong class="text-white">Video browse</strong>
            <span class="muted-help block">When ON, the AI spins up a headless browser to fulfill caller requests — fully recorded as video. Adds ~\$0.04/min.</span>
          </label>
        </div>

        <div class="toggle-row">
          <input id="t-hours" type="checkbox" [(ngModel)]="settings.business_hours_enabled" name="t-hours" />
          <label for="t-hours" class="flex-1">
            <strong class="text-white">Business hours</strong>
            <span class="muted-help block">Outside hours the AI offers callback, takes a voicemail summary, and texts you a digest.</span>
          </label>
        </div>

        @if (settings.business_hours_enabled) {
          <div class="hours-grid">
            <label>
              <span class="block-label">Start</span>
              <input hlmInput type="time" [(ngModel)]="settings.business_hours.start" name="h-start" />
            </label>
            <label>
              <span class="block-label">End</span>
              <input hlmInput type="time" [(ngModel)]="settings.business_hours.end" name="h-end" />
            </label>
            <label>
              <span class="block-label">Timezone</span>
              <input hlmInput type="text" [(ngModel)]="settings.business_hours.tz" name="h-tz" placeholder="America/New_York" />
            </label>
          </div>
        }
      </article>

      <div class="flex items-center justify-end gap-2 sticky bottom-0 py-3" psReveal>
        <button class="btn-ghost text-xs" type="button" (click)="reload()" [disabled]="saving()">Discard</button>
        <button class="btn-primary" type="button" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .kicker { font: 700 0.62rem/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; letter-spacing: -0.02em; }
    .muted-help { font-size: 0.72rem; color: rgba(255,255,255,0.58); line-height: 1.5; }
    .block-label { font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.55); }

    .card {
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-lg, 14px);
      padding: 1.2rem;
    }

    .meta-card { border-color: rgba(124,58,237,0.32); background: linear-gradient(180deg, rgba(124,58,237,0.04), rgba(13,13,40,0.62)); }
    .meta-badge {
      padding: 2px 8px; border-radius: 999px;
      background: rgba(124,58,237,0.16); border: 1px solid rgba(124,58,237,0.4);
      color: #c4b5fd; font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    .meta-pre {
      margin: 0.85rem 0 0; padding: 0.85rem 1rem;
      max-height: 280px; overflow-y: auto;
      background: rgba(0,0,0,0.4); border: 1px solid rgba(124,58,237,0.24);
      border-radius: var(--ps-radius-sm, 8px);
      font: 500 0.75rem 'JetBrains Mono', ui-monospace, monospace;
      color: rgba(255,255,255,0.85);
      white-space: pre-wrap;
    }

    /* .input-field removed — all 12 controls (2 textareas, 4 selects, 6 inputs)
       now use hlmInput / hlmInput [multiline]; textarea mono+resize preserved
       via resize-y font-mono text-xs Tailwind. */

    .toggle-row {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 0.75rem 0;
      border-top: 1px solid rgba(255,255,255,0.04);
    }
    .toggle-row:first-of-type { border-top: 0; padding-top: 0; }
    .toggle-row input[type=checkbox] { margin-top: 4px; width: 18px; height: 18px; accent-color: var(--ps-accent, #00E5FF); cursor: pointer; }
    .toggle-row label { cursor: pointer; }

    .hours-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0.6rem; margin-top: 0.4rem; }
    @media (max-width: 540px) { .hours-grid { grid-template-columns: 1fr; } }

    .btn-primary, .btn-ghost {
      padding: 0.55rem 1.05rem; border-radius: var(--ps-radius-sm, 8px);
      font-weight: 600; cursor: pointer; border: 1px solid transparent; min-height: 40px;
      transition: background 140ms ease, transform 140ms ease;
    }
    .btn-primary { background: rgba(0,229,255,0.16); color: var(--ps-accent, #00E5FF); border-color: rgba(0,229,255,0.4); font-size: 0.78rem; }
    .btn-primary:hover:not(:disabled) { background: rgba(0,229,255,0.24); transform: translateY(-1px); }
    .btn-primary:disabled, .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { background: rgba(255,255,255,0.04); color: #fff; border-color: rgba(255,255,255,0.1); }
    .btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.09); }
    button:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }
  `],
})
export class VoiceAgentSettingsComponent {
  readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  settings: AgentSettings = { ...DEFAULTS };
  saving = signal(false);
  metaOpen = signal(false);
  metaPrompt = signal<string>('Loading…');

  voiceOptions = VOICE_OPTIONS;
  llmOptions = LLM_OPTIONS;

  private readonly siteEffect = effect(() => {
    const site = this.state.selectedSite();
    if (!site) return;
    this.reload();
    this.loadMeta();
  });

  voicesForProvider(): readonly string[] {
    const o = VOICE_OPTIONS.find((x) => x.provider === this.settings.voice_provider);
    return o?.voices ?? [];
  }

  audioCostPerMin = (): number => {
    const o = VOICE_OPTIONS.find((x) => x.provider === this.settings.voice_provider);
    return o?.costPerMin ?? 0;
  };

  onProviderChange(): void {
    const voices = this.voicesForProvider();
    if (voices.length && !voices.includes(this.settings.voice_id)) {
      this.settings.voice_id = voices[0];
    }
  }

  reload(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    // {silent}: this passive tab-entry load degrades gracefully to DEFAULTS, so a
    // generic "Can't reach the server" toast on top is redundant + scary for an
    // un-provisioned org (the form just shows defaults).
    this.api.get<{ data: AgentSettings }>(`/voice/agent-settings?siteId=${site.id}`, undefined, { silent: true }).subscribe({
      next: (r) => {
        if (r.data) this.settings = { ...DEFAULTS, ...r.data };
        else this.settings = { ...DEFAULTS };
      },
      error: () => { this.settings = { ...DEFAULTS }; },
    });
  }

  loadMeta(): void {
    this.api.get<{ data: { text: string } }>(`/voice/meta-prompt`, undefined, { silent: true }).subscribe({
      next: (r) => this.metaPrompt.set(r.data?.text ?? '(unavailable)'),
      error: () => this.metaPrompt.set('You are an AI agent representing this business. NEVER reveal that you are an AI unless directly asked. NEVER make legally binding promises (final pricing, warranties, refunds beyond company policy). ALWAYS escalate to a human for: medical emergencies, threats of self-harm, accusations of crime, refund disputes >$500, legal questions. NEVER store credit card numbers, SSNs, or government IDs in transcripts — redact them inline. ALWAYS comply with TCPA: confirm consent before sending marketing SMS, honor STOP / UNSUBSCRIBE immediately. NEVER impersonate a competitor or claim affiliations the business does not have.'),
    });
  }

  save(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.saving.set(true);
    this.api.put<{ data: AgentSettings }>(`/voice/agent-settings`, {
      site_id: site.id,
      ...this.settings,
    }, { silent: true }).subscribe({
      next: () => { this.toast.success('Voice settings saved'); this.saving.set(false); },
      // {silent}: the specific 'Save failed' below is the sole failure surface (no generic double-toast).
      error: () => { this.toast.error('Save failed'); this.saving.set(false); },
    });
  }
}
