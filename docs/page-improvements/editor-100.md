# Editor Page — 100 Improvements

> Page: `apps/project-sites/frontend/src/app/pages/admin/sections/editor.component.ts`
> Surface: `/admin` editor section embedding bolt.diy via iframe + postMessage protocol.
> Competitive benchmark: bolt.diy, StackBlitz, CodeSandbox, v0.dev, Replit, Lovable, Cursor Composer.

Priority legend: **P0** = ship now (top 20), **P1** = next sprint, **P2** = backlog / polish.

---

## A. Live Preview & Multi-Viewport (1–12)

1. **P0** Device toolbar: Mobile / Tablet / Desktop / Fluid toggle that resizes the iframe wrapper.
2. **P0** Custom viewport width input (px) with quick presets 375/390/768/1024/1280/1440/1920.
3. **P0** Orientation flip (rotate icon) — swaps width/height for the active preset.
4. **P0** "Open preview in new tab" full-screen action (already exists, surface in toolbar).
5. **P1** Side-by-side dual viewport (mobile + desktop) for instant responsive QA.
6. **P1** Pixel-perfect zoom controls (50% / 75% / 100% / Fit) for small viewports.
7. **P1** Safe-area mask overlay for iPhone notch + Dynamic Island previews.
8. **P1** Network throttle simulator (Fast 3G / Slow 4G) via service-worker stub.
9. **P2** Color blindness simulator filter (protanopia, deuteranopia, tritanopia).
10. **P2** Dark / light scheme toggle that injects `color-scheme` overrides into preview.
11. **P2** Reduced-motion preview toggle (prefers-reduced-motion media match).
12. **P2** Screen-reader narration probe — TTS the focused preview node.

## B. AI Chat & Prompting (13–24)

13. **P0** Floating AI command bar (Cmd+K in editor section) for "Make hero bolder", "Add testimonials", etc.
14. **P0** Inline AI suggestion banner above iframe ("Your hero could be sharper, try this…").
15. **P0** Quick-prompt chips: "Improve copy", "Add FAQ", "Tighten spacing", "Lighten palette".
16. **P0** Undo last AI action — `PS_UNDO_AI` postMessage hook.
17. **P1** Generate 3 variations side-by-side (A/B/C) with one-click "Keep this".
18. **P1** Voice prompt input — record audio → transcribe → send to bolt.
19. **P1** Image-to-edit: drop an inspiration image, AI matches the vibe.
20. **P1** Prompt history dock — searchable timeline of every prompt this session.
21. **P2** Saved snippet library ("our voice", "compliance footer") inserted via `/` command.
22. **P2** Team prompt presets shared across org via D1.
23. **P2** AI agent picker — Claude vs GPT-4o vs local Llama for the edit.
24. **P2** Cost meter showing token spend per prompt + cumulative session cost.

## C. Save / Deploy / Version (25–36)

25. **P0** Save-state indicator (Saved / Saving / Unsaved) in toolbar with last-saved timestamp.
26. **P0** Auto-save countdown (e.g. "Auto-saving in 12s") + dot pulse when dirty.
27. **P0** Deploy FAB — floating action button bottom-right for quick deploy.
28. **P0** Build / deploy status pill (Live / Building / Errored) with click-to-logs.
29. **P1** Named snapshots — "Save as v1.2" → frozen snapshot served at `slug-v12.projectsites.dev`.
30. **P1** Version diff viewer — picks two snapshots and shows visual + code diff.
31. **P1** One-click rollback to previous deploy.
32. **P1** Deploy-on-pause — if no edits for N minutes, auto-deploy.
33. **P2** Branch model — `main` vs `draft` with merge UI.
34. **P2** Scheduled deploy ("Publish at 9am tomorrow").
35. **P2** Pre-deploy checklist (Lighthouse, axe, broken-links) with go/no-go gate.
36. **P2** Deploy receipt drawer: file count, byte delta, CDN purge confirmation.

## D. Inspect & Edit-in-Place (37–46)

37. **P0** Element inspector — click on iframe element → see source path + class list.
38. **P1** Inline text edit — double-click any text → contentEditable → POST patch.
39. **P1** Color picker overlay — click any color swatch in preview → palette popover.
40. **P1** Spacing nudger — arrow keys bump padding/margin in 4px steps when an element is selected.
41. **P1** Font swap menu — hover any text → choose family/weight from Google Fonts.
42. **P1** Section drag-handle reorder in preview.
43. **P2** Image replacer — drag-drop new image onto an `<img>` in preview.
44. **P2** Icon library swap (Lucide / Tabler / Heroicons) on selected `<svg>`.
45. **P2** CSS variable knob — surface design tokens (color, radius, shadow) as live sliders.
46. **P2** Component palette pull-out (left edge) — drag pre-built shadcn/ui blocks in.

## E. Quality, A11y, SEO Surfaces (47–58)

