/**
 * Brand-token cohesion guard (cyan/black cockpit system).
 *
 * The admin focus ring is applied across every section component via
 * `outline: var(--ps-ring-focus)`. It MUST be the cyan brand accent (#00E5FF),
 * not the stray mint-green (#00ffc8) it drifted to — otherwise keyboard focus
 * indicators render off-brand green in the sections while the shell uses cyan,
 * an inconsistent + off-brand focus appearance across the same admin.
 *
 * styles.scss (imported into the Karma test bundle) pulls in _polish.scss where
 * the token lives, so we can read it straight off :root.
 */
describe('brand tokens (cyan/black cohesion)', () => {
  it('--ps-ring-focus is the cyan brand accent, never the off-brand mint green', () => {
    const ring = getComputedStyle(document.documentElement)
      .getPropertyValue('--ps-ring-focus')
      .trim()
      .toLowerCase();
    expect(ring).withContext('the focus-ring token must be defined').not.toBe('');
    expect(ring).withContext('focus ring must be cyan #00E5FF').toContain('#00e5ff');
    expect(ring).withContext('focus ring must NOT be the stray mint green #00ffc8').not.toContain('#00ffc8');
  });

  it('--ps-grad-primary is a cyan gradient (one source of truth for primary CTA buttons), never mint green', () => {
    const grad = getComputedStyle(document.documentElement)
      .getPropertyValue('--ps-grad-primary')
      .trim()
      .toLowerCase();
    expect(grad).withContext('the primary-gradient token must be defined').not.toBe('');
    expect(grad).withContext('primary gradient must be a linear-gradient').toContain('linear-gradient');
    expect(grad).withContext('primary gradient must start from cyan #00E5FF').toContain('#00e5ff');
    expect(grad).withContext('primary gradient must NOT be the stray mint green #00ffc8').not.toContain('#00ffc8');
  });

  // `.text-accent` is not a Tailwind utility (no `accent` colour in the theme), so
  // without the global floor rule it renders a dim near-invisible teal — axe caught
  // it serious (~1.1:1) on the mcp-server endpoint URL. Lock the global cyan floor.
  it('.text-accent resolves to the cyan brand accent (global floor — not a dim teal)', () => {
    const el = document.createElement('span');
    el.className = 'text-accent';
    el.textContent = 'accent';
    document.body.appendChild(el);
    const color = getComputedStyle(el).color.replace(/\s/g, '');
    document.body.removeChild(el);
    // --ps-accent is undefined on :root in the test bundle → the #00e5ff fallback
    // applies → rgb(0,229,255). It must be bright cyan, never the dim teal.
    expect(color).withContext('global .text-accent must be cyan, not a dim teal').toBe('rgb(0,229,255)');
  });
});
