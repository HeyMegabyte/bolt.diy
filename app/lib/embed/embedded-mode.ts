/**
 * Embedded mode detection and postMessage bridge for bolt.diy.
 *
 * When bolt.diy is loaded inside an iframe on projectsites.dev,
 * this module handles communication between the parent (Angular admin)
 * and the child (bolt.diy React app) via postMessage.
 *
 * @module embed/embedded-mode
 */

// ── Types ────────────────────────────────────────────────────

/** Parent → Child messages */
export interface SubmitPromptMessage {
  type: 'PS_SUBMIT_PROMPT';
  prompt: string;
  siteId: string;
  slug: string;
  correlationId: string;
}

export interface ImportFilesMessage {
  type: 'PS_IMPORT_FILES';
  files: Record<string, string>; // path → content (text only)
  siteId: string;
  slug: string;
  correlationId: string;
}

export interface RequestFilesMessage {
  type: 'PS_REQUEST_FILES';
  includeChat?: boolean;
  correlationId: string;
}

export interface LoadBuildContextMessage {
  type: 'PS_LOAD_BUILD_CONTEXT';
  contextUrl: string;
  siteId: string;
  slug: string;
  correlationId: string;
}

/** Child → Parent messages */
export interface BoltReadyMessage {
  type: 'PS_BOLT_READY';
}

export interface FilesReadyMessage {
  type: 'PS_FILES_READY';
  files: Record<string, string>;
  chat?: { messages: unknown[]; description?: string; exportDate: string };
  correlationId: string;
}

export interface GenerationStatusMessage {
  type: 'PS_GENERATION_STATUS';
  status: 'idle' | 'generating' | 'complete' | 'error';
  error?: string;
  correlationId: string;
}

/**
 * Editor runtime error — relayed to admin so it can write to `audit_logs`
 * with `action: 'editor.runtime_error'` (item 46). Sourced from
 * `window.onerror`, `window.onunhandledrejection`, and WebContainer error
 * events. Used by the admin's `BoltEmbedService` → `POST /api/audit-logs/editor-error`.
 */
export interface PSErrorMessage {
  type: 'PS_ERROR';
  code: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  requestId: string;
}

/**
 * Funnel-event relay — admin already has PostHog loaded with the right
 * project keys + tenant context. bolt.diy postMessages the event name +
 * props, admin's `TelemetryService.capture()` fires it (item 48).
 */
export interface PSTelemetryMessage {
  type: 'PS_TELEMETRY';
  event: string;
  props?: Record<string, unknown>;
}

/**
 * Toast bridge — surfaces "Editor recovered" + similar admin-facing
 * messages after auto-recovery (item 47). Also used bi-directionally by
 * item 44 so admin-side toasts mirror inside the editor and vice-versa.
 * `kind` is the canonical field; `level` is kept as an alias for the
 * original Phase-2 emitters.
 */
export interface PSToastMessage {
  type: 'PS_TOAST';
  kind?: 'info' | 'success' | 'warning' | 'error';
  level?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  correlationId?: string;
}

/**
 * Parent → Child (item 41): rebase the workbench to a snapshot. The child
 * resolves the snapshot's chat-export from the existing `by-slug/chat`
 * endpoint and runs the import-chat flow to load that revision's files.
 */
export interface OpenSnapshotMessage {
  type: 'PS_OPEN_SNAPSHOT';
  snapshot_id: string;
  slug?: string;
  correlationId: string;
}

/**
 * Parent → Child (item 42): jump to a specific file + optional 1-based line.
 * Used by the admin's "Open IDE" deep-links and Cmd+K palette file results.
 */
export interface OpenFileMessage {
  type: 'PS_OPEN_FILE';
  file: string;
  line?: number;
  correlationId: string;
}

/** Parent → Child (item 45): enumerate every text file in the workbench. */
export interface ListFilesMessage {
  type: 'PS_LIST_FILES';
  correlationId: string;
}

/**
 * Child → Parent (item 45): response to `PS_LIST_FILES`. Paths are
 * workbench-relative; size is the UTF-8 byte length of the text content.
 */
export interface FilesListMessage {
  type: 'PS_FILES_LIST';
  correlationId: string;
  files: { path: string; size: number }[];
}

/**
 * Child → Parent (item 43): replaces bolt.diy's standalone deploy flow.
 * Admin runs the actual deploy via its own site-deploy API so deploys land
 * in the same audit log as everything else.
 */
export interface DeployRequestMessage {
  type: 'PS_DEPLOY_REQUEST';
  files: Record<string, string>;
  chat?: { messages: unknown[]; description?: string; exportDate: string };
  correlationId: string;
}

export type ParentToChildMessage =
  | SubmitPromptMessage
  | ImportFilesMessage
  | RequestFilesMessage
  | LoadBuildContextMessage
  | OpenSnapshotMessage
  | OpenFileMessage
  | ListFilesMessage
  | PSToastMessage;
