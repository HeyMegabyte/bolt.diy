/**
 * Single source of truth for "is this URL the bolt.diy editor host?".
 *
 * The persistent bolt iframe (`.bolt-frame`) only lifts into place
 * (`.bolt-frame--visible`) on the editor route; on every other admin route it
 * is parked off-screen so the routed section (rendered in the shell's
 * `<router-outlet>`) is fully visible.
 *
 * The dashboard lives at `/admin` and must NOT be treated as the editor —
 * historically `/admin` WAS the editor, and the stale `url === '/admin'` check
 * left the iframe covering `app-admin-dashboard`. Editor === `/admin/editor`
 * (and its sub-paths) only.
 */
export function isEditorPath(url: string): boolean {
  const path = url.split('?')[0].split('#')[0];
  return path === '/admin/editor' || path.startsWith('/admin/editor/');
}
