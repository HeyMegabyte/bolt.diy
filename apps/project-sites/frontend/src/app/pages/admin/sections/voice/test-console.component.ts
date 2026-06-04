/**
 * Voice → Test Console tab.
 *
 * @remarks
 * Two side-by-side panels — one places a browser-microphone call to the
 * site's primary voice number via Twilio Client SDK (`@twilio/voice-sdk`),
 * the other sends a test SMS through the AI agent. The voice panel reads
 * a live transcript stream over Server-Sent Events while the call is in
 * progress and renders a WebAudio AnalyserNode volume meter so the
 * operator can confirm their mic is hot.
 *
 * Endpoint contract (worker-owned, sibling agent):
 *   POST /api/voice/test/call-token  → { data: { token, identity, primary_number } }
 *   GET  /api/voice/test/live-transcript?callId=…  (SSE: event:turn  data: { ... })
 *   POST /api/voice/test/sms         → { data: { reply, conversation_id } }
 *
 * @example
 * ```html
 * <app-voice-test-console />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  type OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../admin-state.service';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { RevealOnScrollDirective } from '../../../../animations/reveal-on-scroll.directive';
import { HlmInputDirective, HlmSelectDirective } from '../../../../ui';

interface CallToken {
  token: string;
  identity: string;
  primary_number?: string;
}

interface SmsTurn {
  role: 'operator' | 'agent';
  text: string;
  at: number;
}

interface LiveTurn {
  speaker: 'caller' | 'agent';
  text: string;
  t_ms: number;
}

/* Minimal duck-typed views of @twilio/voice-sdk so the file doesn't break
 * typecheck when the package isn't installed yet. */
interface TwilioCallLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  disconnect(): void;
  mute(muted: boolean): void;
  isMuted(): boolean;
}
interface TwilioDeviceLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  connect(args: { params: Record<string, string> }): Promise<TwilioCallLike>;
  destroy(): void;
}
type TwilioDeviceCtor = new (token: string, options?: Record<string, unknown>) => TwilioDeviceLike;

