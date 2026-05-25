/**
 * Browser-side {@link EditorToolContext} factory (Rec 5 — Phase 4a).
 *
 * Glue between the pure tool registry and the live bolt.diy surfaces:
 *   - workbenchStore (files + editor + scroll position)
 *   - WebContainer terminal (bolt shell process)
 *   - CodeMirror active view (registered by `CodeMirrorEditor` on mount)
 *
 * Importing this module is safe on the server because every surface access
 * is lazy and guarded — server-side render never touches `window`.
 */
import type { EditorView } from '@codemirror/view';

import { workbenchStore } from '~/lib/stores/workbench';
import type { EditorToolContext } from './editor-tools';

// ── Active CodeMirror view registry ─────────────────────────────────────
//
// CodeMirror calls `setActiveEditorView` on mount + destroy so the tool
// context can reach into the live selection / dispatch. Module-level
// singleton — there's only ever one CodeMirror editor in the workbench.

let activeView: EditorView | undefined;
let activeViewPath: string | undefined;

export function setActiveEditorView(view: EditorView | undefined, path: string | undefined): void {
  activeView = view;
  activeViewPath = path;
}

export function getActiveEditorView(): EditorView | undefined {
  return activeView;
}

// ── Context factory ─────────────────────────────────────────────────────

export function createEditorToolContext(): EditorToolContext {
  return {
    resolvePath(path) {
      if (!path) return undefined;
      const fileMap = workbenchStore.files.get();
      const direct = fileMap[path];
      if (direct?.type === 'file') return path;
      const cleaned = path.replace(/^\/+/, '');
      return Object.keys(fileMap).find((p) => p === path || p.endsWith(`/${cleaned}`));
    },

    async readFile(absolutePath) {
      const dirent = workbenchStore.files.get()[absolutePath];
      if (!dirent || dirent.type !== 'file' || dirent.isBinary) return undefined;
      return dirent.content;
    },

    openInEditor(absolutePath) {
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('code');
      workbenchStore.setSelectedFile(absolutePath);
    },

    scrollTo(_absolutePath, line, column) {
      const zeroBased = Math.max(0, line - 1);
      workbenchStore.setCurrentDocumentScrollPosition({ line: zeroBased, column: column ?? 0 });
    },

    async runShell(command) {
      const term = workbenchStore.boltTerminal;
      if (!term || typeof term.executeCommand !== 'function') {
        throw new Error('WebContainer terminal not ready');
      }
      const sessionId = `tool-${Date.now()}`;
      const result = await term.executeCommand(sessionId, command);
      return { output: result?.output ?? '', exitCode: result?.exitCode ?? 0 };
    },

    listFiles() {
      const fileMap = workbenchStore.files.get();
      const out: { path: string; size: number }[] = [];
      for (const [path, dirent] of Object.entries(fileMap)) {
        if (dirent?.type !== 'file' || dirent.isBinary) continue;
        const content = dirent.content ?? '';
        out.push({ path, size: new TextEncoder().encode(content).length });
      }
      return out;
    },

    getEditorSelection() {
      const view = activeView;
      const path = activeViewPath;
      if (!view || !path) return undefined;
      const range = view.state.selection.main;
      const text = view.state.sliceDoc(range.from, range.to);
      const fromLine = view.state.doc.lineAt(range.from);
      const toLine = view.state.doc.lineAt(range.to);
      return {
        path,
        text,
        from: { line: fromLine.number, column: range.from - fromLine.from + 1 },
        to: { line: toLine.number, column: range.to - toLine.from + 1 },
      };
    },

    replaceEditorSelection(text) {
      const view = activeView;
      if (!view) return false;
      const range = view.state.selection.main;
      view.dispatch({ changes: { from: range.from, to: range.to, insert: text } });
      return true;
    },
  };
}
