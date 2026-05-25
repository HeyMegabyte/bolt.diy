/**
 * Editor tool registry (Rec 5 — Phase 4a).
 *
 * Each tool is a pure descriptor: name + Zod parameter schema + handler.
 * Handlers receive a {@link EditorToolContext} so the dispatcher can wire a
 * real surface in the browser AND tests can swap in fakes without spinning
 * up the WebContainer or CodeMirror.
 *
 * Protocol envelope (matches `ai_admin.ts` SSE frames):
 *
 *   <tool_call name="openFile" id="t_42">{"args":{"path":"src/App.tsx"}}</tool_call>
 *   <tool_result id="t_42">{"path":"...","contents":"…","language":"tsx","line_count":120}</tool_result>
 *
 * The `id` is opaque to the tool layer — the model owns id generation so it
 * can correlate multiple in-flight tool_calls.
 *
 * Tools are intentionally string-returning. The chat client renders the
 * string verbatim into the `<tool_result>` envelope it streams back to the
 * worker — JSON-stringification happens here, not at the boundary, so the
 * model always sees stable shape per tool.
 */
import { z, type ZodTypeAny } from 'zod';

import { getLanguageFromExtension } from '~/utils/getLanguageFromExtension';

// ── Context (injected by the dispatcher) ─────────────────────────────────

/**
 * Surfaces a tool can touch. The dispatcher resolves these against the live
 * workbench / WebContainer / editor in the browser; tests pass fakes.
 *
 * Kept narrow on purpose — every method is the smallest verb a tool needs.
 */
export interface EditorToolContext {
  /** Resolve a workbench-relative path to absolute (`src/App.tsx` -> `/home/project/src/App.tsx`). */
  resolvePath(path: string): string | undefined;
  /** Read a text file's UTF-8 contents from the workbench. */
  readFile(absolutePath: string): Promise<string | undefined>;
  /** Open `absolutePath` in the editor + reveal the workbench panel. */
  openInEditor(absolutePath: string): void;
  /** Scroll CodeMirror to (1-based) line/column. */
  scrollTo(absolutePath: string, line: number, column?: number): void;
  /** Run `command` in the WebContainer's bolt terminal; resolve with raw output + exitCode. */
  runShell(command: string, cwd?: string): Promise<{ output: string; exitCode: number }>;
  /** Enumerate every text file in the workbench (path + size in bytes). */
  listFiles(): { path: string; size: number }[];
  /** Read CodeMirror's current selection. `undefined` when nothing is open. */
  getEditorSelection():
    | { path: string; text: string; from: { line: number; column: number }; to: { line: number; column: number } }
    | undefined;
  /** Replace the current selection in the active editor with `text`. */
  replaceEditorSelection(text: string): boolean;
}

// ── Tool descriptor ──────────────────────────────────────────────────────

export interface EditorTool<Schema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  parameters: Schema;
  handler: (args: z.infer<Schema>, ctx: EditorToolContext) => Promise<string>;
}

// ── Limits (truncation budgets — keep tool outputs LLM-friendly) ─────────

/** Max bytes returned per `runCommand`. Keeps a runaway `npm run dev` from blowing the prompt budget. */
export const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024;
/** Max matches returned per `search`. */
export const MAX_SEARCH_MATCHES = 50;
/** Max files scanned per `search` to bound CPU. */
const MAX_SEARCH_FILES = 2000;

function truncate(output: string, max = MAX_COMMAND_OUTPUT_BYTES): string {
  if (output.length <= max) return output;
  return `${output.slice(0, max)}\n…[truncated ${output.length - max} bytes]`;
}

// ── Tool schemas ─────────────────────────────────────────────────────────

const OpenFileArgs = z.object({
  path: z.string().min(1, 'path is required'),
});

const JumpToLineArgs = z.object({
  path: z.string().min(1, 'path is required'),
  line: z.number().int().positive('line must be a positive integer'),
  column: z.number().int().nonnegative().optional(),
});

const RunCommandArgs = z.object({
  command: z.string().min(1, 'command is required').max(4000, 'command must be ≤ 4000 chars'),
  cwd: z.string().optional(),
});

const SearchArgs = z.object({
  query: z.string().min(1, 'query is required').max(500, 'query must be ≤ 500 chars'),
  regex: z.boolean().optional(),
  file_pattern: z.string().optional(),
});

const GetSelectionArgs = z.object({});

const ReplaceSelectionArgs = z.object({
  text: z.string(),
});

// ── Helpers ──────────────────────────────────────────────────────────────