export type ChildToParentMessage =
  | BoltReadyMessage
  | FilesReadyMessage
  | GenerationStatusMessage
  | FilesListMessage
  | DeployRequestMessage
  | PSErrorMessage
  | PSTelemetryMessage
  | PSToastMessage;

// ── Allowed origins ──────────────────────────────────────────

const ALLOWED_ORIGINS = new Set(['https://projectsites.dev', 'http://localhost:4200', 'http://localhost:4300']);

// ── Detection (synchronous — must run before WebContainer boot) ──

function detectEmbedded(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const inIframe = window.parent !== window;
    const hasParam = new URLSearchParams(window.location.search).has('embedded');

    return inIframe && hasParam;
  } catch {
    // Cross-origin access to window.parent may throw
    return false;
  }
}

/** True when bolt.diy is loaded inside a projectsites.dev iframe */
export const isEmbedded: boolean = detectEmbedded();

// ── postMessage helpers ──────────────────────────────────────

/** Send a message to the parent frame (projectsites.dev admin). */
export function postToParent(message: ChildToParentMessage): void {
  if (!isEmbedded || typeof window === 'undefined') {
    return;
  }

  // Post to all allowed origins (parent origin is unknown at send time)
  window.parent.postMessage(message, '*');
}

/** Validate that a MessageEvent comes from an allowed origin. */
function isAllowedOrigin(event: MessageEvent): boolean {
  return ALLOWED_ORIGINS.has(event.origin);
}

/** Check if a message has the PS_ prefix (our protocol). */
function isPSMessage(data: unknown): data is ParentToChildMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as { type: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('PS_')
  );
}

// ── Message listener ─────────────────────────────────────────

type MessageHandler = (message: ParentToChildMessage) => void;

const handlers: MessageHandler[] = [];

/** Register a handler for incoming parent messages. Returns an unsubscribe function. */
export function onParentMessage(handler: MessageHandler): () => void {
  handlers.push(handler);

  return () => {
    const idx = handlers.indexOf(handler);

    if (idx >= 0) {
      handlers.splice(idx, 1);
    }
  };
}

function handleMessage(event: MessageEvent): void {
  // (Removed the per-message "[embed] Received postMessage" debug warn — it
  // fired on EVERY PS_ message in embedded mode, spamming the editor console.
  // The origin-reject + handler-error logs below remain — those are rare,
  // diagnostic, and security-relevant.)
  if (!isAllowedOrigin(event)) {
    if (isEmbedded && event.data?.type?.startsWith?.('PS_')) {
      console.warn('[embed] REJECTED — origin not allowed:', event.origin, 'Allowed:', [...ALLOWED_ORIGINS]);
    }

    return;
  }

  if (!isPSMessage(event.data)) {
    return;
  }

  for (const handler of handlers) {
    try {
      handler(event.data);
    } catch (err) {
      console.warn('[embed] Handler error:', err);
    }
  }
}

// ── Convenience emitters (items 46-48) ───────────────────────

/**
 * Relay an editor runtime error to the admin so it can be persisted to
 * `audit_logs` with `action: 'editor.runtime_error'`. Safe to call from
 * any handler — silently no-ops outside embedded mode.
 */
export function postErrorToParent(input: Omit<PSErrorMessage, 'type' | 'requestId'> & { requestId?: string }): void {
  postToParent({
    type: 'PS_ERROR',
    code: input.code,
    message: input.message,
    stack: input.stack,
    file: input.file,
    line: input.line,
    requestId: input.requestId ?? (typeof crypto !== 'undefined' ? crypto.randomUUID() : `${Date.now()}`),
  });
}

/** Capture a PostHog event via the admin's TelemetryService. */
export function postTelemetryToParent(event: string, props?: Record<string, unknown>): void {
  postToParent({ type: 'PS_TELEMETRY', event, props });
}

/** Toast bridge — admin renders via its ToastService. */
export function postToastToParent(level: NonNullable<PSToastMessage['kind']>, message: string): void {
  // Send both `kind` (canonical) and `level` (legacy alias) so either
  // side of the bridge can match without coordination.
  postToParent({ type: 'PS_TOAST', kind: level, level, message });
}

// ── Initialize ───────────────────────────────────────────────

if (isEmbedded && typeof window !== 'undefined') {
  window.addEventListener('message', handleMessage);

  // ── Item 46: hook window-level errors + unhandled rejections ──
  window.addEventListener('error', (event: ErrorEvent) => {
    postErrorToParent({
      code: 'window.onerror',
      message: event.message ?? 'Unknown window error',
      stack: event.error?.stack,
      file: event.filename,
      line: event.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    postErrorToParent({ code: 'window.unhandledrejection', message, stack });
  });

  /*
   * Notify parent that bolt.diy is ready
   * Delay slightly to allow React to mount
   */
  requestAnimationFrame(() => {
    postToParent({ type: 'PS_BOLT_READY' });
    // Item 48: editor.boot_started — first event in the PostHog funnel.
    postTelemetryToParent('editor.boot_started', { embedded: true });
  });
}
