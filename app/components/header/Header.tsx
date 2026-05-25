/**
 * The bolt.diy `<header>` is intentionally suppressed across every entry
 * point — `editor.projectsites.dev` standalone AND the iframe inside
 * `projectsites.dev/admin`. The admin shell already owns chrome (sidebar
 * + top bar + Save/Deploy action), so duplicating logo + ChatDescription
 * + HeaderActionButtons here just steals vertical space and creates two
 * competing "current project" indicators.
 *
 * A CSS safety net in `app/styles/index.scss` hides
 * `header.border-bolt-elements-borderColor` so any other route that still
 * imports the legacy header path (e.g. `routes/git.tsx`) also hides it
 * without each route having to opt in. The component itself returns null.
 */
export function Header() {
  return null;
}
