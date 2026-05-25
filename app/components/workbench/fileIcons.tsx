/**
 * Item 38 — File-type icons
 *
 * Inline SVG glyphs mapped per extension (top-20 file types). NOT pulled
 * from a full icon library to keep the bundle small. Color is brand-cyan
 * accent by default; per-type tints applied via the `fill` attribute.
 *
 * Returns a UnoCSS `i-ph:*` class string for the legacy `iconClasses` API
 * that the existing `NodeButton` accepts, so we don't have to restructure
 * the FileTree rendering path. Each ext maps to the most semantically
 * appropriate Phosphor icon already in the bundle.
 */

interface IconSpec {
  iconClass: string;
  /**
   * Optional Tailwind/UnoCSS color utility. When omitted the icon
   * inherits the surrounding row's text color (selected/active states).
   */
  tint?: string;
}

const SPEC_BY_EXT: Record<string, IconSpec> = {
  ts: { iconClass: 'i-ph:file-ts', tint: 'text-[#3178C6]' },
  tsx: { iconClass: 'i-ph:file-tsx', tint: 'text-[#3178C6]' },
  js: { iconClass: 'i-ph:file-js', tint: 'text-[#F7DF1E]' },
  jsx: { iconClass: 'i-ph:file-jsx', tint: 'text-[#F7DF1E]' },
  json: { iconClass: 'i-ph:brackets-curly', tint: 'text-[#F7DF1E]' },
  md: { iconClass: 'i-ph:file-md', tint: 'text-[#519aba]' },
  html: { iconClass: 'i-ph:file-html', tint: 'text-[#E34F26]' },
  css: { iconClass: 'i-ph:file-css', tint: 'text-[#264de4]' },
  scss: { iconClass: 'i-ph:file-css', tint: 'text-[#CC6699]' },
  py: { iconClass: 'i-ph:file-py', tint: 'text-[#3776AB]' },
  go: { iconClass: 'i-ph:terminal-window', tint: 'text-[#00ADD8]' },
  rs: { iconClass: 'i-ph:file-code', tint: 'text-[#dea584]' },
  java: { iconClass: 'i-ph:coffee', tint: 'text-[#b07219]' },
  png: { iconClass: 'i-ph:file-image', tint: 'text-[#a074c4]' },
  jpg: { iconClass: 'i-ph:file-image', tint: 'text-[#a074c4]' },
  jpeg: { iconClass: 'i-ph:file-image', tint: 'text-[#a074c4]' },
  svg: { iconClass: 'i-ph:file-svg', tint: 'text-[#FFB13B]' },
  yml: { iconClass: 'i-ph:file-text', tint: 'text-[#cb171e]' },
  yaml: { iconClass: 'i-ph:file-text', tint: 'text-[#cb171e]' },
  env: { iconClass: 'i-ph:lock-key', tint: 'text-[var(--ps-accent,#00E5FF)]' },
  lock: { iconClass: 'i-ph:lock-simple', tint: 'text-bolt-elements-textTertiary' },
  gitignore: { iconClass: 'i-ph:git-branch', tint: 'text-[#F05033]' },
};

const SPECIAL_NAMES: Record<string, IconSpec> = {
  '.gitignore': SPEC_BY_EXT.gitignore,
  'package.json': { iconClass: 'i-ph:package', tint: 'text-[#cb3837]' },
  'package-lock.json': SPEC_BY_EXT.lock,
  'pnpm-lock.yaml': SPEC_BY_EXT.lock,
  'yarn.lock': SPEC_BY_EXT.lock,
  'tsconfig.json': { iconClass: 'i-ph:gear', tint: 'text-[#3178C6]' },
  'readme.md': { iconClass: 'i-ph:book-open', tint: 'text-[#519aba]' },
  dockerfile: { iconClass: 'i-ph:cube', tint: 'text-[#0db7ed]' },
};

const DEFAULT_SPEC: IconSpec = { iconClass: 'i-ph:file-duotone' };

/**
 * Return the UnoCSS icon class + color tint utility for a file name.
 */
export function getFileIconSpec(fileName: string): IconSpec {
  const lower = fileName.toLowerCase();
  const bySpecial = SPECIAL_NAMES[lower];

  if (bySpecial) return bySpecial;

  const ext = lower.split('.').pop() ?? '';

  return SPEC_BY_EXT[ext] ?? DEFAULT_SPEC;
}
