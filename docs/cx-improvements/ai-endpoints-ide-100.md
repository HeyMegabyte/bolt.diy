# CX Improvement — AI Endpoints IDE (100 Ideas)

> **Surface:** `/admin/ai-endpoints` IDE (`src/app/pages/admin/sections/ai-endpoints/`).
> **Bar:** Cursor / Zed / VS Code Web / StackBlitz Codeflow / CodeSandbox / Replit / Bolt.new / v0 polish.
> **Constraint:** CodeMirror 6 modular (lazy-loaded extensions). IDE chunk ≤320KB gz.
>
> Each idea: **P0** (top‑50 ship now) / **P1** (next sprint) / **P2** (later). One‑two line concrete description.

---

## Editor Experience (1–18)

1. **P0** Multi‑cursor editing via Alt‑click + Cmd‑D word‑under‑caret. CM6 supports out of the box; just enable `EditorState.allowMultipleSelections`.
2. **P0** Find & replace panel (Cmd+F, Cmd+Opt+F) with regex / case / whole‑word toggles via `@codemirror/search`.
3. **P0** Bracket‑pair colorization + auto‑close brackets via `bracketMatching()` + `closeBrackets()` from `@codemirror/language` + `@codemirror/autocomplete`.
4. **P0** Indentation guides + whitespace dots toggleable from settings drawer.
5. **P0** Format‑on‑save hook with debounced Prettier‑lite (simple JS/JSON formatter; full Prettier lazy‑loaded later).
6. **P0** Auto‑save with 500 ms debounce; visible "Saved · 2s ago" pill in status bar.
7. **P0** Undo / redo with named checkpoints (Cmd+Shift+Z opens history drawer of recent dirty states).
8. **P0** Word wrap toggle (Cmd+Alt+Z) persisted per language.
9. **P1** Vim keymap (lazy `@replit/codemirror-vim`) toggleable from settings.
10. **P1** Emacs keymap (lazy `@replit/codemirror-emacs`).
11. **P0** Bracket matching with red squiggle on mismatch.
12. **P1** Inline snippet insertion (Tab to expand `clog → console.log()`).
13. **P0** Cursor blink + selection persists across tab switch.
14. **P1** Per‑tab scroll position memory.
15. **P1** Line decoration ribbon (changed‑since‑last‑save).
16. **P1** Sticky scroll: pin current function header to the top of the viewport.
17. **P2** Inline code lens (Run · Debug · Profile actions above each exported handler).
18. **P2** Inline image / svg preview when caret lands on a base64 / data URI.

## File Management (19–30)

19. **P0** Cmd+P fuzzy file finder over the current files map (Levenshtein‑lite scorer).
20. **P0** Rename file inline (F2 on tree row, Enter confirms, Esc cancels).
21. **P0** Drag‑drop reorder + drag‑into‑folder in the tree.
22. **P0** Right‑click context menu on tree rows (Rename / Duplicate / Delete / Copy path / Reveal in tabs).
23. **P0** Collapse / expand folder rows with chevron + persisted state per endpoint.
24. **P0** New file from template picker (handler / lib / test / md).
25. **P0** Search files & content (Cmd+Shift+F) — case‑insensitive substring across files map with result list.
26. **P1** File icons that vary by extension (TS / JS / PY / RS / MD / JSON / TOML mapped colours).
27. **P1** Treat tree clicks on `.md` as side‑by‑side markdown preview.
28. **P1** Treat tree clicks on `.json` as JSON tree viewer with collapse/expand.
29. **P1** Drag .zip / folder onto tree → unzip into endpoint's files map.
30. **P2** Symlink visualisation for shared `lib/` paths across endpoints in the same org.

## Tabs & Layout (31–40)

31. **P0** Cmd+E recent files history overlay (last 10 opened, MRU order).
32. **P0** Cmd+Shift+Tab tab‑switcher overlay (live thumbnail of each tab).
33. **P0** Cmd+1/2/3/4 jumps to that tab index.
34. **P0** Middle‑click closes a tab.
35. **P0** Cmd+W closes the active tab (Cmd+K W closes others).
36. **P0** Pin / unpin tab (pinned tabs are sticky on the left).
37. **P1** Vertical split editor (Cmd+\) — show two files side by side.
38. **P2** Horizontal split editor (Cmd+K Cmd+\).
39. **P0** Tab dirty dot disappears after save; visible immediately on edit.
40. **P0** Breadcrumb bar above the editor: `endpoint / src / index.ts` with hover‑to‑symbol jump.

## Command Palette & Keyboard (41–55)