@Component({
  selector: 'app-voice-test-console',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RevealOnScrollDirective, HlmInputDirective, HlmSelectDirective],
  template: `
    <section class="grid md:grid-cols-2 gap-5" psReveal>
      <!-- Call panel -->
      <article class="card" psReveal>
        <header class="mb-4">
          <div class="kicker">Voice test</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Call from this browser</h3>
          <p class="muted-help m-0 mt-1">
            Dials your primary voice number using your microphone — exactly what callers hear.
          </p>
        </header>

        @if (notConfigured()) {
          <div class="notice notice-amber" role="status">
            <strong>Twilio credentials missing.</strong>
            Set the API key + secret to enable browser dial-in.
            <div class="mt-2 flex flex-col gap-1 text-xs">
              <a class="underline" href="https://console.twilio.com/us1/account/manage-keys/create" target="_blank" rel="noopener">Open Twilio API keys console</a>
              <code class="muted-code">! npx wrangler secret put TWILIO_API_SECRET</code>
            </div>
          </div>
        } @else {
          @if (!inCall()) {
            <div class="flex flex-col items-center gap-3 py-4">
              <button class="btn-call"
                      type="button"
                      (click)="startCall()"
                      [disabled]="starting() || !primaryNumber()"
                      aria-label="Call the hotline">
                <span class="dot" aria-hidden="true"></span>
                {{ starting() ? 'Connecting…' : 'Call the hotline' }}
              </button>
              <p class="muted-help text-center">
                @if (primaryNumber()) {
                  Dialing {{ formatNum(primaryNumber()!) }}
                } @else {
                  Add a voice number on the Numbers tab first.
                }
              </p>
            </div>
          } @else {
            <div class="call-panel">
              <div class="flex items-center gap-3">
                <span class="live-dot" aria-hidden="true"></span>
                <div class="flex-1">
                  <div class="text-sm font-semibold text-white">Live call</div>
                  <div class="text-[0.7rem] text-text-secondary">{{ formatNum(primaryNumber() ?? '') }} · {{ elapsedFmt() }}</div>
                </div>
                <button class="btn-ghost text-xs" type="button" (click)="toggleMute()" [attr.aria-pressed]="muted()">
                  {{ muted() ? 'Unmute' : 'Mute' }}
                </button>
                <button class="btn-danger" type="button" (click)="hangup()" aria-label="Hang up">Hang up</button>
              </div>

              <!-- Volume meter -->
              <div class="meter" role="meter" aria-label="Microphone level" [attr.aria-valuenow]="volumePct()">
                <div class="meter-fill" [style.width.%]="volumePct()"></div>
              </div>

              <!-- Live transcript -->
              <div class="transcript" aria-live="polite">
                @if (liveTurns().length === 0) {
                  <p class="muted-help">Transcript begins as soon as anyone speaks.</p>
                } @else {
                  @for (t of liveTurns(); track $index) {
                    <div class="t-turn" [class.t-agent]="t.speaker === 'agent'">
                      <span class="t-speaker">{{ t.speaker === 'agent' ? 'AI' : 'You' }}</span>
                      <span class="t-text">{{ t.text }}</span>
                    </div>
                  }
                }
              </div>
            </div>
          }
        }
      </article>

      <!-- SMS panel -->
      <article class="card" psReveal>
        <header class="mb-4">
          <div class="kicker">SMS test</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Send a test SMS</h3>
          <p class="muted-help m-0 mt-1">Multi-turn — the AI replies inline.</p>
        </header>

        <label class="block mb-3">
          <span class="block-label">From number</span>
          <select hlmSelect class="w-full mt-1" [(ngModel)]="smsFromNumber" aria-label="SMS test number">
            @if (smsNumbers().length === 0) {
              <option value="">Add a number first</option>
            } @else {
              @for (n of smsNumbers(); track n) { <option [value]="n">{{ formatNum(n) }}</option> }
            }
          </select>
        </label>

        <div class="sms-thread" aria-live="polite">
          @for (m of smsThread(); track $index) {
            <div class="sms-bubble" [class.is-agent]="m.role === 'agent'">
              <span class="sms-role">{{ m.role === 'agent' ? 'AI' : 'You' }}</span>
              <p>{{ m.text }}</p>
            </div>
          }
          @if (smsThread().length === 0) {
            <p class="muted-help">No messages yet — type below to start a conversation.</p>
          }
        </div>

        <form class="sms-compose mt-3" (submit)="$event.preventDefault(); sendSms()">
          <textarea hlmInput [multiline]="true" class="w-full resize-y min-h-[40px]"
                    rows="3"
                    [(ngModel)]="smsBody"
                    name="sms-body"
                    placeholder="What would a caller text you?"
                    [disabled]="!smsFromNumber || smsSending()"
                    aria-label="Test SMS body"></textarea>
          <div class="flex items-center justify-between mt-2">
            <span class="muted-help">{{ smsBody.length }}/320 chars</span>
            <button class="btn-primary" type="submit" [disabled]="!smsBody.trim() || !smsFromNumber || smsSending()">
              {{ smsSending() ? 'Sending…' : 'Send' }}
            </button>
          </div>
        </form>
      </article>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .kicker { font: 700 0.62rem/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; letter-spacing: -0.02em; }
    .muted-help { font-size: 0.72rem; color: rgba(255,255,255,0.58); line-height: 1.5; }
    .muted-code { font: 500 0.7rem 'JetBrains Mono', ui-monospace, monospace; color: #a7f3d0; }
    .block-label { font: 600 0.62rem 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.55); }

    .card {
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-lg, 14px);
      padding: 1.2rem;
    }

    /* .input-field removed — the From-number select + SMS-body textarea now use
       hlmInput / hlmInput [multiline] (Spartan). */

    .btn-call {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 1rem 1.6rem;
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.16));
      border: 1px solid rgba(0,229,255,0.42);
      color: #fff;
      font: 700 0.95rem 'Sora', system-ui, sans-serif;
      letter-spacing: -0.01em;
      min-height: 56px; min-width: 240px;
      cursor: pointer;
      box-shadow: 0 12px 32px -16px rgba(0,229,255,0.6), inset 0 1px 0 rgba(255,255,255,0.08);
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    .btn-call:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 18px 48px -20px rgba(0,229,255,0.75); }
    .btn-call:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-call .dot { width: 10px; height: 10px; border-radius: 50%; background: #34d399; box-shadow: 0 0 12px rgba(52,211,153,0.7); }

    .call-panel { display: flex; flex-direction: column; gap: 0.9rem; }
    .live-dot { width: 10px; height: 10px; border-radius: 50%; background: #f87171; box-shadow: 0 0 14px rgba(248,113,113,0.7); animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    @media (prefers-reduced-motion: reduce) { .live-dot { animation: none; } .btn-call:hover { transform: none; } }

    .meter { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .meter-fill { height: 100%; background: linear-gradient(90deg, #34d399, #00E5FF, #fbbf24, #f87171); transition: width 80ms linear; }

    .transcript { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: var(--ps-radius-sm, 8px); background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.06); }
    .t-turn { padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); font-size: 0.82rem; }
    .t-turn.t-agent { background: rgba(0,229,255,0.06); }
    .t-speaker { font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ps-accent, #00E5FF); margin-right: 6px; }
    .t-text { color: rgba(255,255,255,0.92); }

    .sms-thread { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; padding: 8px; border-radius: var(--ps-radius-sm, 8px); background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.06); min-height: 120px; }
    .sms-bubble { padding: 8px 12px; border-radius: 12px 12px 12px 4px; background: rgba(255,255,255,0.04); align-self: flex-start; max-width: 80%; }
    .sms-bubble.is-agent { background: rgba(0,229,255,0.10); border: 1px solid rgba(0,229,255,0.28); align-self: flex-end; border-radius: 12px 12px 4px 12px; }
    .sms-role { font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace; color: var(--ps-accent, #00E5FF); text-transform: uppercase; letter-spacing: 0.08em; }
    .sms-bubble p { margin: 4px 0 0; font-size: 0.86rem; line-height: 1.4; color: rgba(255,255,255,0.94); white-space: pre-wrap; }

    .btn-primary, .btn-ghost, .btn-danger {
      padding: 0.5rem 0.95rem; border-radius: var(--ps-radius-sm, 8px);
      font-weight: 600; cursor: pointer; border: 1px solid transparent; min-height: 36px;
      transition: background 140ms ease, transform 140ms ease, border-color 140ms ease;
    }
    .btn-primary { background: rgba(0,229,255,0.16); color: var(--ps-accent, #00E5FF); border-color: rgba(0,229,255,0.4); font-size: 0.78rem; }
    .btn-primary:hover:not(:disabled) { background: rgba(0,229,255,0.24); transform: translateY(-1px); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-ghost { background: rgba(255,255,255,0.05); color: #fff; border-color: rgba(255,255,255,0.1); }
    .btn-ghost:hover { background: rgba(255,255,255,0.1); }
    .btn-danger { background: rgba(248,113,113,0.16); color: #fecaca; border-color: rgba(248,113,113,0.4); font-size: 0.74rem; }
    .btn-danger:hover { background: rgba(248,113,113,0.24); }
    button:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }

    .notice { border-radius: var(--ps-radius-sm, 8px); padding: 0.85rem 1rem; font-size: 0.78rem; }
    .notice-amber { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.32); color: #fde68a; }
    .notice-amber strong { color: #fcd34d; }
  `],
})
export class VoiceTestConsoleComponent implements OnDestroy {
  readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  // ── Call state ────────────────────────────────────────────────
  primaryNumber = signal<string | null>(null);
  notConfigured = signal(false);
  starting = signal(false);
  inCall = signal(false);
  muted = signal(false);
  liveTurns = signal<LiveTurn[]>([]);
  volumePct = signal(0);
  elapsedFmt = computed(() => {
    const s = this.elapsedS();
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  });
  private elapsedS = signal(0);

