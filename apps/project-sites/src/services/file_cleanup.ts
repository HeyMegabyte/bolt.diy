/**
 * Pure file-cleanup utilities: match files against cleanup rules and determine
 * which to keep vs delete. No I/O, no env access — pure determinism per
 * {@link matchCleanup}.
 *
 * @remarks
 * Patterns follow a simple glob-like syntax: `*` matches any non-slash
 * characters, `?` matches a single non-slash character. Literal dots and
 * slashes match themselves. No bracket expressions or brace expansion.
 *
 * @example
 * ```ts
 * const { keep, delete: toDelete } = matchCleanup(
 *   [
 *     { name: 'build.tmp', mtimeMs: Date.now() - 86400_000 * 2 },
 *     { name: 'src/index.ts', mtimeMs: Date.now() },
 *   ],
 *   [{ pattern: '*.tmp', maxAgeDays: 1 }],
 * );
 * // keep → [src/index.ts], delete → [build.tmp]
 * ```
 */

/**
 * Convert a simple glob pattern to a RegExp for matching file names.
 *
 * - `*` matches zero or more non-slash characters.
 * - `?` matches exactly one non-slash character.
 * - All other characters are literal (dots, slashes, hyphens, etc.).
 *
 * **Basename convention:** when the pattern contains no `/`, it matches the
 * last path segment (basename) of a file at any directory depth. When the
 * pattern contains a `/`, it matches the full path. This makes `*.tmp` match
 * both `build.tmp` and `exports/notes.tmp`, while `exports/*` only matches
 * direct children of the `exports/` directory.
 *
 * @param pattern - Glob pattern such as `*.tmp` or `exports/*`.
 * @returns A RegExp that matches the target string against the pattern.
 * @example
 * ```ts
 * globToRegExp('*.tmp').test('build.tmp')          // → true
 * globToRegExp('*.tmp').test('exports/notes.tmp')  // → true  (basename match)
 * globToRegExp('*.tmp').test('build.txt')          // → false
 * globToRegExp('exports/*').test('exports/a')      // → true
 * globToRegExp('exports/*').test('src/a')          // → false
 * ```
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') {
      // `*` never crosses a `/` boundary — one directory level only.
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      source += '\\' + ch;
    } else {
      source += ch;
    }
  }
  const anchored = `^${source}$`;

  // Basename convention: patterns without `/` match the last path segment
  // at any directory depth.
  if (!pattern.includes('/')) {
    // Equivalent to: (?:.*/)? matches an optional directory prefix.
    return new RegExp(`^(?:.*/)?${source}$`);
  }

  return new RegExp(anchored);
}

/** A file candidate for cleanup, identified by name and last-modified time. */
export interface CleanupFile {
  /** File path or name string the rules match against. */
  readonly name: string;
  /** Unix-epoch milliseconds of last modification. */
  readonly mtimeMs: number;
}

/** One cleanup rule: files matching {@link pattern} and older than {@link maxAgeDays} are candidates for deletion. */
export interface CleanupRule {
  /** Glob-style pattern (e.g. `*.tmp`, `exports/*`). */
  readonly pattern: string;
  /** Files older than this many days are eligible. */
  readonly maxAgeDays: number;
}

/** Result from {@link matchCleanup}. */
export interface CleanupResult {
  /** Files that matched NO rule or whose age is within every matching rule's threshold. */
  readonly keep: CleanupFile[];
  /** Files that matched at least one rule AND whose age exceeded {@link CleanupRule.maxAgeDays}. */
  readonly delete: CleanupFile[];
}

/**
 * Default cleanup rules applied when no custom rules are provided.
 *
 * - `*.tmp` — deleted after 1 day (temporary build artifacts).
 * - `exports/*` — deleted after 7 days (stale export downloads).
 */
export const DEFAULT_RULES: readonly CleanupRule[] = Object.freeze([
  { pattern: '*.tmp', maxAgeDays: 1 },
  { pattern: 'exports/*', maxAgeDays: 7 },
]);

/**
 * Classify an array of files into keep / delete buckets per the supplied
 * cleanup rules. A file is deleted when it matches at least one rule AND
 * its age exceeds that rule's {@link CleanupRule.maxAgeDays}.
 *
 * Rules are evaluated independently per file: if file A matches rule R1
 * (age okay) and rule R2 (age exceeded), A is deleted (any matching rule
 * can authorise deletion). If a file matches no rule it is always kept.
 *
 * @param files - Files to classify. Never mutated.
 * @param rules - Cleanup rules to evaluate. Defaults to {@link DEFAULT_RULES}.
 * @returns Partitioned result with keep and delete arrays.
 * @example
 * ```ts
 * const files: CleanupFile[] = [
 *   { name: 'debug.tmp', mtimeMs: Date.now() - 86400_000 * 5 },
 *   { name: 'exports/report.csv', mtimeMs: Date.now() - 86400_000 * 3 },
 *   { name: 'src/main.ts', mtimeMs: Date.now() - 86400_000 * 30 },
 * ];
 *
 * const { keep, delete: toDel } = matchCleanup(files);
 * // toDel → [debug.tmp] (matches *.tmp, 5 days > 1)
 * // keep → [exports/report.csv] (3 days < 7), [src/main.ts] (no matching rule)
 * ```
 */
export function matchCleanup(
  files: readonly CleanupFile[],
  rules: readonly CleanupRule[] = DEFAULT_RULES,
): CleanupResult {
  const keep: CleanupFile[] = [];
  const delete_: CleanupFile[] = [];

  for (const file of files) {
    const now = Date.now();
    let shouldDelete = false;

    for (const rule of rules) {
      if (!globToRegExp(rule.pattern).test(file.name)) continue;

      const ageMs = now - file.mtimeMs;
      const maxAgeMs = rule.maxAgeDays * 86_400_000;

      if (ageMs > maxAgeMs) {
        shouldDelete = true;
        // Any matching rule that exceeds age is enough — no need to check
        // remaining rules for this file.
        break;
      }
    }

    (shouldDelete ? delete_ : keep).push(file);
  }

  return { keep, delete: delete_ };
}
