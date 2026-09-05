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
    .replace(/\[([^\]]+)\]/g, ':$1'); // [id] → :id
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
    if (!dirent || dirent.type !== 'file') continue;
    if (!path.startsWith(FUNCTIONS_DIR + '/') || !CODE_EXT.test(path)) continue;
    const rel = path.slice(FUNCTIONS_DIR.length); // /api/contact.ts
    const base = rel.replace(/^\//, '');
    const isMiddleware = /(^|\/)_middleware\.[a-z]+$/.test(base);
    const content = dirent.content || '';
    const methods = METHODS.filter((m) => content.includes(`onRequest${m}`)).map((m) => m.toUpperCase());
    // A bare `onRequest` (not suffixed by a method) handles ALL verbs.
    if (/\bonRequest(?![A-Za-z])/.test(content)) methods.unshift('ALL');
    if (!methods.length) methods.push(isMiddleware ? 'MW' : 'ALL');
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

/** Strip // and block comments so a wrangler.jsonc parses as JSON (URLs preserved). */
export function stripJsonComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Best-effort binding + script parse from wrangler.jsonc / wrangler.toml (never throws). */
export function deriveWrangler(files: FileMap): { bindings: BindingEntry[]; script: string | null; compatDate: string | null } {
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
      for (const d of (w.d1_databases as { binding: string; database_name?: string }[]) ?? [])
        bindings.push({ name: d.binding, type: 'd1', target: d.database_name ?? 'd1' });
      for (const r of (w.r2_buckets as { binding: string; bucket_name?: string }[]) ?? [])
        bindings.push({ name: r.binding, type: 'r2', target: r.bucket_name ?? 'r2' });
      for (const k of (w.kv_namespaces as { binding: string }[]) ?? [])
        bindings.push({ name: k.binding, type: 'kv', target: 'kv namespace' });
      for (const s of (w.services as { binding: string; service?: string }[]) ?? [])
        bindings.push({ name: s.binding, type: 'service', target: s.service ?? 'service' });
      for (const key of Object.keys((w.vars as Record<string, unknown>) ?? {}))
        bindings.push({ name: key, type: 'env', target: 'var' });
    } catch {
      /* malformed wrangler — fall through to empty */
    }
  } else if (toml) {
    const nameM = toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    script = nameM ? nameM[1] : null;
    const cdM = toml.match(/^\s*compatibility_date\s*=\s*["']([^"']+)["']/m);
    compatDate = cdM ? cdM[1] : null;
    for (const m of toml.matchAll(/\[\[(d1_databases|r2_buckets|kv_namespaces|services)\]\][\s\S]*?binding\s*=\s*["']([^"']+)["']/g)) {
      const kind = m[1] === 'd1_databases' ? 'd1' : m[1] === 'r2_buckets' ? 'r2' : m[1] === 'kv_namespaces' ? 'kv' : 'service';
      bindings.push({ name: m[2], type: kind, target: kind });
    }
  }
  return { bindings, script, compatDate };
}