  private device?: TwilioDeviceLike;
  private call?: TwilioCallLike;
  private sse?: EventSource;
  private mediaStream?: MediaStream;
  private audioCtx?: AudioContext;
  private analyser?: AnalyserNode;
  private rafId?: number;
  private elapsedTimer?: ReturnType<typeof setInterval>;
  private currentCallId?: string;

  // ── SMS state ─────────────────────────────────────────────────
  smsNumbers = signal<string[]>([]);
  smsFromNumber = '';
  smsBody = '';
  smsSending = signal(false);
  smsThread = signal<SmsTurn[]>([]);
  private smsConvId?: string;

  private readonly siteEffect = effect(() => {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loadNumbers();
  });

  ngOnDestroy(): void {
    this.cleanupCall();
  }

  private loadNumbers(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.get<{ data: { phone_number: string; capabilities?: { voice?: boolean; sms?: boolean } }[] }>(`/voice/numbers?siteId=${site.id}`, undefined, { silent: true }).subscribe({
      next: (r) => {
        const nums = r.data ?? [];
        const voiceNum = nums.find((n) => n.capabilities?.voice !== false)?.phone_number ?? null;
        this.primaryNumber.set(voiceNum);
        const smsCapable = nums.filter((n) => n.capabilities?.sms !== false).map((n) => n.phone_number);
        this.smsNumbers.set(smsCapable);
        if (smsCapable.length && !this.smsFromNumber) this.smsFromNumber = smsCapable[0];
      },
      error: () => { /* leave as null */ },
    });
  }

