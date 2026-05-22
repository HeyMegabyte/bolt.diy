/**
 * Shared types for the AI Endpoints IDE.
 *
 * The wire shape mirrors `src/routes/ai_admin.ts`. Anything edited inline (slug,
 * method, language) lives on the {@link EndpointRow}; the full IDE state
 * (multi-file files map, bindings, tags) lives on the {@link EndpointDetail}
 * returned by the per-row GET.
 */

export type IdeLanguage = 'ai-prompt' | 'javascript' | 'typescript' | 'python' | 'rust-wasm';
export type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'BOTH';
export type EndpointAuthMode = 'open' | 'bearer' | 'turnstile' | 'hmac';
export type DeployStatus = 'idle' | 'deploying' | 'live' | 'error';

/** Single row in the list view. */
export interface EndpointRow {
  id: string;
  endpoint_slug: string;
  display_name: string | null;
  description: string | null;
  kind: 'prompt' | 'worker';
  method: EndpointMethod;
  language: IdeLanguage;
  worker_language: string | null;
  wfp_script_name: string | null;
  enabled: number;
  auth_mode: EndpointAuthMode;
  rate_limit_per_sec: number;
  cache_ttl_seconds: number;
  cron_expression: string | null;
  tags: EndpointTag[];
  deploy_status: DeployStatus;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Full edit-time payload — includes `files` map and bindings. */
export interface EndpointDetail extends EndpointRow {
  prompt_template: string | null;
  worker_code: string | null;
  files: Record<string, string>;
  bindings: EndpointBinding[];
}

/** User-defined tag rendered as a colour chip. */
export interface EndpointTag {
  label: string;
  color: string;
}

/** Worker-style binding declaration captured by the IDE bindings panel. */
export interface EndpointBinding {
  type: 'kv' | 'r2' | 'd1' | 'ai' | 'queue' | 'var' | 'secret';
  name: string;
  id?: string;
  value?: string;
}

/** Returned by the list endpoint. */
export interface EndpointListResponse {
  data: EndpointRow[];
  wfp_configured: boolean;
  supported_languages: { id: string; label: string; helper: string }[];
}

/** Returned by deploy. */
export interface DeployResponse {
  data: {
    ok: boolean;
    runtime_pending: boolean;
    deploy_status: DeployStatus;
    deploy_error: string | null;
    deployed_at: string | null;
  };
}

/** Open tab in the IDE. */
export interface OpenTab {
  path: string;
  dirty: boolean;
}

/** Language picker entry rendered in the IDE chrome. */
export interface LanguageOption {
  id: IdeLanguage;
  label: string;
  hint: string;
  ext: string;
}

/** Available languages, exported once for both the list and IDE. */
export const LANGUAGE_OPTIONS: ReadonlyArray<LanguageOption> = Object.freeze([
  { id: 'ai-prompt', label: 'AI Prompt (no code)', hint: 'Markdown prompt; AI handles each request', ext: 'md' },
  { id: 'javascript', label: 'JavaScript', hint: 'CF Workers ES module', ext: 'js' },
  { id: 'typescript', label: 'TypeScript', hint: 'CF Workers ES module', ext: 'ts' },
  { id: 'python', label: 'Python', hint: 'Pyodide runtime (stub)', ext: 'py' },
  { id: 'rust-wasm', label: 'Rust → WASM', hint: 'wasm-pack server build (stub)', ext: 'rs' },
]);

/** Starter files dropped in when the IDE opens for a new language. */
export const LANGUAGE_STARTERS: Readonly<Record<IdeLanguage, Record<string, string>>> = Object.freeze({
  'ai-prompt': {
    'prompt.md':
      '# AI Prompt Endpoint\n\nYou are the endpoint. Read the request body, return JSON.\n',
  },
  javascript: {
    'src/index.js':
      "/** Entry point — receives a Fetch Request, returns a Response. */\nexport default {\n  async fetch(request, env, ctx) {\n    const body = await request.json().catch(() => ({}));\n    return Response.json({ ok: true, echo: body });\n  },\n};\n",
    'package.json': '{\n  "name": "ai-endpoint",\n  "private": true,\n  "type": "module"\n}\n',
  },
  typescript: {
    'src/index.ts':
      'export default {\n  async fetch(request: Request, _env: unknown, _ctx: ExecutionContext): Promise<Response> {\n    const body = await request.json().catch(() => ({}));\n    return Response.json({ ok: true, echo: body });\n  },\n} satisfies ExportedHandler;\n',
    'package.json': '{\n  "name": "ai-endpoint",\n  "private": true,\n  "type": "module"\n}\n',
  },
  python: {
    'worker.py':
      'from workers import Response\n\nasync def on_fetch(request, env):\n    body = await request.json()\n    return Response.json({"ok": True, "echo": body})\n',
  },
  'rust-wasm': {
    'src/lib.rs':
      'use worker::*;\n\n#[event(fetch)]\nasync fn fetch(req: Request, _env: Env, _ctx: Context) -> Result<Response> {\n    Response::ok("hi from rust")\n}\n',
    'Cargo.toml':
      '[package]\nname = "ai-endpoint"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nworker = "0.3"\n',
  },
});

/** Map a file extension to a syntax mode key — used by the editor. */
export function extensionFor(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/** Client-side slug validator: lowercase + dashes + 2-64 chars. */
export function validateSlug(raw: string): { ok: boolean; reason?: string; slug?: string } {
  const v = raw.trim().toLowerCase();
  if (v.length < 2 || v.length > 64) return { ok: false, reason: 'Slug must be 2-64 characters' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) return { ok: false, reason: 'Use lowercase letters, numbers, and dashes only' };
  return { ok: true, slug: v };
}
