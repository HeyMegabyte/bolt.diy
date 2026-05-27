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
import { BehaviorSubject, scan, switchMap, take } from 'rxjs';
import { JobsService } from './services/jobs.service';
import type { ChatMessage } from '@org/domain';

@Component({
  selector: 'lib-job-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, DatePipe],
  template: `
    <section class="chat" data-testid="job-chat">
      <header><h3>Chat</h3></header>
      <ul class="msgs">
        <li
          *ngFor="let m of (history$ | async) ?? []"
          [attr.data-testid]="'chat-msg-' + m.id"
        >
          <span class="who">{{ m.role }}</span>
          <span class="body">{{ m.content }}</span>
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

  private readonly jobId$ = new BehaviorSubject<string>('');
  @Input({ required: true }) set jobId(v: string) {
    this.jobId$.next(v);
  }
  get jobId(): string {
    return this.jobId$.value;
  }

  protected draft = '';
  protected readonly sending = signal(false);

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
}