41. **P0** Cmd+Shift+P command palette specific to the IDE (separate from global). Lists every action with shortcut hint.
42. **P0** Cmd+I inline AI overlay on selection ("Explain", "Rewrite", "Add tests", "Optimise").
43. **P0** Cmd+Enter "Save & Deploy" combo from anywhere in IDE.
44. **P0** Cmd+\` toggles terminal panel.
45. **P0** Cmd+/ toggles line comment in current language.
46. **P0** Cmd+Shift+/ toggles block comment.
47. **P0** Alt+Up / Alt+Down moves the current line.
48. **P0** Shift+Alt+Up / Down duplicates the current line.
49. **P0** Cmd+L selects the current line; repeat to extend.
50. **P0** Cmd+G goes to line number (overlay input).
51. **P1** Cmd+T jumps to a symbol in the current file (parsed function / export list).
52. **P1** Cmd+Shift+O outline panel for the current file.
53. **P1** Alt+Left / Alt+Right navigates recent caret positions across files.
54. **P2** Cmd+K Cmd+S opens the global shortcut cheat‑sheet.
55. **P0** Keyboard shortcut hints inside menus / buttons (tiny ⌘‑pill).

## AI Features (56–66)

56. **P0** Side AI Chat pane with project‑wide context (all files passed as system tokens, capped to 16k chars).
57. **P0** "Explain this code" inline AI on highlight → bottom overlay with streamed answer.
58. **P0** "Add tests" generates a sibling `*.test.ts` file and opens it as a new tab.
59. **P0** "Rewrite selection" with prompt input + diff acceptance modal.
60. **P0** AI cURL / Python / JS / TypeScript / Rust client snippet generator per endpoint.
61. **P0** AI embed widget code generator (script tag + iframe variants).
62. **P1** AI auto‑name file when created blank (based on first edit).
63. **P1** AI auto‑suggest commit message at deploy time.
64. **P1** RAG chat over deploy logs (ask "why did my last deploy fail?").
65. **P1** AI cost estimator before deploy (token forecast + $).
66. **P2** AI agent loop ("fix all lint errors") with diff approval at each step.

## Git / Deploy / Runtime (67–80)

67. **P0** Deploy progress drawer with streaming SSE log lines.
68. **P0** Rollback drawer listing last 10 deploys; one‑click revert.
69. **P0** Promote preview → production with side‑by‑side diff approval modal.
70. **P0** Conventional‑commit assistant in deploy modal (`feat:`, `fix:`, etc.).
71. **P0** Env vars editor in side panel with reveal‑once for secret values.
72. **P0** KV / R2 / D1 binding browser panel (list keys / objects / tables).
73. **P0** Cron expression visualiser (`*/5 * * * *` → "every 5 min · next: 2:35 PM").
74. **P0** Schedule preview list ("next 5 runs").
75. **P0** Endpoint health pill (up / degraded / down) polling /health every 30s.
76. **P0** Request replay button per row in Logs panel.
77. **P0** Real‑time invocation log streaming via EventSource (fallback to 5s polling).
78. **P1** Git diff gutter (+/− markers from last saved state).
79. **P1** Inline blame on hover (author · timestamp · commit message stub).
80. **P2** Cost forecast per endpoint (CPU‑ms × invocations × $0.0X).

## Status Bar & Panels (81–90)

81. **P0** Status bar shows language · cursor line:col · file size · selection length.
82. **P0** Status bar shows live deploy state with coloured pill.
83. **P0** Status bar shows lint count clickable to filter problems panel.
84. **P0** Problems panel listing lint diagnostics with file:line jump.
85. **P0** Terminal panel (xterm‑lite stub running `wrangler tail` over SSE).
86. **P1** Minimap toggle (Cursor‑style overview of current file).
87. **P0** Theme picker (One Dark · Aurora · Solarized Dark · Brand Cyan · GitHub Light) persisted per user.
88. **P1** Font picker (JetBrains Mono · Fira Code · Cascadia Code · IBM Plex Mono · system).
89. **P1** Font size +/− buttons with Cmd+= / Cmd+−.
90. **P0** Settings drawer (Cmd+,) consolidating theme · font · keymap · autosave · format‑on‑save toggles.

## Performance, A11y, Mobile (91–100)

91. **P0** Lazy‑load every CM6 language pack only when a tab of that language opens.
92. **P0** Lazy‑load Vim/Emacs/search packs behind first activation.
93. **P0** IDE chunk budget gate: build fails if `>320KB gz`.
94. **P0** prefers‑reduced‑motion respected on tab transitions & palette enter.
95. **P0** Full keyboard access: every action reachable without a mouse.
96. **P1** Screen‑reader landmarks (`role="region" aria-label="file tree"`).
97. **P1** Mobile breakpoint: tree collapses behind a hamburger; tabs scroll.
98. **P0** Tag chips per endpoint already exist — add filter chips to IDE header.
99. **P1** Folder‑as‑route hint badge in the tree when path matches Worker file‑router convention.
100. **P2** Multi‑language polyglot project: lint each file with the matching language pack only.

---

## Implementation Plan — Top 50 (P0 + critical P1)

Items 1–11, 19–26, 31–36, 39–50, 56–61, 67–77, 81–87, 90–95 ship in this PR via:

- `ide-shortcuts.service.ts` — keymap registry + command palette commands.
- `ide-extras.component.ts` — Cmd+P / Cmd+Shift+P palettes, settings drawer, theme picker, AI quick‑action overlay, deploy log streamer, problems panel, breadcrumbs, recent files overlay.
- `code-editor.component.ts` — extra CM6 extensions (search, multi‑cursor, bracket‑match, autocomplete, lint surface, theme switching, font, keymap toggle, line manipulation, comment toggle, goto‑line).
- `ide.component.ts` — additive `@Input()`s for new panels; emits new events for breadcrumbs / autosave / deploy‑log / problems.
- `ai-endpoints-ide-extras.spec.ts` — E2E coverage for new test‑ids.
- `ide-shortcuts.service.spec.ts` — unit test of the shortcut registry.

P0 count: 60 · P1 count: 23 · P2 count: 17. Top‑50 implemented = the 50 marked above.