47. **P0** Lighthouse mini-card (Perf / A11y / SEO / Best Practices) auto-refreshed on deploy.
48. **P0** Accessibility scanner — axe-core run on iframe DOM with one-click fixes.
49. **P0** Iframe console capture — surface errors / warnings inline below preview.
50. **P1** SEO sidebar — title + meta length, JSON-LD count, OG image preview, hreflang map.
51. **P1** Broken link checker — periodic crawl of preview routes.
52. **P1** Color-contrast probe — click two elements → AA / AAA report.
53. **P1** Performance budget meter — JS / CSS / image weight bars.
54. **P1** Yoast-style readability score on body copy.
55. **P2** Sitemap & robots.txt linter inline.
56. **P2** Structured-data validator (Google Rich Results API proxy).
57. **P2** Social card preview (Twitter, LinkedIn, OG, iMessage) renderer.
58. **P2** Voice-search readability — "Hey Siri, what does this site sell?" rehearsal.

## F. Navigation & Information Density (59–69)

59. **P0** Page navigator — thumbnail strip of every route in the generated site, click to preview.
60. **P0** Quick-find route — Cmd+P fuzzy search over routes.
61. **P0** Site stats mini-card — visitors today, form submissions, AI traces.
62. **P1** Breadcrumb showing `Editor > {site} > {current route}`.
63. **P1** Pinned routes — star a route to keep it in the navigator.
64. **P1** Recently viewed routes list (last 5).
65. **P1** Section TOC sidebar for long pages.
66. **P2** Mini-map of the page (Sublime-style scroll preview).
67. **P2** Heatmap overlay if PostHog session recordings exist.
68. **P2** Search-within-site (Cmd+F over rendered text).
69. **P2** Funnel goal markers (cart / contact / signup) overlaid on preview.

## G. Collaboration & Presence (70–76)

70. **P1** Multi-cursor presence — show teammate avatars on the iframe edges.
71. **P1** Comment-on-element — sticky notes pinned to DOM nodes.
72. **P1** "@mention" a teammate inline; sends Slack/Email with deep link.
73. **P2** Live cursor chat balloons.
74. **P2** Co-edit lock — only one editor can drive AI prompts at a time.
75. **P2** Activity feed dock — every save, every deploy, every comment.
76. **P2** Recording — capture a screen-cast walkthrough of the edit session.

## H. Productivity & Keyboard (77–84)

77. **P0** Keyboard cheatsheet pull-out (press `?`) listing every shortcut.
78. **P0** Cmd+S = Save & Deploy.
79. **P0** Cmd+Shift+R = Reload preview iframe.
80. **P1** Cmd+Shift+P command palette scoped to editor (prompts, deploy, snapshot).
81. **P1** Focus mode — hide admin chrome, full-bleed editor (`F` to toggle).
82. **P1** Per-editor density preset (Comfortable / Compact / Dense).
83. **P2** Pomodoro timer in toolbar (25 min focus blocks).
84. **P2** Vim/Emacs bindings inside iframe via bolt postMessage.

## I. Health, Errors & Recovery (85–92)

85. **P0** Iframe load-failure fallback with retry button + reason hint.
86. **P0** Health indicator dot (green/amber/red) for editor connection status.
87. **P1** Network blip resilience — auto-reconnect bolt.diy iframe on offline → online.
88. **P1** "Editor froze?" recovery — soft reboot iframe without full page reload.
89. **P1** Crash report bundler — collects console, network, postMessage log → mailto support.
90. **P2** Sentry breadcrumb mirror of every postMessage.
91. **P2** Watchdog: ping iframe every 15s, surface stalled status.
92. **P2** Restore last unsaved buffer after accidental tab close.

## J. Onboarding, Delight & Polish (93–100)

93. **P0** First-visit guided tour (4 steps) — chat dock, device toolbar, save FAB, navigator.
94. **P1** "What's new" toast on first visit of a session — last 3 platform updates.
95. **P1** Cinematic skeleton states for every panel (not blank placeholders).
96. **P1** Toast stack consolidation — group identical messages.
97. **P2** Easter-egg confetti on first successful deploy.
98. **P2** Sound design — subtle click on chip-select, soft chime on deploy.
99. **P2** Editor-section-only theme variants (Studio, Midnight, Paper).
100. **P2** Personalized "Good morning, Brian" greeting + last session restored.

---

## P0 Implementation Set (top 20 wired into `editor.component.ts`)

1. Device toolbar (Mobile / Tablet / Desktop / Fluid) — #1
2. Custom viewport width input + presets — #2
3. Orientation flip — #3
4. Open-in-new-tab toolbar action — #4
5. Floating AI command bar (Cmd+K) — #13
6. Inline AI suggestion banner — #14
7. Quick-prompt chips — #15
8. Undo last AI action — #16
9. Save-state indicator with timestamp — #25
10. Auto-save countdown — #26
11. Deploy FAB — #27
12. Build / deploy status pill — #28
13. Lighthouse mini-card — #47
14. Accessibility scanner button — #48
15. Iframe console capture — #49
16. Page navigator (route thumbnails) — #59
17. Cmd+P quick-find route — #60
18. Site stats mini-card — #61
19. Keyboard cheatsheet pull-out (`?`) — #77
20. Iframe load-failure fallback + health indicator — #85 + #86

All twenty live behind a single new `EditorToolbarComponent` mounted above the iframe and reactive signals on `AdminEditorComponent`. Covered by `e2e/admin-editor.spec.ts` (Playwright) and `editor.component.spec.ts` (Jasmine unit).
