/**
 * @module pages/admin-v2/sections/code-viewer
 *
 * Lazy Monaco read-only viewer — the cockpit's code/log surface. Monaco is
 * dynamically imported via the bare `editor.api` entry (NOT the full package),
 * so it lands in its own lazy chunk AND registers no language workers — a
 * read-only plaintext viewer needs none, which keeps the console clean (no
 * "could not create web worker" warnings) and the bundle lean. Cockpit-dark
 * theme, `prefers-reduced-motion` (Monaco honors `cursorBlinking` etc.),
 * disposes on destroy, resizes via ResizeObserver. Reuses the installed
 * `monaco-editor` dep per [[package-preference-registry]] +
 * [[forms-editors-content-supervisor]].
 *
 * @example `<app-v2-code-viewer [value]="logsJson()" language="json" />`
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  input,
  viewChild,
  DestroyRef,
  inject,
} from '@angular/core';

@Component({
  selector: 'app-v2-code-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="h-80 w-full rounded-lg overflow-hidden border border-border" role="img" [attr.aria-label]="label()"></div>`,
})
export class V2CodeViewerComponent {
  readonly value = input<string>('');
  readonly language = input<string>('plaintext');
  readonly label = input<string>('Code viewer');

  private readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly destroyRef = inject(DestroyRef);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monaco editor instance, typed via dynamic import
  private editor: any = null;
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    afterNextRender(async () => {
      // No-op worker: Monaco's language workers only do validation/IntelliSense
      // (irrelevant for a read-only viewer). A stub worker avoids the
      // "could not create web worker" console warning AND any worker-asset 404,
      // while monarch tokenization (highlighting) still runs on the main thread.
      const g = self as unknown as { MonacoEnvironment?: unknown };
      g.MonacoEnvironment ??= {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getWorker: (): any => ({
          postMessage() {},
          addEventListener() {},
          removeEventListener() {},
          terminate() {},
          dispatchEvent: () => false,
          onmessage: null,
          onmessageerror: null,
          onerror: null,
        }),
      };
      const monaco = await import('monaco-editor');
      monaco.editor.defineTheme('ps-cockpit', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#03070a',
          'editor.foreground': '#e8fbff',
          'editorLineNumber.foreground': '#2a4750',
          'editorLineNumber.activeForeground': '#00e5ff',
          'editor.selectionBackground': '#0b3a44',
          'editorCursor.foreground': '#00e5ff',
          'editor.lineHighlightBackground': '#071014',
        },
      });
      const el = this.hostRef().nativeElement;
      this.editor = monaco.editor.create(el, {
        value: this.value(),
        language: this.language(),
        theme: 'ps-cockpit',
        readOnly: true,
        domReadOnly: true,
        automaticLayout: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        lineNumbers: 'on',
        renderLineHighlight: 'none',
        wordWrap: 'on',
        cursorBlinking: this.reduceMotion() ? 'solid' : 'blink',
        scrollbar: { vertical: 'auto', horizontal: 'auto' },
      });
      this.resizeObs = new ResizeObserver(() => this.editor?.layout());
      this.resizeObs.observe(el);
      this.destroyRef.onDestroy(() => {
        this.resizeObs?.disconnect();
        this.editor?.dispose();
        this.editor = null;
      });
    });
    // Push new content reactively once the editor exists.
    effect(() => {
      const v = this.value();
      if (this.editor && this.editor.getValue() !== v) this.editor.setValue(v);
    });
  }

  private reduceMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
