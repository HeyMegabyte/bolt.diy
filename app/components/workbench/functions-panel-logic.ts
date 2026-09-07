/**
 * @file Pure derivation logic for the Functions tab — kept separate from the React
 * component so it is unit-testable without importing the (webcontainer-heavy)
 * workbench store. Maps the project's real `functions/` file map → route table +
 * bindings (Cloudflare Pages Functions convention). No mocks, no side effects.
 */
import { WORK_DIR } from '~/utils/constants';
import type { FileMap } from '~/lib/stores/files';

export interface RouteEntry {
  path: string;
  methods: string[];
  handlerFile: string;
  usesResources: string[];
}

export interface BindingEntry {
  name: string;
  type: string;
  target: string;
}

export const FUNCTIONS_DIR = `${WORK_DIR}/functions`;
export const CODE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete'] as const;

/** Map a functions/ file path (relative, leading slash) to its served route. */
export function fileToRoute(relFromFunctions: string): string {
  const noExt = relFromFunctions.replace(CODE_EXT, '');
  const routed = noExt
    .replace(/\/index$/, '') // functions/api/index.ts → /api
    .replace(/\[\[[^\]]+\]\]/g, '*') // [[catchall]] → *
    .replace(/\[([^\]]+)\]/g, ':$1');

  // [id] → :id
  return routed === '' ? '/' : routed;
}

/** True if the project has any code file under functions/. */
export function hasFunctionsFolder(files: FileMap): boolean {
  return Object.keys(files).some((p) => p.startsWith(FUNCTIONS_DIR + '/') && CODE_EXT.test(p));
}

