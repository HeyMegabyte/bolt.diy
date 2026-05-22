/**
 * Backend helpers for the in-admin AI endpoint IDE.
 *
 * Responsibilities:
 *   • Validate a user-typed slug (`/api/ai/<site>/<slug>` URL safety).
 *   • Pick the entrypoint file out of a multi-file payload per language.
 *   • Hand off to `wfp_dispatch.uploadUserWorker` for JS / TS.
 *   • Stub Python and Rust-WASM runtimes until they're production-ready
 *     (the frontend lets users edit and "Deploy" even when the runtime
 *     itself isn't wired — the response carries `runtime_pending: true`).
 *   • Serialise / deserialise the `files_json`, `bindings_json`, `tags_json`
 *     columns added in migration 0020.
 *
 * @example
 * ```ts
 * const result = await deployEndpointFromFiles(env, {
 *   siteId, endpointSlug: 'invoice-webhook', language: 'javascript',
 *   files: { 'src/index.js': '...', 'package.json': '{}' },
 * });
 * if (!result.ok) throw new Error(result.error);
 * ```
 */
import type { Env } from '../types/env.js';
import { uploadUserWorker, isWfpConfigured } from './wfp_dispatch.js';

/** Languages supported in the IDE selector. */
export type IdeLanguage = 'ai-prompt' | 'javascript' | 'typescript' | 'python' | 'rust-wasm';

/** Auth modes supported by the public dispatcher in front of user code. */
export type EndpointAuthMode = 'open' | 'bearer' | 'turnstile' | 'hmac';

/** Map a language id to the file used as the worker entrypoint. */
export const LANGUAGE_ENTRYPOINTS: Readonly<Record<IdeLanguage, string>> = Object.freeze({
  'ai-prompt': 'prompt.md',
  javascript: 'src/index.js',
  typescript: 'src/index.ts',
  python: 'worker.py',
  'rust-wasm': 'src/lib.rs',
});

/** Starter templates dropped into the IDE when the user picks a language. */
export const LANGUAGE_STARTERS: Readonly<Record<IdeLanguage, Record<string, string>>> = Object.freeze({
  'ai-prompt': {
    'prompt.md':
      '# AI Prompt Endpoint\n\nYou are the endpoint. Read the request body, return JSON.\n',
  },
  javascript: {
    'src/index.js':
      '/** Entry point. Receives a standard Fetch Request. */\nexport default {\n  async fetch(request, env, ctx) {\n    const body = await request.json().catch(() => ({}));\n    return Response.json({ ok: true, echo: body });\n  },\n};\n',
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

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate a user-typed slug; returns the canonical lowercase form or null. */
export function normaliseSlug(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v.length < 2 || v.length > 64) return null;
  return SLUG_RE.test(v) ? v : null;
}

/** Parse a JSON column safely; return fallback on any failure. */
export function safeParseJson<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

/** Pick the entrypoint string out of a `files` object for a language. */
export function pickEntrypoint(language: IdeLanguage, files: Record<string, string>): string {
  const explicit = LANGUAGE_ENTRYPOINTS[language];
  if (files[explicit]) return files[explicit];
  // Fallback: first file whose extension matches the language.
  const exts: Record<IdeLanguage, RegExp> = {
    'ai-prompt': /\.md$/i,
    javascript: /\.(m?js|cjs)$/i,
    typescript: /\.(m?ts|tsx)$/i,
    python: /\.py$/i,
    'rust-wasm': /\.rs$/i,
  };
  for (const [p, body] of Object.entries(files)) {
    if (exts[language].test(p)) return body;
  }
  return '';
}

/** Deploy result envelope returned to the route handler. */
export type DeployResult =
  | { ok: true; scriptName: string | null; runtimePending: boolean; language: IdeLanguage }
  | { ok: false; error: string; status?: number };

/**
 * Deploy a multi-file payload. JS / TS go through Workers for Platforms;
 * Python + Rust-WASM are accepted and persisted but flagged `runtime_pending`
 * until their dispatch is wired up server-side.
 */
export async function deployEndpointFromFiles(
  env: Env,
  opts: {
    siteId: string;
    endpointSlug: string;
    language: IdeLanguage;
    files: Record<string, string>;
  },
): Promise<DeployResult> {
  if (opts.language === 'ai-prompt') {
    // No script upload required — the prompt is the artefact.
    return { ok: true, scriptName: null, runtimePending: false, language: opts.language };
  }
  if (opts.language === 'python' || opts.language === 'rust-wasm') {
    // Persist files but defer execution.
    return { ok: true, scriptName: null, runtimePending: true, language: opts.language };
  }
  // JS + TS: ship as a single ES module entrypoint via WFP.
  if (!isWfpConfigured(env)) {
    // Persist + tell the UI WFP isn't wired up so it shows the right banner.
    return { ok: true, scriptName: null, runtimePending: true, language: opts.language };
  }
  const code = pickEntrypoint(opts.language, opts.files);
  if (!code.trim()) return { ok: false, error: 'Entrypoint file is empty', status: 400 };
  const wfpLang = opts.language === 'typescript' ? 'javascript' : opts.language;
  const up = await uploadUserWorker(env, {
    siteId: opts.siteId,
    endpointSlug: opts.endpointSlug,
    language: wfpLang,
    code,
  });
  if (!up.ok) return { ok: false, error: up.error, status: 502 };
  return { ok: true, scriptName: up.scriptName, runtimePending: false, language: opts.language };
}