  // ── Call lifecycle ─────────────────────────────────────────────

  async startCall(): Promise<void> {
    if (this.starting() || this.inCall()) return;
    this.starting.set(true);
    try {
      const tokenRes = await this.fetchToken();
      if (!tokenRes) return;
      this.primaryNumber.set(tokenRes.primary_number ?? this.primaryNumber());

      const mod = await this.loadTwilioSdk();
      if (!mod) {
        this.toast.error('Twilio Voice SDK failed to load. Install @twilio/voice-sdk.');
        return;
      }
      this.device = new mod.Device(tokenRes.token, { logLevel: 1, codecPreferences: ['opus' as unknown as never] });
      this.device.on('error', (err: unknown) => {
        const e = err as { message?: string };
        this.toast.error(`Device error: ${e?.message ?? 'unknown'}`);
      });

      const call = await this.device.connect({
        params: { siteId: this.state.selectedSite()?.id ?? '', testMode: 'true' },
      });
      this.call = call;
      this.attachCallHandlers(call);
      await this.startMicMeter();
      this.startElapsed();
      this.openTranscriptStream();
      this.inCall.set(true);
    } catch (err) {
      const e = err as { message?: string };
      this.toast.error(`Call failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      this.starting.set(false);
    }
  }

  private async fetchToken(): Promise<CallToken | null> {
    return new Promise((resolve) => {
      this.api.post<{ data: CallToken }>('/voice/test/call-token', {
        site_id: this.state.selectedSite()?.id,
      }).subscribe({
        next: (r) => { this.notConfigured.set(false); resolve(r.data); },
        error: (err) => {
          if (err?.status === 501) {
            this.notConfigured.set(true);
          } else {
            this.toast.error('Could not get a Twilio access token.');
          }
          resolve(null);
        },
      });
    });
  }

  /**
   * Lazy-import the Twilio Voice SDK so it never ships in the main bundle.
   * Indirect-import via a variable so TypeScript doesn't try to statically
   * resolve the dependency at typecheck time — keeps the build green even
   * when `@twilio/voice-sdk` hasn't been installed yet.
   */
  private async loadTwilioSdk(): Promise<{ Device: TwilioDeviceCtor } | null> {
    try {
      const pkg = '@twilio/voice-sdk';
      const m = (await import(/* @vite-ignore */ pkg)) as unknown as { Device: TwilioDeviceCtor };
      return m?.Device ? m : null;
    } catch {
      return null;
    }
  }

  private attachCallHandlers(call: TwilioCallLike): void {
    call.on('disconnect', () => this.cleanupCall());
    call.on('cancel', () => this.cleanupCall());
    call.on('error', (err: unknown) => {
      const e = err as { message?: string };
      this.toast.error(`Call error: ${e?.message ?? 'unknown'}`);
      this.cleanupCall();
    });
  }

  toggleMute(): void {
    if (!this.call) return;
    const next = !this.muted();
    this.call.mute(next);
    this.muted.set(next);
  }

  hangup(): void {
    this.call?.disconnect();
    this.cleanupCall();
  }

  private cleanupCall(): void {
    this.inCall.set(false);
    this.muted.set(false);
    this.volumePct.set(0);
    this.elapsedS.set(0);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    this.sse?.close(); this.sse = undefined;
    this.mediaStream?.getTracks().forEach((t) => t.stop()); this.mediaStream = undefined;
    void this.audioCtx?.close(); this.audioCtx = undefined; this.analyser = undefined;
    try { this.device?.destroy(); } catch { /* */ }
    this.device = undefined; this.call = undefined;
    this.currentCallId = undefined;
  }

  private startElapsed(): void {
    this.elapsedS.set(0);
    this.elapsedTimer = setInterval(() => this.elapsedS.update((v) => v + 1), 1000);
  }

  // ── Mic meter via WebAudio AnalyserNode ────────────────────────

  private async startMicMeter(): Promise<void> {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      const buf = new Uint8Array(this.analyser.frequencyBinCount);
      const loop = (): void => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        this.volumePct.set(Math.min(100, Math.round((avg / 200) * 100)));
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    } catch {
      /* mic blocked — meter stays at 0, call still works through Twilio's own pipeline */
    }
  }

  // ── Live transcript SSE ────────────────────────────────────────

  private openTranscriptStream(): void {
    this.liveTurns.set([]);
    if (typeof EventSource === 'undefined') return;
    // The worker assigns a callId once the call connects; for the SSE we pass siteId
    // and the worker correlates the live in-progress call.
    const site = this.state.selectedSite();
    if (!site) return;
    this.sse = new EventSource(`/api/voice/test/live-transcript?siteId=${site.id}`);
    this.sse.addEventListener('turn', (ev) => {
      try {
        const turn = JSON.parse((ev as MessageEvent).data) as LiveTurn;
        this.liveTurns.update((cur) => [...cur, turn].slice(-50));
      } catch { /* ignore malformed */ }
    });
    this.sse.addEventListener('end', () => this.sse?.close());
    this.sse.onerror = () => { /* stream may close at end-of-call; ignore */ };
  }

  // ── SMS ────────────────────────────────────────────────────────

  sendSms(): void {
    const body = this.smsBody.trim();
    if (!body || !this.smsFromNumber) return;
    const userTurn: SmsTurn = { role: 'operator', text: body, at: Date.now() };
    this.smsThread.update((t) => [...t, userTurn]);
    this.smsBody = '';
    this.smsSending.set(true);

    this.api.post<{ data: { reply: string; conversation_id: string } }>('/voice/test/sms', {
      site_id: this.state.selectedSite()?.id,
      from_number: this.smsFromNumber,
      conversation_id: this.smsConvId ?? null,
      body,
    }).subscribe({
      next: (r) => {
        this.smsConvId = r.data?.conversation_id;
        this.smsThread.update((t) => [...t, { role: 'agent', text: r.data?.reply ?? '(no reply)', at: Date.now() }]);
        this.smsSending.set(false);
      },
      error: () => {
        this.smsThread.update((t) => [...t, { role: 'agent', text: '(error — see Conversations tab)', at: Date.now() }]);
        this.smsSending.set(false);
      },
    });
  }

  formatNum(e164: string): string {
    const d = e164.replace(/[^\d]/g, '').replace(/^1/, '');
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
  }
}
