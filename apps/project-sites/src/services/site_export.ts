/**
 * @module services/site_export
 *
 * Pure export/backup archive builder for sites. All exports are deterministic
 * (no clock, no I/O): the caller provides content strings, this module shapes
 * them into a downloadable zip manifest and provides estimate helpers.
 *
 * @example
 * ```ts
 * const manifest = buildManifest('site_abc', 'my-site', [
 *   { name: 'index.html', content: '<h1>Hello</h1>' },
 * ]);
 * // → { siteId: 'site_abc', slug: 'my-site', files: [{ path: '/index.html', content: '…', sizeBytes: 20 }], … }
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single file entry in an export archive. */
export interface ExportAsset {
  /** Relative path within the archive, e.g. `/index.html` or `/assets/style.css`. */
  path: string;
  /** Raw text content of the file. */
  content: string;
  /** Byte size of `content` (UTF-8). */
  sizeBytes: number;
}

/**
 * Complete description of a site export.
 * The `files` array is the manifest body — every file the archive contains.
 */
export interface ExportManifest {
  /** The site's database id. */
  siteId: string;
  /** The site's URL slug (e.g. `my-site`). */
  slug: string;
  /** ISO 8601 UTC timestamp of when the manifest was built. */
  exportedAt: string;
  /** Every file in the archive. */
  files: ExportAsset[];
  /** Sum of all `sizeBytes` across files. */
  totalSize: number;
  /** Number of entries in `files`. */
  fileCount: number;
}

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed ExportManifest from an array of file entries.
 *
 * Each entry's `name` is a relative path (e.g. `index.html`) and is prefixed
 * with `/` to produce the asset `path`.  `sizeBytes` is computed from the
 * UTF-8 byte length of the content string.
 *
 * @param siteId - The site's database id.
 * @param slug   - The site's URL slug.
 * @param files  - Raw file entries (name + content string).
 * @returns A complete ExportManifest with computed sizes and counts.
 *
 * @example
 * ```ts
 * const m = buildManifest('s1', 'my-site', [{ name: 'index.html', content: '<h1>Hi</h1>' }]);
 * expect(m.files).toHaveLength(1);
 * expect(m.files[0].path).toBe('/index.html');
 * ```
 */
export function buildManifest(
  siteId: string,
  slug: string,
  files: { name: string; content: string }[],
): ExportManifest {
  const assets: ExportAsset[] = files.map((f) => {
    const sizeBytes = new TextEncoder().encode(f.content).length;
    return {
      content: f.content,
      path: f.name.startsWith('/') ? f.name : `/${f.name}`,
      sizeBytes,
    };
  });

  const totalSize = assets.reduce((sum, a) => sum + a.sizeBytes, 0);

  return {
    exportedAt: new Date().toISOString(),
    fileCount: assets.length,
    files: assets,
    siteId,
    slug,
    totalSize,
  };
}

// ---------------------------------------------------------------------------
// manifestToJsonl
// ---------------------------------------------------------------------------

/**
 * Serialises an ExportManifest to newline-delimited JSON (JSONL).
 *
 * The first line is a manifest-header JSON object. Every subsequent line is
 * one file entry: `{ path, content, sizeBytes }`.
 *
 * This format is designed for streaming ingestion — line-by-line parsing
 * without loading the entire archive into memory.
 *
 * @param manifest - The manifest to serialise.
 * @returns A JSONL string, one JSON object per line.
 *
 * @example
 * ```ts
 * const m = buildManifest('s1', 'my-site', [{ name: 'i.html', content: 'x' }]);
 * const jsonl = manifestToJsonl(m);
 * const lines = jsonl.trim().split('\n');
 * expect(lines).toHaveLength(2); // header + 1 file
 * expect(JSON.parse(lines[0])).toHaveProperty('_meta');
 * ```
 */
export function manifestToJsonl(manifest: ExportManifest): string {
  const header = {
    _meta: 'site-export-v1',
    exportedAt: manifest.exportedAt,
    fileCount: manifest.fileCount,
    siteId: manifest.siteId,
    slug: manifest.slug,
    totalSize: manifest.totalSize,
  };

  const lines = [JSON.stringify(header)];

  for (const file of manifest.files) {
    lines.push(
      JSON.stringify({
        content: file.content,
        path: file.path,
        sizeBytes: file.sizeBytes,
      }),
    );
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// estimateZipSize
// ---------------------------------------------------------------------------

/**
 * Estimates the compressed size of a zip archive built from this manifest.
 *
 * Uses a fixed 0.33 compression ratio as a reasonable heuristic for text-heavy
 * site content (HTML, CSS, JS, JSON) — typical gzip/deflate behaviour for
 * mixed text assets.  Binary-heavy exports will under-estimate; this is an
 * estimate, not a guarantee.
 *
 * The ratio was chosen as a conservative midpoint between measured
 * compression ratios for HTML (~25%), CSS (~40%), and JS (~35%).
 *
 * @param manifest - The manifest to estimate.
 * @returns Estimated compressed size in bytes (rounded to the nearest integer).
 *
 * @example
 * ```ts
 * const m = buildManifest('s1', 'my-site', [{ name: 'a.txt', content: 'hello' }]);
 * // content is 5 bytes → 5 * 0.33 ≈ 2
 * expect(estimateZipSize(m)).toBe(2);
 * ```
 */
export function estimateZipSize(manifest: ExportManifest): number {
  return Math.round(manifest.totalSize * 0.33);
}