/** Derive the live route table from the project's functions/ folder. */
export function deriveRoutes(files: FileMap, resourceNames: Set<string>): RouteEntry[] {
  const routes: RouteEntry[] = [];

  for (const [path, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file') {
      continue;
    }

    if (!path.startsWith(FUNCTIONS_DIR + '/') || !CODE_EXT.test(path)) {
      continue;
    }

    const rel = path.slice(FUNCTIONS_DIR.length); // /api/contact.ts
    const base = rel.replace(/^\//, '');
    const isMiddleware = /(^|\/)_middleware\.[a-z]+$/.test(base);
    const content = dirent.content || '';
    const methods = METHODS.filter((m) => content.includes(`onRequest${m}`)).map((m) => m.toUpperCase());

    // A bare `onRequest` (not suffixed by a method) handles ALL verbs.
    if (/\bonRequest(?![A-Za-z])/.test(content)) {
      methods.unshift('ALL');
    }

    if (!methods.length) {
      methods.push(isMiddleware ? 'MW' : 'ALL');
    }

    const uses = [...resourceNames].filter((n) => n && new RegExp(`\\benv\\.${n}\\b`).test(content));
    routes.push({
      path: isMiddleware ? fileToRoute(rel).replace(/\/_middleware$/, '/*') : fileToRoute(rel),
      methods,
      handlerFile: `functions${rel}`,
      usesResources: uses,
    });
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Result of scaffolding a new Pages Function from a user-typed route name. */
export type ScaffoldResult = { path: string; route: string; content: string } | { error: string };

/**
 * Turn a user-typed route name (e.g. `"contact"`, `"api/booking"`) into a new Pages
 * Function file under `functions/` + a starter `onRequestGet` handler. Pure — the
 * caller writes it via `workbenchStore.createFile(path, content)`, after which
 * {@link deriveRoutes} surfaces it live. Bare names default under `api/` (the
 * convention every existing route follows: `contact` → `functions/api/contact.ts`
 * → `/api/contact`). Rejects empty, unsafe, or already-existing names.
 *
 * @param rawName - The user's typed route name.
 * @param existing - The current file map, to reject a collision.
 * @returns `{ path, route, content }` to create, or `{ error }` to show inline.
 */
export function scaffoldFunction(rawName: string, existing: FileMap = {}): ScaffoldResult {
  let name = (rawName || '').trim().toLowerCase();
  name = name.replace(/^\/+|\/+$/g, ''); // strip leading/trailing slashes FIRST
  name = name.replace(CODE_EXT, ''); // then a typed extension (now truly at the end)

  if (!name) {
    return { error: 'Enter a route name, e.g. "contact" or "api/webhook".' };
  }

  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(name) || name.includes('..') || name.includes('//')) {
    return { error: 'Letters, digits, "-", "_", "/" only (e.g. "api/contact").' };
  }

  // Bare name (no folder) → under api/, matching the existing route convention.
  const rel = name.includes('/') ? name : `api/${name}`;
  const path = `${FUNCTIONS_DIR}/${rel}.ts`;

  if (existing[path]) {
    return { error: `functions/${rel}.ts already exists.` };
  }

  const route = fileToRoute(`/${rel}.ts`);

  /*
   * NOTE: the comment must NOT contain an "onRequest…" token — deriveRoutes scans the
   * whole file text for onRequest{Method}, so a mention in prose would fabricate phantom
   * methods (and a bare "onRequest<" would flag it as an ALL-verb route).
   */
  const content = `/**
 * ${route} — Cloudflare Pages Function (scaffolded). Each exported handler
 * becomes a live route on deploy; duplicate it for other HTTP verbs.
 */
export async function onRequestGet() {
  return Response.json({ ok: true, route: ${JSON.stringify(route)} });
}
`;

  return { path, route, content };
}

/** Strip // and block comments so a wrangler.jsonc parses as JSON (URLs preserved). */
export function stripJsonComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Best-effort binding + script parse from wrangler.jsonc / wrangler.toml (never throws). */
export function deriveWrangler(files: FileMap): {
  bindings: BindingEntry[];
  script: string | null;
  compatDate: string | null;
} {
  const bindings: BindingEntry[] = [];
  let script: string | null = null;
  let compatDate: string | null = null;
  const jsonc =
    (files[`${WORK_DIR}/wrangler.jsonc`] as { content?: string } | undefined)?.content ??
    (files[`${WORK_DIR}/wrangler.json`] as { content?: string } | undefined)?.content;
  const toml = (files[`${WORK_DIR}/wrangler.toml`] as { content?: string } | undefined)?.content;

  if (jsonc) {
    try {
      const w = JSON.parse(stripJsonComments(jsonc)) as Record<string, unknown>;
      script = typeof w.name === 'string' ? w.name : null;
      compatDate = typeof w.compatibility_date === 'string' ? w.compatibility_date : null;

      for (const d of (w.d1_databases as { binding: string; database_name?: string }[]) ?? []) {
        bindings.push({ name: d.binding, type: 'd1', target: d.database_name ?? 'd1' });
      }

      for (const r of (w.r2_buckets as { binding: string; bucket_name?: string }[]) ?? []) {
        bindings.push({ name: r.binding, type: 'r2', target: r.bucket_name ?? 'r2' });
      }

      for (const k of (w.kv_namespaces as { binding: string }[]) ?? []) {
        bindings.push({ name: k.binding, type: 'kv', target: 'kv namespace' });
      }

      for (const s of (w.services as { binding: string; service?: string }[]) ?? []) {
        bindings.push({ name: s.binding, type: 'service', target: s.service ?? 'service' });
      }

      for (const key of Object.keys((w.vars as Record<string, unknown>) ?? {})) {
        bindings.push({ name: key, type: 'env', target: 'var' });
      }
    } catch {
      /* malformed wrangler — fall through to empty */
    }
  } else if (toml) {
    const nameM = toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    script = nameM ? nameM[1] : null;

    const cdM = toml.match(/^\s*compatibility_date\s*=\s*["']([^"']+)["']/m);
    compatDate = cdM ? cdM[1] : null;

    for (const m of toml.matchAll(
      /\[\[(d1_databases|r2_buckets|kv_namespaces|services)\]\][\s\S]*?binding\s*=\s*["']([^"']+)["']/g,
    )) {
      const kind =
        m[1] === 'd1_databases' ? 'd1' : m[1] === 'r2_buckets' ? 'r2' : m[1] === 'kv_namespaces' ? 'kv' : 'service';
      bindings.push({ name: m[2], type: kind, target: kind });
    }
  }

  return { bindings, script, compatDate };
}