function globToRegExp(glob: string): RegExp {
  // Cheap globber covering the common cases: `*.tsx`, `src/**/*.ts`, `**/*.md`.
  // Anything fancier is out-of-scope for an LLM convenience filter.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '__STARSTAR__').replace(/\*/g, '[^/]*').replace(/__STARSTAR__/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// ── Tool implementations ─────────────────────────────────────────────────

export const openFileTool: EditorTool<typeof OpenFileArgs> = {
  name: 'openFile',
  description: 'Open a file in the bolt.diy editor and return its contents, detected language, and line count.',
  parameters: OpenFileArgs,
  async handler(args, ctx) {
    const absolute = ctx.resolvePath(args.path);
    if (!absolute) {
      throw new Error(`File not found in workbench: ${args.path}`);
    }
    const contents = await ctx.readFile(absolute);
    if (typeof contents !== 'string') {
      throw new Error(`File is binary or unreadable: ${args.path}`);
    }
    ctx.openInEditor(absolute);
    const language = getLanguageFromExtension(absolute) ?? 'plaintext';
    const lineCount = contents.length === 0 ? 0 : contents.split('\n').length;
    return JSON.stringify({ path: absolute, contents, language, line_count: lineCount });
  },
};

export const jumpToLineTool: EditorTool<typeof JumpToLineArgs> = {
  name: 'jumpToLine',
  description: 'Scroll the editor to a specific line (1-based) and optional column in the named file.',
  parameters: JumpToLineArgs,
  async handler(args, ctx) {
    const absolute = ctx.resolvePath(args.path);
    if (!absolute) throw new Error(`File not found in workbench: ${args.path}`);
    ctx.openInEditor(absolute);
    ctx.scrollTo(absolute, args.line, args.column);
    return JSON.stringify({ ok: true, path: absolute, line: args.line, column: args.column ?? 0 });
  },
};

export const runCommandTool: EditorTool<typeof RunCommandArgs> = {
  name: 'runCommand',
  description: 'Run a shell command in the WebContainer terminal. Returns stdout/stderr (truncated at 8KB) and the exit code.',
  parameters: RunCommandArgs,
  async handler(args, ctx) {
    const result = await ctx.runShell(args.command, args.cwd);
    return JSON.stringify({
      output: truncate(result.output ?? ''),
      exitCode: result.exitCode,
      cwd: args.cwd ?? null,
    });
  },
};

export const searchTool: EditorTool<typeof SearchArgs> = {
  name: 'search',
  description: 'Grep across the WebContainer files. Returns up to 50 {path, line, match} hits.',
  parameters: SearchArgs,
  async handler(args, ctx) {
    const matcher = args.regex
      ? new RegExp(args.query, 'm')
      : new RegExp(args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const filter = args.file_pattern ? globToRegExp(args.file_pattern) : null;

    const files = ctx.listFiles().slice(0, MAX_SEARCH_FILES);
    const hits: { path: string; line: number; match: string }[] = [];

    for (const { path } of files) {
      if (filter && !filter.test(path) && !filter.test(path.replace(/^.*\//, ''))) continue;
      const contents = await ctx.readFile(path);
      if (typeof contents !== 'string') continue;
      const lines = contents.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (matcher.test(lines[i])) {
          hits.push({ path, line: i + 1, match: lines[i].slice(0, 240) });
          if (hits.length >= MAX_SEARCH_MATCHES) break;
        }
      }
      if (hits.length >= MAX_SEARCH_MATCHES) break;
    }

    return JSON.stringify({ matches: hits, truncated: hits.length >= MAX_SEARCH_MATCHES });
  },
};

export const getSelectionTool: EditorTool<typeof GetSelectionArgs> = {
  name: 'getSelection',
  description: 'Return the editor selection: text, path, and 1-based from/to line/column.',
  parameters: GetSelectionArgs,
  async handler(_args, ctx) {
    const selection = ctx.getEditorSelection();
    if (!selection) {
      return JSON.stringify({ ok: false, reason: 'no_active_selection' });
    }
    return JSON.stringify({ ok: true, ...selection });
  },
};

export const replaceSelectionTool: EditorTool<typeof ReplaceSelectionArgs> = {
  name: 'replaceSelection',
  description: 'Replace the current editor selection with the supplied text. Use after getSelection to confirm scope.',
  parameters: ReplaceSelectionArgs,
  async handler(args, ctx) {
    const replaced = ctx.replaceEditorSelection(args.text);
    if (!replaced) throw new Error('No active selection to replace');
    return JSON.stringify({ ok: true, bytes_written: args.text.length });
  },
};

// ── Registry + provider-neutral definitions ──────────────────────────────

export const EDITOR_TOOLS = [
  openFileTool,
  jumpToLineTool,
  runCommandTool,
  searchTool,
  getSelectionTool,
  replaceSelectionTool,
] as const;

export type EditorToolName = (typeof EDITOR_TOOLS)[number]['name'];

const TOOL_INDEX: Record<string, EditorTool> = Object.fromEntries(
  EDITOR_TOOLS.map((t) => [t.name, t as unknown as EditorTool]),
);

export function getTool(name: string): EditorTool | undefined {
  return TOOL_INDEX[name];
}

/**
 * Convert a Zod object into a JSON-Schema fragment suitable for Anthropic
 * `tools[].input_schema` / OpenAI `tools[].function.parameters` / Workers AI
 * `tools[].parameters`. We do a hand-rolled shallow walk because the official
 * `zod-to-json-schema` package is overkill for the 6 tools shipped here.
 */
function toolToJsonSchema(tool: EditorTool): { type: 'object'; properties: Record<string, unknown>; required: string[] } {
  const shape = (tool.parameters as unknown as z.ZodObject<z.ZodRawShape>)._def?.shape?.();
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (shape) {
    for (const [key, schema] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(schema as ZodTypeAny);
      if (!(schema instanceof z.ZodOptional) && !(schema instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
  }

  return { type: 'object', properties, required };
}

function zodFieldToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return zodFieldToJsonSchema(schema._def.innerType);
  if (schema instanceof z.ZodDefault) return zodFieldToJsonSchema(schema._def.innerType);
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodFieldToJsonSchema(schema._def.type) };
  return { type: 'string' };
}

/**
 * Provider-neutral tool definitions. Each adapter (Anthropic, OpenAI,
 * Workers AI) re-shapes this into the wire format it needs; see
 * `ai_admin.ts` for the worker-side mapping.
 */
export const TOOL_DEFINITIONS = EDITOR_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: toolToJsonSchema(tool as unknown as EditorTool),
}));
