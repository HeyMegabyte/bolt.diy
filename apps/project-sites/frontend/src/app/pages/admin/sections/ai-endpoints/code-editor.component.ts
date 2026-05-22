/**
 * Code editor wrapping CodeMirror 6 (dynamic import) with a styled-textarea
 * fallback when CodeMirror cannot be loaded (e.g. lockfile didn't pull the
 * `@codemirror/*` packages in the current build).
 *
 * The component is intentionally framework-light: it accepts a `value`,
 * a `language`, and emits `valueChange` on every edit. The parent IDE owns
 * the multi-file map.
 *
 * @example
 * ```html
 * <app-ide-code-editor
 *   data-testid="ai-endpoint-editor"
 *   [value]="files()[activePath()] ?? ''"
 *   language="javascript"
 *   (valueChange)="updateFile(activePath(), $event)" />
 * ```
 */
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  signal,
  effect,
  type AfterViewInit,
  type OnDestroy,
} from '@angular/core';

@Component({
  selector: 'app-ide-code-editor',
  standalone: true,
  template: `
    <div class="editor-shell" [class.fallback]="usingFallback()">
      <div #host class="cm-host" [hidden]="usingFallback()"></div>
      <textarea
        #fallback
        class="fallback-textarea font-mono"
        [hidden]="!usingFallback()"
        [value]="value"
        (input)="onFallbackInput($event)"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        wrap="off"
        data-testid="ai-endpoint-editor-textarea"></textarea>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; min-height: 320px; }
    .editor-shell { height: 100%; background: #0c0c14; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); }
    .cm-host { height: 100%; min-height: 320px; }
    .fallback-textarea {
      width: 100%; height: 100%; min-height: 320px; padding: 0.8rem 1rem;
      background: #0c0c14; color: #e6edf3; border: none; outline: none; resize: none;
      font-size: 0.78rem; line-height: 1.55; tab-size: 2;
    }
  `],
})
export class IdeCodeEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host') hostRef?: ElementRef<HTMLDivElement>;
  @ViewChild('fallback') fallbackRef?: ElementRef<HTMLTextAreaElement>;

  @Input() value = '';
  @Input() language: 'ai-prompt' | 'javascript' | 'typescript' | 'python' | 'rust-wasm' = 'javascript';
  @Output() valueChange = new EventEmitter<string>();

  usingFallback = signal(true); // start in fallback; promote to CM if available
  private cm: { state: unknown; view: { dispatch: (tx: unknown) => void; destroy: () => void; state: { doc: { toString: () => string } } } } | null = null;
  private lastEmitted = '';

  constructor() {
    effect(() => {
      // Sync external value into CM if it's mounted and differs.
      if (this.cm && this.value !== this.lastEmitted) {
        this.replaceCmDoc(this.value);
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.tryMountCodeMirror();
  }

  ngOnDestroy(): void {
    this.cm?.view.destroy();
    this.cm = null;
  }

  /** Try to dynamically import CodeMirror; promote out of fallback on success. */
  private async tryMountCodeMirror(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      const [{ EditorState }, { EditorView, keymap, lineNumbers, highlightActiveLine }, { defaultKeymap, history, historyKeymap }, langMod, themeMod] = await Promise.all([
        import('@codemirror/state'),
        import('@codemirror/view'),
        import('@codemirror/commands'),
        this.loadLanguagePack(),
        import('@codemirror/theme-one-dark').catch(() => ({ oneDark: [] as unknown[] })),
      ]);
      if (!this.hostRef) return;
      const langExt = langMod.extension ?? [];
      const themeExt = (themeMod as { oneDark?: unknown }).oneDark ?? [];
      const state = EditorState.create({
        doc: this.value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((Array.isArray(langExt) ? langExt : [langExt]) as any),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...((Array.isArray(themeExt) ? themeExt : [themeExt]) as any),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const next = u.state.doc.toString();
              this.lastEmitted = next;
              this.valueChange.emit(next);
            }
          }),
        ],
      });
      const view = new EditorView({ state, parent: this.hostRef.nativeElement });
      this.cm = { state, view: view as unknown as { dispatch: (tx: unknown) => void; destroy: () => void; state: { doc: { toString: () => string } } } };
      this.usingFallback.set(false);
    } catch {
      // CodeMirror not in the lockfile — stay in fallback.
      this.usingFallback.set(true);
    }
  }

  /** Pick the right `@codemirror/lang-*` for the file's language. */
  private async loadLanguagePack(): Promise<{ extension: unknown }> {
    try {
      switch (this.language) {
        case 'javascript':
        case 'typescript':
          return (await import('@codemirror/lang-javascript')).javascript({ typescript: this.language === 'typescript' });
        case 'python':
          return (await import('@codemirror/lang-python')).python();
        case 'rust-wasm':
          return (await import('@codemirror/lang-rust')).rust();
        default:
          return { extension: [] };
      }
    } catch {
      return { extension: [] };
    }
  }

  private replaceCmDoc(next: string): void {
    if (!this.cm) return;
    const view = this.cm.view as unknown as {
      dispatch: (tx: { changes: { from: number; to: number; insert: string } }) => void;
      state: { doc: { length: number; toString: () => string } };
    };
    const cur = view.state.doc.toString();
    if (cur === next) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  }

  /** Handle textarea input in fallback mode. */
  onFallbackInput(ev: Event): void {
    const next = (ev.target as HTMLTextAreaElement).value;
    this.lastEmitted = next;
    this.valueChange.emit(next);
  }
}
