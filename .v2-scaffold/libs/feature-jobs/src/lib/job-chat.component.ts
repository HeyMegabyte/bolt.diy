/**
 * JobChatComponent — WebSocket chat for the dispatched job.
 *
 * Multiplexed via `JobsService.chatStream$()` (shared socket with
 * location stream). RxJS-first; signals only at template boundary.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { BehaviorSubject, EMPTY, catchError, scan, switchMap, take } from 'rxjs';
import { AiService } from '@org/data-access';
import { JobsService } from './services/jobs.service';
import type { ChatMessage } from '@org/domain';

type SupportedLang = 'en' | 'es';

@Component({
  selector: 'lib-job-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, DatePipe],
  template: `
    <section class="chat" data-testid="job-chat">
      <header class="head">
        <h3>Chat</h3>
        <button
          pButton
          type="button"
          class="p-button-text p-button-sm"
          [attr.data-testid]="'chat-translate-toggle'"
          [attr.aria-pressed]="targetLang() !== null"
          (click)="toggleTranslate()"
        >
          {{ targetLang() ? '🌐 ES' : '🌐 Translate' }}
        </button>
      </header>
      <ul class="msgs">
        <li
          *ngFor="let m of (history$ | async) ?? []"
          [attr.data-testid]="'chat-msg-' + m.id"
        >
          <span class="who">{{ m.role }}</span>
          <span class="body">
            {{ m.content }}
            <button
              *ngIf="targetLang()"
              pButton
              type="button"
              class="p-button-text p-button-sm translate-btn"
              [attr.data-testid]="'chat-translate-' + m.id"
              [disabled]="translatingId() === m.id"
              (click)="translateOne(m)"
            >
              {{ translations()[m.id] ? translations()[m.id] : 'translate' }}
            </button>
          </span>
          <span class="time">{{ m.created_at | date: 'shortTime' }}</span>
        </li>
      </ul>
      <form class="composer" (ngSubmit)="send()">
        <input
          pInputText
          type="text"
          [(ngModel)]="draft"
          name="draft"
          placeholder="Type a message…"
          data-testid="chat-input"
        />
        <button
          pButton
          type="submit"
          icon="pi pi-send"
          [disabled]="!draft.trim() || sending()"
          data-testid="chat-send"
        ></button>
      </form>
    </section>
  `,
  styles: [
    `
      .chat { border: 1px solid var(--border, #2a2a3a); border-radius: 0.5rem; padding: 1rem; }
      .msgs { list-style: none; padding: 0; margin: 0.5rem 0; max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
      .msgs li { display: grid; grid-template-columns: 100px 1fr 60px; gap: 0.5rem; align-items: baseline; }
      .who { color: var(--text-color-secondary, #999); font-size: 0.875rem; text-transform: uppercase; }
      .body { font-size: 0.95rem; }
      .time { color: var(--text-color-secondary, #999); font-size: 0.75rem; text-align: right; }
      .composer { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
      .composer input { flex: 1; }
    `,
  ],
})
export class JobChatComponent {
  private readonly api = inject(JobsService);
  private readonly ai = inject(AiService);

  private readonly jobId$ = new BehaviorSubject<string>('');
  @Input({ required: true }) set jobId(v: string) {
    this.jobId$.next(v);
  }
  get jobId(): string {
    return this.jobId$.value;
  }

  protected draft = '';
  protected readonly sending = signal(false);

  /** Currently-active translation target, or `null` when toggle is off. */
  protected readonly targetLang = signal<SupportedLang | null>(null);
  /** Per-message translated content. Keyed by ChatMessage.id. */
  protected readonly translations = signal<Readonly<Record<string, string>>>({});
  /** ID of the message currently being translated (for spinner / disable). */
  protected readonly translatingId = signal<string | null>(null);

  /** Accumulated chat history derived from the live socket. */
  protected readonly history$ = this.jobId$.pipe(
    switchMap((id) =>
      this.api.chatStream$(id).pipe(
        scan<ChatMessage, readonly ChatMessage[]>((acc, m) => [...acc, m], []),
      ),
    ),
  );

  protected send(): void {
    const text = this.draft.trim();
    if (!text || !this.jobId) return;
    this.sending.set(true);
    this.api
      .sendChat$(this.jobId, text)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.draft = '';
          this.sending.set(false);
        },
        error: () => this.sending.set(false),
      });
  }

  /** Flip the translate toggle. Defaults to Spanish per i18n-by-demographics. */
  protected toggleTranslate(): void {
    this.targetLang.update((cur) => (cur === null ? 'es' : null));
    if (this.targetLang() === null) this.translations.set({});
  }

  /**
   * Lazy-translate a single message on tap. Caches the result on the client +
   * server. Tapping a translated row re-renders the cached translation
   * (no network round-trip).
   */
  protected translateOne(message: ChatMessage): void {
    const target = this.targetLang();
    if (!target) return;
    if (this.translations()[message.id]) return; // already translated
    this.translatingId.set(message.id);
    this.ai
      .translateChatMessage$(this.jobId, message.content, target)
      .pipe(
        take(1),
        catchError(() => {
          this.translatingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.translations.update((cur) => ({
          ...cur,
          [message.id]: result.translated_text,
        }));
        this.translatingId.set(null);
      });
  }
}
