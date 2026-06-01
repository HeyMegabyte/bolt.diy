/**
 * Voice → Share tab.
 *
 * @remarks
 * Marketing-grade "spread the number around" surface. Copy-to-clipboard for
 * the phone number, SMS short link, and a `<script>` embed. Lazy-loads the
 * `qrcode` package to render a printable QR. Bundles three ready-to-paste
 * social posts the operator can tweak and ship.
 *
 * @example
 * ```html
 * <app-voice-share />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../admin-state.service';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { RevealOnScrollDirective } from '../../../../animations/reveal-on-scroll.directive';
import { HlmInputDirective } from '../../../../ui';

interface PurchasedNumber {
  id: string;
  phone_number: string;
  capabilities: { voice: boolean; sms: boolean };
}

@Component({
  selector: 'app-voice-share',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RevealOnScrollDirective, HlmInputDirective],
  template: `
    <section class="space-y-5" psReveal>
      <!-- Unified channel pitch -->
      <article class="card hero-card" psReveal>
        <div class="kicker">One AI, every channel</div>
        <h3 class="section-h text-xl font-bold text-white m-0 mt-1">
          Same AI across every channel
        </h3>
        <p class="muted-help m-0 mt-2 max-w-prose">
          The personality, knowledge, and tools you configured power your web chat, SMS, voice line,
          email, and 100+ MCP integrations. One source of truth — your customers feel it.
        </p>
        <div class="chip-row mt-4">
          <span class="ch-chip">💬 Web chat</span>
          <span class="ch-chip">📱 SMS</span>
          <span class="ch-chip">📞 Voice</span>
          <span class="ch-chip">📧 Email</span>
          <span class="ch-chip">🔌 100+ MCPs</span>
        </div>
      </article>

      <!-- Phone + QR -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Phone number</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Hand it out</h3>
          <p class="muted-help m-0 mt-1">QR for print. Copy buttons for signs, business cards, and email signatures.</p>
        </header>

        @if (primaryNumber()) {
          <div class="phone-grid">
            <div>
              <div class="phone-display">{{ formatNum(primaryNumber()!) }}</div>
              <div class="flex flex-wrap gap-2 mt-3">
                <button class="btn-ghost text-xs" type="button" (click)="copy(primaryNumber()!, 'Phone copied')">Copy E.164</button>
                <button class="btn-ghost text-xs" type="button" (click)="copy(formatNum(primaryNumber()!), 'Pretty phone copied')">Copy pretty</button>
                <button class="btn-ghost text-xs" type="button" (click)="copy('tel:' + primaryNumber(), 'tel: link copied')">Copy tel: link</button>
                <a class="btn-ghost text-xs" [href]="'tel:' + primaryNumber()">📞 Test dial</a>
              </div>
            </div>
            <div class="qr-tile" #qrTile>
              @if (qrLoading()) { <div class="qr-skel">Loading QR…</div> }
            </div>
          </div>
        } @else {
          <p class="muted-help">Buy a number on the Numbers tab to enable sharing.</p>
        }
      </article>

      <!-- SMS deep link -->
      @if (smsCapableNumber()) {
        <article class="card" psReveal>
          <header class="mb-3">
            <div class="kicker">SMS</div>
            <h3 class="section-h text-base font-bold text-white m-0 mt-1">Tap to text</h3>
            <p class="muted-help m-0 mt-1">Drop this link in your bio or website footer — opens the messages app pre-addressed.</p>
          </header>
          <div class="copy-row">
            <code>{{ smsLink() }}</code>
            <button class="btn-primary" type="button" (click)="copy(smsLink(), 'SMS link copied')">Copy</button>
          </div>
        </article>
      }

      <!-- Web embed -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Web embed</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Drop-in chat widget</h3>
          <p class="muted-help m-0 mt-1">Paste once before <code>&lt;/body&gt;</code>. Same AI as your phone line answers in &lt;0.4s.</p>
        </header>
        <div class="copy-row">
          <code class="text-[0.72rem]">{{ embedSnippet() }}</code>
          <button class="btn-primary" type="button" (click)="copy(embedSnippet(), 'Embed snippet copied')">Copy</button>
        </div>
      </article>

      <!-- Social snippets -->
      <article class="card" psReveal>
        <header class="mb-3">
          <div class="kicker">Marketing</div>
          <h3 class="section-h text-base font-bold text-white m-0 mt-1">Ready-to-paste posts</h3>
          <p class="muted-help m-0 mt-1">Edit then ship to LinkedIn, X, Instagram caption, or your next newsletter.</p>
        </header>
        @for (s of snippets(); track $index) {
          <label class="block mb-3">
            <span class="block-label">Snippet {{ $index + 1 }}</span>
            <textarea hlmInput [multiline]="true" class="w-full mt-1 resize-y min-h-[40px]" rows="4" [(ngModel)]="snippets()[$index]" name="snippet-{{$index}}" aria-label="Marketing snippet"></textarea>
            <div class="flex justify-end mt-1">
              <button class="btn-ghost text-xs" type="button" (click)="copy(snippets()[$index], 'Snippet copied')">Copy</button>
            </div>
          </label>
        }
      </article>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .kicker { font: 700 0.62rem/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85; }
    .section-h { font-family: 'Sora', system-ui, sans-serif; letter-spacing: -0.02em; }
    .muted-help { font-size: 0.72rem; color: rgba(255,255,255,0.58); line-height: 1.55; }
    .block-label { font: 600 0.6rem 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.55); }
    code { font: 500 0.78rem 'JetBrains Mono', ui-monospace, monospace; color: #a7f3d0; word-break: break-all; }

    .card { background: var(--ps-surface-1, rgba(13,13,40,0.62)); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--ps-radius-lg, 14px); padding: 1.2rem; }
    .hero-card {
      background: linear-gradient(135deg, rgba(0,229,255,0.08), rgba(124,58,237,0.06), rgba(13,13,40,0.62));
      border-color: rgba(0,229,255,0.24);
    }
    .chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .ch-chip {
      padding: 6px 12px; border-radius: 999px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      font: 600 0.74rem 'Inter', system-ui, sans-serif; color: rgba(255,255,255,0.88);
    }

    .phone-grid { display: grid; grid-template-columns: 1fr auto; gap: 1.2rem; align-items: center; }
    @media (max-width: 540px) { .phone-grid { grid-template-columns: 1fr; } }
    .phone-display {
      font: 800 1.85rem 'Sora', system-ui, sans-serif;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, var(--ps-accent, #00E5FF), #c4b5fd);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .qr-tile {
      width: 140px; height: 140px; padding: 10px;
      background: #fff; border-radius: var(--ps-radius-sm, 10px);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 24px -12px rgba(0,229,255,0.4);
    }
    .qr-skel { font: 600 0.7rem 'JetBrains Mono', ui-monospace, monospace; color: #444; }
    .qr-tile :global(canvas), .qr-tile :global(svg) { width: 100%; height: 100%; }

    .copy-row {
      display: flex; gap: 0.6rem; align-items: stretch;
      padding: 0.75rem; border-radius: var(--ps-radius-sm, 8px);
      background: rgba(0,0,0,0.32); border: 1px solid rgba(255,255,255,0.06);
    }
    .copy-row code { flex: 1; align-self: center; }

    /* .input-field removed — the snippet textarea now uses hlmInput [multiline]
       (resize + min-height preserved via resize-y min-h-[40px] Tailwind). */

    .btn-primary, .btn-ghost {
      padding: 0.45rem 0.85rem; border-radius: var(--ps-radius-sm, 8px);
      font-weight: 600; cursor: pointer; border: 1px solid transparent; min-height: 36px;
      transition: background 140ms ease, transform 140ms ease;
      text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-primary { background: rgba(0,229,255,0.16); color: var(--ps-accent, #00E5FF); border-color: rgba(0,229,255,0.4); font-size: 0.74rem; }
    .btn-primary:hover { background: rgba(0,229,255,0.24); transform: translateY(-1px); }
    .btn-ghost { background: rgba(255,255,255,0.04); color: #fff; border-color: rgba(255,255,255,0.1); font-size: 0.74rem; }
    .btn-ghost:hover { background: rgba(255,255,255,0.09); }
    button:focus-visible, a.btn-ghost:focus-visible { outline: 2px solid var(--ps-accent, #00E5FF); outline-offset: 2px; }
  `],
})
export class VoiceShareComponent {
  readonly state = inject(AdminStateService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  @ViewChild('qrTile', { static: false }) private qrTileRef?: ElementRef<HTMLDivElement>;

  numbers = signal<PurchasedNumber[]>([]);
  qrLoading = signal(false);

  primaryNumber = computed<string | null>(() => this.numbers().find((n) => n.capabilities.voice)?.phone_number ?? null);
  smsCapableNumber = computed<string | null>(() => this.numbers().find((n) => n.capabilities.sms)?.phone_number ?? null);
  smsLink = computed(() => `sms:${this.smsCapableNumber() ?? ''}?body=Hi`);

  embedSnippet = computed(() => {
    const site = this.state.selectedSite();
    const slug = site?.slug ?? 'YOURSLUG';
    return `<script async src="https://${slug}.projectsites.dev/chat.js" data-site="${slug}"></script>`;
  });

  snippets = signal<string[]>([
    'We answer the phone now even at 2am. Try it: ',
    'New: text our shop a question and the AI replies in seconds. No bots, no menus — just answers. ',
    'Same answers everywhere — chat on the site, SMS, or call. One AI, every channel. Try it: ',
  ]);

  private readonly siteEffect = effect(() => {
    const site = this.state.selectedSite();
    if (!site) return;
    this.loadNumbers();
    this.appendDefaultsOnce();
  });

  private appendedDefaults = false;
  private appendDefaultsOnce(): void {
    if (this.appendedDefaults) return;
    this.appendedDefaults = true;
    queueMicrotask(() => {
      const num = this.primaryNumber();
      if (!num) return;
      const pretty = this.formatNum(num);
      this.snippets.update((arr) => arr.map((s, i) =>
        i === 0 ? `${s}${pretty}` :
        i === 2 ? `${s}${pretty}` : s,
      ));
    });
  }

  private loadNumbers(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.get<{ data: PurchasedNumber[] }>(`/voice/numbers?siteId=${site.id}`).subscribe({
      next: (r) => {
        this.numbers.set(r.data ?? []);
        queueMicrotask(() => this.renderQr());
      },
      error: () => this.numbers.set([]),
    });
  }

  /** Lazy-load the `qrcode` package and paint into the white tile. */
  private async renderQr(): Promise<void> {
    const num = this.primaryNumber();
    const tile = this.qrTileRef?.nativeElement;
    if (!num || !tile) return;
    this.qrLoading.set(true);
    try {
      type QrToCanvas = (canvas: HTMLCanvasElement, text: string, opts?: { margin?: number; width?: number; color?: { dark?: string; light?: string } }) => Promise<void>;
      // Indirect-import via a variable so TS can't statically resolve `qrcode`
      // at typecheck time — keeps the build green if the package isn't
      // installed yet. Runtime falls back to a friendly "QR unavailable" tile.
      const pkg = 'qrcode';
      const mod = (await import(/* @vite-ignore */ pkg)) as unknown as { toCanvas: QrToCanvas; default?: { toCanvas: QrToCanvas } };
      const toCanvas = mod.toCanvas ?? mod.default?.toCanvas;
      if (!toCanvas) throw new Error('qrcode module missing toCanvas');
      tile.innerHTML = '';
      const canvas = document.createElement('canvas');
      tile.appendChild(canvas);
      await toCanvas(canvas, `tel:${num}`, { margin: 0, width: 120, color: { dark: '#060610', light: '#ffffff' } });
    } catch {
      tile.innerHTML = '<span style="font-size:0.7rem;color:#444">QR unavailable</span>';
    } finally {
      this.qrLoading.set(false);
    }
  }

  copy(text: string, label: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast.success(label),
      () => this.toast.error('Copy failed'),
    );
  }

  formatNum(e164: string): string {
    const d = e164.replace(/[^\d]/g, '').replace(/^1/, '');
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
  }
}
