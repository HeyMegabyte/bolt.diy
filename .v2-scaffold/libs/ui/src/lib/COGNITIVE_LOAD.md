# Cognitive-Load Defaults (BACKLOG_50 #47)

Cognitive-load-friendly layout is the **default**, not a toggle the user must hunt for. The dashboard, marketing site, generated tenant sites, and any text-heavy view inherit these settings on first render.

## Defaults baked into `css-vars.scss`

| Variable | Value | Rationale |
| --- | --- | --- |
| `--ps-readable-measure` | `65ch` | Paragraph max-width per Bringhurst / Nielsen Norman — anything wider degrades scan-back behavior |
| `--ps-readable-line-height` | `1.6` | Comfortable rag for body sizes ~16-18px |
| `--ps-readable-paragraph-spacing` | `1em` | Visible block separation without forcing two `<br>` |
| `--ps-readable-weight` | `400` | Standard regular — NEVER `300` for body text (fails AAA at small sizes on subpixel rendering) |
| `--ps-readable-fg` | `#ffffff` on `var(--ps-bg)` | Contrast ratio ≈ 19:1 (WCAG AAA target is 7:1) |
| `--ps-max-primary-actions` | `3` | Hick's Law — choice latency rises with option count; `>3` primaries on one surface = overflow menu |

## Usage

Wrap any block of prose, settings rows, FAQ items, or doc content:

```html
<article class="ps-readable">
  <h2>…</h2>
  <p>…</p>
  <p>…</p>
</article>

<!-- equivalent attribute form -->
<section data-readable>
  …
</section>
```

The `.ps-readable` / `[data-readable]` selector applies the measure cap, line-height, paragraph spacing, weight, and color tokens in one shot.

## Max-3-actions pattern

`DashboardShellComponent.collapsePrimaryActions(items)` splits any list of CTAs into `{ visible, overflow }` so primary surfaces never render more than 3 buttons inline. The overflow tail belongs in an `…` menu (PrimeNG `p-menu` popup, button trigger labelled "More actions").

```ts
const { visible, overflow } = this.shell.collapsePrimaryActions(this.actions());
// visible.length ≤ 3, overflow drives a <p-menu> trigger
```

Apply on:
- Toolbar-end CTAs (search / online toggle / role switcher / notifications / account)
- Per-row action buttons in tables
- Page-header action clusters
- Modal footer button rows

## What this rule does NOT touch

- **Navigation** is not an "action" — the left rail stays full because it's a destination map, not a choice landing
- **Forms** are not action clusters — submit / cancel pairs are excluded (typically only 2)
- **Empty states** with a single primary CTA are excluded

## References

- Nielsen Norman Group. "Reading Patterns in Digital Content" (2024).
- Bonnie Smith. "Cognitive Load and the Design of Forms" (NN/g, 2023).
- Microsoft Inclusive Design Toolkit (2023).
- WCAG 2.2 AAA contrast (Level AAA 7:1 normal text).
- Hick, W.E. (1952). "On the rate of gain of information." Quarterly Journal of Experimental Psychology, 4(1).
