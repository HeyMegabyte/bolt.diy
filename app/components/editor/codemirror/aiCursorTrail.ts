import { ViewPlugin, ViewUpdate, EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

/**
 * Item 34 — AI cursor trail
 *
 * CodeMirror 6 view plugin that emits short-lived cyan particle elements at
 * the insertion point whenever the editor receives a document-changing
 * transaction tagged as an AI edit. The CSS for the particles lives in the
 * brand-override layer at the bottom of `app/styles/index.scss`.
 *
 * Detection strategy:
 *   - Programmatic insert via `EditorView.dispatch({ changes, annotations })`
 *     can carry the user-event annotation `'ai'`. We check for it on each
 *     update so we don't fire on user typing.
 *   - For host integrations that don't supply that annotation, an
 *     explicit `aiCursorTrailEffect` is exposed so consumers can call
 *     `view.dispatch({ effects: aiCursorTrailEffect.of(true) })` to
 *     manually emit a burst.
 *
 * Performance:
 *   - Each particle is a single absolutely-positioned `<span>` removed
 *     via setTimeout(800ms). Capped at 24 simultaneous particles to keep
 *     paint cost negligible.
 *   - prefers-reduced-motion disables the trail entirely.
 */

export const aiCursorTrailEffect = StateEffect.define<boolean>();

const trailMarker = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    let next = deco;

    for (const effect of tr.effects) {
      if (effect.is(aiCursorTrailEffect) && effect.value) {
        next = Decoration.none;
      }
    }

    return next;
  },
});

const MAX_PARTICLES = 24;
const PARTICLE_LIFE_MS = 800;

const trailPlugin = ViewPlugin.fromClass(
  class {
    private host: HTMLDivElement | null = null;
    private particles = 0;
    private reduced = false;

    constructor(view: EditorView) {
      if (typeof window === 'undefined') return;

      this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

      this.host = document.createElement('div');
      this.host.className = 'ps-ai-trail-host';
      this.host.setAttribute('aria-hidden', 'true');

      const editorEl = view.dom;
      const parent = editorEl.parentElement ?? editorEl;
      parent.style.position = parent.style.position || 'relative';
      parent.appendChild(this.host);
    }

    update(update: ViewUpdate) {
      if (this.reduced || !this.host) return;

      const isAiEdit =
        update.docChanged &&
        update.transactions.some((t) => {
          const ev = t.annotation(EditorView.announce as any);
          const userEvent = (t as any).annotation?.((t as any).userEvent) ?? '';

          return (
            (t as any).isUserEvent?.('ai') ||
            userEvent === 'ai' ||
            t.effects.some((e) => e.is(aiCursorTrailEffect) && e.value === true) ||
            (typeof ev === 'string' && ev.startsWith('ai'))
          );
        });

      if (!isAiEdit) return;

      const head = update.state.selection.main.head;
      const coords = update.view.coordsAtPos(head);

      if (!coords) return;

      const hostRect = this.host.getBoundingClientRect();
      const x = coords.left - hostRect.left;
      const y = coords.top - hostRect.top;

      this.emitParticle(x, y);
    }

    private emitParticle(x: number, y: number) {
      if (!this.host || this.particles >= MAX_PARTICLES) return;

      const dot = document.createElement('span');
      dot.className = 'ps-ai-trail-dot';
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      this.host.appendChild(dot);
      this.particles += 1;

      window.setTimeout(() => {
        dot.remove();
        this.particles -= 1;
      }, PARTICLE_LIFE_MS);
    }

    destroy() {
      this.host?.remove();
      this.host = null;
    }
  },
);

export const aiCursorTrail = [trailMarker, trailPlugin];
