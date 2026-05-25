import { Injectable, inject, signal, computed } from '@angular/core';
import { AuthService } from '../../../../services/auth.service';

/**
 * One parsed widget envelope emitted by the LLM inline with prose.
 */
export interface WidgetEnvelope {
  name: string;
  props: Record<string, unknown>;
}

/** Either a markdown prose chunk or a widget envelope. */
export type ResponsePart =
  | { kind: 'prose'; text: string }
  | { kind: 'widget'; widget: WidgetEnvelope };

export interface DashboardMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Raw user prompt or final streamed assistant text. */
  text: string;
  /** Parsed parts — present on assistant messages once streaming completes. */
  parts?: ResponsePart[];
  /** When false, this is the live-streaming message (token-by-token). */
  done: boolean;
  /** Resolved slash command id if user input was a slash. */
  slash?: string;
  createdAt: number;
}

export interface ChatContext {
  site_slug?: string;
  route?: string;
  time_of_day?: string;
  recent_widgets?: string[];
}

/**
 * Parser — splits raw LLM text into prose/widget parts using the
 * `<widget name="...">{json}</widget>` envelope format. Robust to half-streamed
 * widgets (returns parsed prefix + leaves rest in the buffer).
 */
const WIDGET_RX = /<widget\s+name=\"([a-z0-9-]+)\"\s*>([\s\S]*?)<\/widget>/gi;

export function parseWidgets(text: string): ResponsePart[] {
  const parts: ResponsePart[] = [];
  let lastIndex = 0;
  const rx = new RegExp(WIDGET_RX.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > lastIndex) {
      const prose = text.slice(lastIndex, m.index).trim();
      if (prose) parts.push({ kind: 'prose', text: prose });
    }
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(m[2]!.trim());
    } catch {
      // Malformed JSON — fall back to a markdown widget so we never lose content.
      parts.push({
        kind: 'widget',
        widget: { name: 'markdown', props: { body: `\`\`\`\n${m[2]}\n\`\`\`` } },
      });
      lastIndex = rx.lastIndex;
      continue;
    }
    parts.push({ kind: 'widget', widget: { name: m[1]!.toLowerCase(), props } });
    lastIndex = rx.lastIndex;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).trim();
    if (tail) parts.push({ kind: 'prose', text: tail });
  }
  return parts;
}

const STORAGE_KEY = 'ps_dashboard_state';
const STORAGE_VERSION = 1;

interface PersistedState {
  v: number;
  messages: DashboardMessage[];
  lastPill: string | null;
}

@Injectable({ providedIn: 'root' })
export class DashboardChatService {
  private auth = inject(AuthService);

  readonly messages = signal<DashboardMessage[]>([]);
  readonly lastPill = signal<string | null>(null);
  readonly streaming = signal(false);

  /** Recent widget names — fed back to the model as ChatContext.recent_widgets. */
  readonly recentWidgets = computed(() => {
    const names: string[] = [];
    for (const msg of this.messages().slice(-3)) {
      if (!msg.parts) continue;
      for (const p of msg.parts) if (p.kind === 'widget') names.push(p.widget.name);
    }
    return names.slice(-6);
  });

  constructor() {
    this.restore();
  }

  buildContext(): ChatContext {
    const hour = new Date().getHours();
    return {
      route:
        typeof window !== 'undefined' ? window.location.pathname : '/admin',
      time_of_day:
        hour < 5 ? 'late-night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening',
      recent_widgets: this.recentWidgets(),
    };
  }

  /**
   * Submit a user message + stream the assistant response. Returns when
   * the stream completes (or errors — error is rendered as a markdown widget).
   */
  async submit(input: string, slashId?: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed || this.streaming()) return;

    const userMsg: DashboardMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
      done: true,
      slash: slashId,
      createdAt: Date.now(),
    };
    const asst: DashboardMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      done: false,
      createdAt: Date.now(),
    };
    this.messages.update((m) => [...m, userMsg, asst]);
    this.streaming.set(true);
    this.persist();

    try {
      const body = {
        messages: this.messages()
          .filter((m) => m.done)
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.text })),
        slash_command: slashId,
        context: this.buildContext(),
      };
      const token = this.auth.getToken();
      const res = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        throw new Error(`chat failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const evt of events) {
          const dataLine = evt
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine.slice(6)) as { text?: string; message?: string };
            if (payload.text) {
              acc += payload.text;
              this.messages.update((m) =>
                m.map((x) => (x.id === asst.id ? { ...x, text: acc } : x)),
              );
            }
            if (payload.message && evt.startsWith('event: error')) {
              acc += `\n\n<widget name="markdown">{"body":"Stream error: ${payload.message}"}</widget>`;
            }
          } catch {
            /* ignore non-JSON */
          }
        }
      }
      const parts = parseWidgets(acc);
      this.messages.update((m) =>
        m.map((x) =>
          x.id === asst.id ? { ...x, done: true, parts, text: acc } : x,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'request failed';
      this.messages.update((m) =>
        m.map((x) =>
          x.id === asst.id
            ? {
                ...x,
                done: true,
                text: msg,
                parts: [
                  {
                    kind: 'widget',
                    widget: { name: 'markdown', props: { body: `Stream error: ${msg}` } },
                  },
                ],
              }
            : x,
        ),
      );
    } finally {
      this.streaming.set(false);
      this.persist();
    }
  }

  setPill(id: string | null): void {
    this.lastPill.set(id);
    this.persist();
  }

  clear(): void {
    this.messages.set([]);
    this.lastPill.set(null);
    this.persist();
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const state: PersistedState = {
        v: STORAGE_VERSION,
        messages: this.messages().slice(-20),
        lastPill: this.lastPill(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode — silent */
    }
  }

  private restore(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.v !== STORAGE_VERSION) return;
      this.messages.set(parsed.messages ?? []);
      this.lastPill.set(parsed.lastPill ?? null);
    } catch {
      /* corrupt blob — ignore */
    }
  }
}
