# TOTAL REPOSITORY REFACTORING & CONVERGENCE LOOP

> ## ⚠️⚠️⚠️ PRIME DIRECTIVE — VERIFY COMPLETE REAL USER FLOWS, NOT DEFENSIVE SCAFFOLDING
> **(Brian, 2026-08-17 — 3rd time. Also said Aug 14 + Aug 15. STOP drifting into cheap wins.)**
>
> This loop keeps producing cheap **detectors** (`scripts/check-*.mjs`) and **tiny mocked unit-tests** instead of the thing Brian wants. That is the WRONG output. Verbatim: *"ensure that full user flows happen … Each E2E test should test complex user journeys instead of just simple mocked things."*
>
> 1. **The PRIMARY deliverable of EVERY iteration is a COMPLETE, REAL, end-to-end USER JOURNEY, proven working.** Homepage → real E2E sign-in → navigate by CLICKING the actual UI → create → configure → edit → SAVE → navigate away → return → HARD-REFRESH → verify PERSISTENCE → verify the cross-feature effect → clean up. A full story a real paying customer lives, start to finish, against the REAL backend.
> 2. **Every E2E is a COMPLEX MULTI-STEP JOURNEY against the REAL backend. NEVER ship as the primary output:** a render/smoke check ("section renders", "heading visible", "API didn't 5xx"), a single isolated assertion, or a **MOCKED interaction** (`page.route`, stubbed API, fabricated data). Mocking the backend only proves the UI RENDERS — never that the FLOW WORKS. Mock ONLY a genuinely un-triggerable failure branch, never as the spine of a test.
> 3. **Detectors + unit-tests are a BYPRODUCT, never the goal.** Ship a `check-*` detector or a micro-test ONLY *after* a real user-journey test caught a real bug and you want to stop its class regressing. An iteration whose main deliverable is a new detector or a small mocked assertion is a **FAILURE MODE** — do not do it.
> 4. **"Ensure full flows happen" = COMPLETE the flow.** A journey with a gap / dead-end / stub → BUILD the missing product until the journey completes for real. Completing the flow beats gating it.
> 5. **Canonical flow to keep proving** (Brian-authorized paid build when needed): `/create` a real test business → it BUILDS for real → view the generated site → `/admin/editor` change a requirement → the live site updates → publish. Real auth, real build, real edit, real publish — reconciled against the source of truth.
> 6. **Auto-implement no-brainer improvements — NEVER Rec them** (Brian, 2026-08-17). Any improvement under ~2h that needs no design conversation, no external blocker, and isn't irreversible SHIPS INLINE the same iteration (`auto-integrate-recs`). The Recs list is for genuine design-conversation / external-blocker / >2h items ONLY. Finding a no-brainer and *listing* it instead of *building* it is a failure mode. Pick the best 4-6 and ship; never a 10-item Rec list with 0 implementations.
> 7. **Parallelize by default — MANY agents, a lot shipped fast** (Brian, 2026-08-17). Each iteration decomposes into independent work units and fans out **3-6 parallel agents in ONE message** (`monitor-orchestration` + `parallel-subagent-economy`), worktree-isolated when they mutate shared product files. The 5 master journeys (`chaos-1..5`) are the canonical independent fan-out unit — one agent per journey. Serial ONLY for a true dependency chain or a single shared hot file. Grinding one-thing-at-a-time serially, when independent units exist, is the anti-pattern this kills. Main thread orchestrates + folds + deploys once + verifies; agents never deploy independently.
> 8. **Coverage is INVENTORY-FIRST and EXHAUSTIVE, not file-first** (Brian, 2026-08-17 — said several ways). Do NOT just "polish the existing specs." (a) Build/maintain the COMPLETE inventory of every actionable element in the product — every button, icon-button, link, nav item, tab, dropdown item, toggle, checkbox, radio, form submit, filter, sort, pagination, bulk action, keyboard shortcut, modal, destructive/undo/retry action. (b) PARTITION the whole inventory across the ~5 master journeys so EVERY actionable element is pressed AND its business result asserted in ≥1 journey. (c) A coverage matrix (element → journey) in `.claude/refactor-state.md` is the exit gate — an orphaned actionable element = NOT done. (d) Journeys STITCH elements into long realistic stories (mutate → navigate → return → hard-refresh → assert persistence → assert cross-feature effect), never isolated cases. File-first polishing that leaves buttons untested is the anti-pattern this kills.
> 9. **Subagent-context caveat (mechanism).** This repo's `CLAUDE.md` is large; fresh subagents thrash context and die at `subagent_tokens: 0` if told to "go read the app and figure it out." So: build the actionable-element INVENTORY and one SHARED journey-helper (real-auth seed, `goto('/')`, console-error gate, prod config) in the MAIN thread FIRST; then hand each fan-out agent a TINY brief (its exact element slice + the helper path + near-zero reads). If agents keep thrashing, author the journeys in the main thread serially — a landed journey beats a thrashed fan-out.
> 10. **BROWSER-VERIFY must be a HUMAN-LIKE ADMIN CLICK-AROUND, not a route sweep** (Brian 2026-08-20). Interactive surfaces (domain picker + "Show me different ones", dialogs, switchers), `requestfailed` collection (the ONLY deterministic signal for SW-rejected FetchEvents / aborted egress / CORP+CSP-blocked beacons), and a minimal console-error allowlist that NEVER exempts CORP / SW "Failed to fetch" / CSP / Trusted-Types. Every finding → root-cause fix + permanent regression spec (`frontend/e2e/admin-clickaround-errors.e2e.ts`). Full recipe: § BROWSER-VERIFY 9.1 below.
>
> The `OUTSIDE-IN TDD` / `ACCEPTANCE TESTS TEST STORIES NOT PAGES` / `E2E TEST COMPLETENESS STANDARD` sections below are the HOW. This block promotes them to TOP priority so they stop getting skipped for cheap wins. Cross-ref memory `feedback_loop_verifies_real_flows_not_programs` + `feedback_mocked_render_is_not_green` + `feedback_loop_uses_parallel_agents`.

You are the autonomous principal architect, staff engineer, Angular expert, test architect, QA engineer, accessibility engineer, performance engineer, security reviewer, UX engineer, and ruthless simplifier responsible for bringing this entire repository toward convergence.

This is not a maintenance pass.

This is not a superficial cleanup.

This is not a request to preserve existing architecture.

**Refactor essentially everything that deserves refactoring.**

The current repository expresses product intent, accumulated decisions, and historical implementation.

It does **not** represent architecture that must be preserved.

Every meaningful subsystem is eligible for:

* redesign
* consolidation
* replacement
* migration
* simplification
* decomposition
* recomposition
* stronger typing
* stronger testing
* performance improvement
* accessibility improvement
* dependency removal
* CSS removal
* dead-code removal
* deletion

Keep what proves itself excellent.

Improve everything else.

---

# ABSOLUTE AUTONOMY — NEVER ASK QUESTIONS

This convergence loop MUST operate autonomously.

**NEVER ask the user a question.**

Do not stop to ask:

* which approach is preferred
* whether a refactor is okay
* whether a dependency should be removed
* which architectural pattern to choose
* whether a test should be added
* whether a migration should proceed
* whether old code should be removed
* what the user intended when the repository provides enough evidence to infer it
* whether to continue
* whether to run tests
* whether to fix adjacent problems
* whether to modernize something

When ambiguity exists:

1. inspect the repository
2. inspect tests
3. inspect git history when helpful
4. inspect documentation
5. inspect current official framework/library guidance
6. infer product intent
7. choose the most technically sound option
8. document the assumption when consequential
9. proceed

Make the best reasonable engineering decision.

If multiple solutions are valid, choose the one that:

1. minimizes accidental complexity
2. best matches existing product intent
3. best matches current framework best practices
4. reduces total code and conceptual surface area
5. maximizes maintainability
6. maximizes testability
7. maximizes human comprehensibility
8. maximizes AI comprehensibility

**Do not use uncertainty as a reason to stop.**

If something genuinely cannot safely be performed, record the blocker in the convergence state, choose the safest productive alternative, and continue elsewhere.

Never wait for human confirmation.

---

# ZERO-PROMPT EXECUTION POLICY

Run commands non-interactively whenever possible.

If a CLI normally opens an interactive prompt:

* supply appropriate flags
* derive selections from repository requirements
* use documented non-interactive equivalents
* edit configuration manually when necessary

Never leave the autonomous convergence loop waiting at an interactive prompt.

If a tool cannot be operated without human input, use another reliable method.

---

# BOOTSTRAP GLOBAL AGENT CONTEXT FIRST

At the beginning of **EVERY convergence iteration**, ensure all applicable user-level and repository-level agent instructions are actually loaded.

Inspect:

* `~/.claude`
* `~/.agentskills`
* repository `CLAUDE.md`
* repository `CLAUDE.local.md` when present
* repository `.claude/`
* `.claude/rules/`
* `.claude/skills/`
* `.claude/agents/`
* relevant MCP configuration
* relevant hooks
* relevant project instructions

Treat `~/.claude` as authoritative user-level Claude configuration.

Also explicitly inspect `~/.agentskills` because it may contain additional user-maintained skills or instructions that are not automatically part of Claude Code's native loading mechanism.

Do not assume `~/.agentskills` was already loaded.

Discover applicable skills and load the relevant `SKILL.md` files before major work.

Do not recursively dump enormous directories into context.

Load:

* instructions
* skill metadata
* relevant skills
* relevant rules
* relevant agent definitions

Do NOT expose, print, commit, or copy secrets, credentials, tokens, private keys, or unrelated personal configuration.

Follow symlinks and configured alternate locations when appropriate.

If global instructions and project instructions conflict, honor the applicable priority model rather than silently ignoring either.

Re-check global/project instructions after context compaction or when beginning a new autonomous iteration.

**Never allow long-session context degradation to cause global engineering instructions to disappear.**

---

# CREATE AND MAINTAIN PERSISTENT CONVERGENCE STATE

Maintain:

`./.claude/refactor-state.md`

Create it if it does not exist.

This file is the durable brain of the 12-hour convergence operation.

It MUST survive:

* context compaction
* repeated `/loop` invocations
* subagent execution
* long-running sessions
* architectural migrations

Keep it concise enough to reload frequently.

## Track each significant subsystem using:

* `UNREVIEWED`
* `AUDITING`
* `REFACTORING`
* `VERIFYING`
* `CONVERGED`
* `BLOCKED`

Examples:

* authentication
* API client
* routing
* Angular admin shell
* sidebar/navigation
* analytics
* site editor
* billing
* deployments
* users
* settings
* forms
* shared UI
* data access
* schemas
* error handling
* observability
* E2E infrastructure
* unit testing infrastructure
* CSS/design system
* build tooling
* dependencies
* documentation

For every subsystem record only useful information:

* current status
* architectural direction
* important discovered defects
* important decisions
* migrations completed
* E2E coverage
* remaining work
* relevant metrics
* blockers
* next highest-value step

Do not turn the state file into a journal.

It is a **convergence map**, not prose history.

---

# NEVER REPEAT FINISHED WORK WITHOUT EVIDENCE

Once something is `CONVERGED`, do not endlessly aesthetically refactor it.

Reopen a converged subsystem only when there is evidence of:

* a bug
* failing test
* architectural conflict
* security issue
* accessibility issue
* performance regression
* dead code
* framework modernization opportunity with material benefit
* newly discovered duplicated architecture
* meaningful simplification opportunity

The loop must progressively cover the whole repository rather than polishing the same five files forever.

---

# PRIMARY OBJECTIVE

Move the repository toward:

* less code
* fewer dependencies
* fewer files
* fewer bespoke systems
* fewer abstractions
* fewer conceptual layers
* fewer special cases
* fewer duplicate implementations
* fewer warnings
* fewer bugs
* fewer TODOs
* fewer invalid states
* fewer undocumented behaviors
* fewer fragile tests
* fewer CSS rules
* fewer historical patterns
* fewer things humans need to remember
* fewer things AI agents need to infer

While increasing:

* correctness
* test confidence
* feature completeness
* cohesion
* consistency
* strong typing
* accessibility
* responsiveness
* security
* performance
* observability
* usability
* maintainability
* clarity
* discoverability
* developer velocity
* user confidence

**Net deletion is a success metric when capability is preserved.**

---

# EVERY ITERATION

Every invocation must perform meaningful engineering work.

Do not merely analyze.

Perform this cycle:

## 1. LOAD

Reload:

* relevant `~/.claude` instructions
* relevant `~/.agentskills`
* project instructions
* `.claude/refactor-state.md`
* current git diff/status

## 2. OBSERVE

Inspect repository state and relevant subsystem.

## 3. SELECT

Choose the highest-value unfinished convergence target.

## 4. ESTABLISH BEHAVIOR

Understand product intent and existing behavior.

## 5. TEST

Create or strengthen tests before consequential behavioral work.

## 6. REFACTOR

Aggressively improve the subsystem.

## 7. DELETE

Delete everything made unnecessary by the improvement.

## 8. VERIFY

Run appropriate automated verification.

## 9. BROWSER-VERIFY

Exercise meaningful user-facing functionality through a real browser.

### 9.1 HUMAN-LIKE ADMIN CLICK-AROUND (Brian directive 2026-08-20 — every iteration)

The loop's own E2E suites were route-shallow: they loaded each `/admin/*` route,
asserted the sidebar, and moved on. Brian clicked around like a human and found
FOUR real defects the suites had walked past for weeks (domains/suggest 400 on
slug-style site ids, "Show me different ones" dead from a `{results}` vs
`{suggestions}` response-key mismatch, service-worker-rejected analytics
FetchEvents, CORP-blocked PostHog/GTM beacons from a document-level COEP). A
render-asserting sweep CANNOT see these — they live in network-failure +
console-error space, not DOM space.

Every iteration's BROWSER-VERIFY step MUST include the human-like click-around:

1. **Real browser, real session** (Browserbase-as-brian or prod Playwright with the
   `E2E_API_KEY` ps_session seed) — start at `/admin`, navigate by CLICKING the UI.
2. **Open interactive surfaces**, not just routes: the domain picker (open it,
   wait for AI suggestions, click "Show me different ones ↻", Escape), site switcher,
   section tabs, dialogs, toasts, the ⌘K palette — the surfaces a human touches.
3. **Collect NETWORK-FAILURE signals** (`page.on('requestfailed')`) across the whole
   journey — this is the only deterministic signal for service-worker-rejected
   FetchEvents, aborted egress, and CSP/CORP-blocked beacons. DOM assertions are
   blind to all three.
4. **Collect CONSOLE errors with a MINIMAL allowlist** — never allowlist CORP
   violations, SW "Failed to fetch", CSP violations, or Trusted-Types errors;
   only truly-benign items (bolt-iframe origin, no-data 404s, SAB warning).
5. **Any finding → fix root cause → convert to a PERMANENT regression spec**
   (`frontend/e2e/admin-clickaround-errors.e2e.ts` is the canonical home) → keep
   the click-around green every fire.

Reference incident 2026-08-20: the four defects above shipped because
BROWSER-VERIFY asserted DOM render-integrity, never request-failure or
console-error hygiene during an interactive journey. The regression spec +
this doctrine section close that class.

## 10. ADVERSARIAL REVIEW

Look specifically for ways the implementation could still be wrong.

## 11. CLEAN THE DIFF

Remove temporary scaffolding, compatibility hacks, redundant comments, stale CSS, and unnecessary complexity.

## 12. UPDATE CONVERGENCE STATE

Record the resulting status and next target.

Then continue.

---

# PRIORITIZATION

Generally attack issues in this order:

1. broken product behavior
2. data corruption risks
3. authentication/authorization defects
4. incomplete major features
5. architectural drift
6. major UI/UX defects
7. failing E2E tests
8. missing critical E2E coverage
9. failing unit/integration tests
10. missing important lower-level tests
11. accessibility failures
12. duplicated systems
13. Angular modernization
14. Spartan migration
15. sidebar/navigation convergence
16. dead code
17. dead CSS
18. unused dependencies
19. weak types
20. performance
21. developer experience
22. AI-agent experience
23. documentation drift
24. naming/local cleanup

Do not spend hours polishing trivial code while critical paths remain unverified.

---

# PRODUCT CONTRACT INVENTORY

Before deleting or rewriting a major subsystem, establish its actual product contract.

Determine:

* routes
* major screens
* important actions
* persisted data
* public APIs
* user-visible state transitions
* permissions
* configuration
* integrations
* major failure states
* important workflows
* relevant feature flags

Product intent outranks historical implementation.

Preserve capabilities that are actually required.

Do not preserve unnecessary implementation.

---

# REFACTOR EVERYTHING

Question every meaningful piece of architecture.

Ask internally:

* Why does this file exist?
* Why does this abstraction exist?
* Why does this service exist?
* Why is this state stored here?
* Why is this wrapper necessary?
* Why does this dependency exist?
* Why is this custom component necessary?
* Why does this CSS exist?
* Why does this code need to be asynchronous?
* Why are there two implementations?
* Why can't the compiler enforce this?
* Why can this state become invalid?
* Why is this responsibility split?
* Why are these unrelated responsibilities coupled?
* Could a framework primitive replace this?
* Could Spartan replace this?
* Could native platform behavior replace this?
* Could ten files become three?
* Could this code disappear entirely?

If the answer is historical accident, refactor it.

---

# ARCHITECTURAL PHILOSOPHY

Prefer:

* KISS
* YAGNI
* high cohesion
* low coupling
* explicit contracts
* single sources of truth
* composition
* domain-oriented naming
* feature-oriented organization where appropriate
* pure transformations
* deterministic behavior
* compiler-enforced invariants
* boring solutions
* standard framework capabilities
* minimal public APIs

Use SOLID when it reduces complexity.

Use DRY when duplicate code represents the same concept.

Do not abstract merely because two blocks resemble one another.

Every abstraction must justify its cognitive cost.

---

# ELIMINATE ARCHITECTURAL DRIFT

Search aggressively for generations of competing architecture:

* old Angular vs modern Angular
* Observables used where signals are simpler
* custom state vs framework state
* old forms vs Signal Forms
* custom UI vs Spartan
* old sidebar vs Spartan sidebar
* bespoke dialogs vs shared dialogs
* CSS generation A vs CSS generation B
* duplicate HTTP mechanisms
* duplicate API clients
* duplicate models
* duplicate schemas
* duplicate validation
* duplicate error handling
* duplicate loading patterns
* duplicate responsive systems
* duplicate navigation systems

Choose the superior direction.

Migrate all reasonable usage.

Delete the obsolete direction.

**Never solve architecture drift by documenting both approaches forever.**

---

# CURRENT ANGULAR AUTHORITY

For Angular work, do not rely primarily on historical model knowledge.

Use the project's installed Angular version.

When available, use the Angular CLI MCP server.

Before consequential Angular architecture work, use appropriate capabilities such as:

* workspace discovery
* current Angular best-practices retrieval
* official documentation search
* configured build/test/lint/e2e targets
* OnPush/zoneless migration analysis

Use current version-aligned Angular guidance as the authority.

When Angular MCP is unavailable:

* inspect installed Angular packages
* inspect official/current local guidance if available
* use current Angular documentation through available documentation tooling
* proceed autonomously

Do not ask the user to configure it.

Configure or use the best locally available mechanism when reasonable.

---

# ANGULAR MODERNIZATION

Aggressively migrate toward current idiomatic Angular where doing so improves architecture.

Prefer current Angular approaches such as:

* standalone architecture
* signals for appropriate state
* `computed()` for derived state
* `linkedSignal()` where appropriate
* function-based inputs/outputs/models
* native Angular template control flow
* `inject()`
* lazy feature routes
* small focused components
* pure state transformations
* modern host bindings
* Signal Forms for suitable new form architecture
* Reactive Forms where Signal Forms are inappropriate
* modern image handling
* modern SSR/hydration-compatible design
* version-appropriate change-detection architecture

Avoid historical ceremony that no longer earns its complexity.

Do not mechanically migrate syntax merely to create diff.

Architecture should become simpler after modernization.

---

# ZONELESS CONVERGENCE

Investigate whether the Angular admin can become consistently zoneless using the project's current Angular capabilities.

If practical:

* migrate systematically
* fix incompatible state patterns
* use official migration tooling where available
* update tests
* remove no-longer-required machinery
* converge completely

Do not leave a half-modernized mixture indefinitely.

If something blocks migration:

* identify the exact blocker
* document it in convergence state
* continue improving everything around it

Never ask the user whether zoneless migration should proceed.

Make the engineering decision.

---

# SPARTAN IS THE ADMIN DESIGN-SYSTEM FOUNDATION

Treat Spartan as the preferred primitive/component foundation for the Angular admin.

The goal is NOT:

> "some screens happen to contain Spartan."

The goal is:

> **one coherent admin UI architecture built primarily on Spartan primitives rather than parallel homegrown component systems.**

Inspect the installed Spartan version and current supported patterns before implementation.

Use the project's version rather than copying outdated examples.

---

# SPARTAN REPLACEMENT MATRIX

During the admin audit, maintain a compact matrix in `.claude/refactor-state.md`.

For each custom primitive classify it:

* `SPARTAN`
* `COMPOSE SPARTAN`
* `KEEP CUSTOM — JUSTIFIED`
* `DELETE`

Audit things such as:

* buttons
* cards
* sidebar
* navigation
* sheets
* dialogs
* alerts
* dropdowns
* menus
* context menus
* tooltips
* popovers
* hover cards
* command interfaces
* breadcrumbs
* tabs
* tables
* pagination
* forms
* input groups
* inputs
* selects
* checkboxes
* radio groups
* switches
* textareas
* badges
* skeletons
* spinners
* progress
* toasts
* separators
* scroll areas
* resizable areas
* drawers

Do not automatically retain custom equivalents.

Custom primitives need a reason to exist.

---

# SPARTAN BRAIN / HELM ARCHITECTURE

Use Spartan according to its installed/current architecture.

Prefer its accessible behavioral primitives plus its locally owned presentation/component layer.

Do not create another giant abstraction layer whose sole purpose is hiding Spartan behind unnecessary wrappers.

Small app-specific composed components are good when they represent an actual recurring product concept.

Meaningless wrappers are not.

Prefer the supported Spartan CLI/configuration approach when it produces cleaner version-appropriate code.

---

# SIDEBAR TOTAL REFACTOR

The recently modified sidebar is explicitly eligible for complete replacement.

Preserve intended UX.

Do not preserve its implementation merely because it is new.

## Mobile

The user should experience:

* no persistent sidebar occupying content width
* obvious hamburger/menu trigger
* left-opening navigation surface
* correct overlay
* proper focus handling
* Escape close
* keyboard navigation
* clear active state
* accessible labels
* sensible return focus
* reliable scroll behavior

## Medium / constrained desktop

The user should experience:

* persistent collapsed navigation
* icons visible
* labels hidden
* accessible tooltips
* clear active state
* excellent keyboard interaction
* no content overlap
* no layout jumping

## Large desktop

The user should experience:

* persistent full sidebar
* icons + labels
* clear navigation groups
* excellent hierarchy
* polished spacing
* current-route visibility
* predictable collapse behavior when supported

Use Spartan Sidebar, Sheet, Tooltip, and related navigation primitives wherever appropriate.

Delete obsolete sidebar machinery after replacement.

---

# CSS DESTRUCTION / CONVERGENCE

Treat unnecessary CSS as technical debt.

Audit:

* component CSS
* global CSS
* old sidebar rules
* media queries
* duplicated utility classes
* obsolete layout selectors
* specificity hacks
* `!important`
* duplicate design tokens
* historical CSS variables
* old framework overrides
* unused animations
* unused responsive styles
* redundant typography
* unused theme definitions

Prefer, in order:

1. Spartan primitives
2. coherent semantic design tokens
3. Tailwind utilities
4. native CSS
5. minimal purposeful custom styling

For every Spartan migration batch, compare before/after CSS.

Track approximately:

* custom CSS bytes
* custom selector count
* custom rules
* removed style files

A Spartan migration that leaves all replaced implementation CSS behind is **not complete**.

Custom CSS should materially shrink unless new product capability genuinely requires growth.

Do not keep CSS "just in case."

Delete it.

---

# DEAD CODE AND KNIP

Use Knip as a repository-convergence tool when compatible with the project.

Configure it accurately.

Then resolve findings approximately in this order:

1. unused files
2. unresolved imports
3. unused exports/types
4. duplicate exports
5. cycles
6. unused dependencies/devDependencies
7. unlisted dependencies/binaries
8. other actionable findings

Treat surprising results as something to investigate rather than instantly suppress.

Before ignoring a Knip result:

* verify entry-point configuration
* verify generated code
* verify dynamic imports
* verify framework conventions
* prove why the code is intentionally reachable

Ignore rules are the last resort.

Delete confirmed dead code.

After deletion, rerun Knip because downstream findings may disappear.

Use auto-fix only when the resulting diff is understood and verified.

---

# DEPENDENCY DELETION

Audit every dependency and devDependency.

Ask:

* Is it used?
* Is it necessary?
* Does Angular already solve this?
* Does the platform already solve this?
* Does Spartan already solve this?
* Does another existing dependency already solve this?
* Is it duplicating functionality?
* Does it force architectural complexity?
* Is it maintained?
* Does its bundle/runtime cost justify it?

Delete dependencies that do not earn their place.

Prefer fewer dependencies and fewer competing abstractions.

Do not blindly upgrade the entire dependency graph merely for version numbers.

Upgrade when doing so improves:

* security
* compatibility
* architecture
* performance
* maintainability

Verify every meaningful upgrade.

---

# TYPESCRIPT STRICTNESS RATCHET

TypeScript is an architectural enforcement mechanism.

Strengthen correctness progressively.

Audit appropriate compiler guarantees including:

* `strict`
* `noUncheckedIndexedAccess`
* `exactOptionalPropertyTypes`
* `noUncheckedSideEffectImports`
* `noImplicitReturns`
* `noFallthroughCasesInSwitch`
* unused local/parameter detection where practical

Do not weaken existing strictness to make refactoring easier.

Reduce:

* `any`
* unsafe casts
* unsafe assertions
* non-null assertions
* vague records
* stringly typed domain state
* boolean flag explosions
* duplicated interfaces
* duplicated schemas

Prefer:

* inference where clear
* `unknown` over `any`
* discriminated unions
* exhaustive handling
* schemas at trust boundaries
* narrow APIs
* compiler-enforced invariants

Make invalid states harder or impossible to represent.

Do not create grotesque type-level machinery to solve simple runtime problems.

---

# OUTSIDE-IN TDD

For feature work, bugs, and significant behavior changes use outside-in TDD.

The default cycle is:

1. define the real human behavior
2. create a full E2E acceptance scenario that demonstrates it
3. confirm that scenario fails for the intended reason
4. add focused unit/integration tests where useful
5. implement the smallest correct behavior
6. make focused tests pass
7. make E2E acceptance pass
8. refactor
9. rerun regression suite
10. perform an adversarial browser pass

Feature TDD begins with user-visible behavior.

Unit tests remain actual unit tests and do NOT need to launch a browser.

**Every feature-level E2E/TDD acceptance scenario MUST obey the realistic navigation requirements below.**

---

# CRITICAL E2E PRINCIPLE

The E2E suite should behave like a diligent human tester.

A human does not usually:

* inject authentication tokens
* manually set cookies
* manually write localStorage
* call internal APIs to navigate
* teleport directly into a private route
* mutate application state behind the UI
* skip navigation because the selector is inconvenient

Therefore major acceptance tests must not do those things either.

The automated tester should use the application.

---

# EVERY MAJOR E2E TEST STARTS AT THE HOMEPAGE

For every full feature acceptance E2E test:

1. open the application's actual homepage/root
2. begin unauthenticated unless the product inherently works otherwise
3. invoke the repository's canonical E2E login mechanism through the browser
4. complete the login process
5. verify successful authenticated landing state
6. use visible navigation UI
7. click through menus/sidebar/navigation like a human
8. reach the feature being tested
9. perform the entire scenario through UI interaction
10. validate visible results
11. continue through subsequent steps
12. navigate away when relevant
13. navigate back through the UI
14. confirm state remains correct

Do not use direct route navigation as a shortcut for these acceptance tests.

Do not replace login with `storageState`, token injection, cookie injection, or internal authentication API calls unless that mechanism is literally the product's canonical E2E login workflow.

A shared helper such as:

`loginViaE2E(page)`

is encouraged **only if it actually performs the real browser-visible E2E login procedure**.

Likewise:

`navigateToAnalytics(page)`

may encapsulate actual user clicks.

It must not secretly call `page.goto('/analytics')`.

---

# ACCEPTANCE TESTS MUST TEST STORIES, NOT PAGES

Do not write shallow tests like:

> open Analytics
> expect heading Analytics

That proves almost nothing.

Create realistic multi-step stories.

Every major feature should have elaborate acceptance journeys representing how humans actually use it.

Tests should span cause → effect.

---

# EXAMPLE: ANALYTICS

An Analytics acceptance scenario should resemble:

1. start at homepage
2. authenticate through E2E login
3. arrive at the authenticated application
4. click through the sidebar/navigation to Analytics
5. verify Analytics loads correctly
6. verify current statistics and record relevant baseline values
7. navigate through the product to the relevant site/page
8. visit/use the page in the same way an actual visitor would
9. perform the action expected to generate an analytics event
10. return to the admin using realistic navigation
11. click Analytics again
12. wait using deterministic polling/web-first behavior for eventual processing
13. verify the appropriate statistic changed
14. verify unrelated statistics did not become nonsensical
15. inspect the relevant table/chart/detail views
16. change filters if available
17. validate filtered values
18. reload when appropriate
19. verify persistence
20. navigate away
21. return
22. verify state remains correct
23. verify zero unexpected browser errors/warnings throughout

The E2E test should prove the actual system works across the complete loop.

Not merely that the Analytics component renders.

---

# EXAMPLE: CRUD FEATURE

For a CRUD feature, a realistic test should often:

1. homepage
2. login
3. navigate through UI
4. inspect initial list
5. create record
6. verify confirmation
7. verify record appears
8. open record
9. inspect all displayed fields
10. edit record
11. verify validation behavior
12. save
13. verify new values
14. navigate away
15. return
16. verify persisted values
17. search/filter for it
18. exercise relevant actions
19. delete/archive it when appropriate
20. verify confirmation dialog
21. verify removal
22. reload
23. verify it remains removed
24. verify no console/network errors

---

# E2E FEATURE COVERAGE MATRIX

Maintain an E2E matrix in `.claude/refactor-state.md`.

For every major feature track coverage for relevant behaviors:

* navigation
* happy path
* empty state
* populated state
* create
* read
* update
* delete/archive
* cancel
* validation
* permission behavior
* loading state
* error handling
* persistence
* reload
* navigation away/back
* filters
* sorting
* pagination
* search
* responsive behavior
* keyboard behavior
* accessibility
* concurrent/duplicate action resistance
* browser console cleanliness
* network cleanliness
* important cross-feature effects

Not every feature needs every row.

Every major user capability needs realistic coverage.

---

# E2E TEST COMPLETENESS STANDARD

Do not consider a major feature `CONVERGED` merely because one happy-path E2E exists.

Ask:

> What are the realistic ways a human will interact with this?

Then test them.

Examples:

* first-time user
* returning user
* empty data
* existing data
* invalid form
* corrected form
* repeated action
* cancelled action
* refresh
* back/forward navigation
* narrow viewport
* large viewport
* collapsed sidebar
* expanded sidebar
* keyboard-only
* slow response
* recoverable backend failure
* stale state
* permissions
* destructive confirmation
* retry behavior

Automated testing should encounter edge cases before humans do.

The goal is that manual QA feels boring because the machines already exercised the realistic workflows.

---

# BROWSER CONSOLE MUST STAY CLEAN

Every significant E2E flow must collect browser diagnostics.

Capture:

* `console.error`
* `console.warn`
* uncaught page exceptions
* unhandled browser-side failures
* failed requests
* unexpected HTTP 5xx responses
* relevant unexpected 4xx responses

At test completion:

**fail the test on unexpected console warnings or errors.**

Do not casually allowlist warnings.

If an unavoidable third-party warning exists:

* prove its source
* narrowly match it
* document it
* avoid masking similar application warnings

The desired state is an empty allowlist.

A visually successful feature that throws errors in the browser is not successful.

---

# NETWORK CLEANLINESS

During E2E scenarios watch for:

* duplicate requests
* unexpected retries
* request storms
* 404s
* 401/403 where not expected
* 5xx responses
* cancelled requests caused by application bugs
* API schema mismatches
* failed assets
* unnecessary repeated fetching

A feature may render correctly while its network behavior is broken.

Test both.

---

# PLAYWRIGHT DOCTRINE

Use deterministic Playwright behavior for repeatable acceptance checks.

Prefer:

* role locators
* label locators
* accessible names
* user-facing text
* stable test IDs only where semantic locators are insufficient
* web-first assertions
* auto-retrying expectations
* explicit domain assertions
* deterministic browser state

Avoid brittle:

* CSS selectors tied to styling
* XPath unless genuinely necessary
* positional selectors
* `.first()` used to hide ambiguity
* `.nth()` used to hide ambiguity
* arbitrary sleeps
* `waitForTimeout()`
* racing asynchronous UI manually

If waiting is required, wait for a meaningful condition.

Use polling/retrying assertions rather than sleeping.

A flaky test is a bug in either the product or the test.

Fix it.

---

# BROWSERBASE + STAGEHAND

Use Browserbase and Stagehand as an additional browser-testing and exploratory layer where configured and useful.

Do not replace deterministic Playwright acceptance tests with fuzzy AI-only assertions.

Instead use this hierarchy:

## Layer 1 — Deterministic Acceptance

Playwright:

* exact user flow
* reproducible actions
* deterministic assertions
* regression protection
* CI suitability

## Layer 2 — Agentic Human Simulation

Browserbase + Stagehand:

* exploratory browser usage
* alternative interaction paths
* semantic element discovery
* natural-language actions
* UI variation tolerance
* adversarial behavior
* discovering journeys we forgot to encode
* realistic browser sessions

Use Stagehand primitives appropriately:

* `observe` to discover available actions
* `act` for semantic human-like interaction
* `extract` for structured semantic verification
* deterministic browser operations where precision matters

Mix Stagehand with Playwright where advantageous.

---

# STAGEHAND ADVERSARIAL FEATURE REVIEW

After implementing or substantially refactoring a major feature, give an independent browser agent a goal rather than a detailed script.

Example concept:

> Log into the application like a normal user. Find Analytics through the UI. Explore everything an ordinary user might reasonably attempt. Try normal workflows, incorrect inputs, navigation changes, refreshes, filters, repeated actions, and recovery behavior. Identify anything broken, confusing, inconsistent, inaccessible, or producing browser errors.

Let it discover interaction paths.

Then convert meaningful discoveries into deterministic Playwright regression tests.

**AI browser exploration finds bugs.
Deterministic E2E tests prevent them from returning.**

---

# E2E DISCOVERY → REGRESSION LOOP

Whenever Browserbase/Stagehand discovers a defect:

1. reproduce it
2. create deterministic Playwright regression coverage
3. verify the regression test fails
4. fix root cause
5. verify test passes
6. rerun adjacent acceptance scenarios
7. re-run agentic exploration where valuable

Never fix an exploratory bug without preserving the knowledge as a regression test when practical.

---

# RESPONSIVE E2E TESTING

Major admin workflows must be tested at important responsive states.

At minimum verify navigation behavior at:

* mobile
* collapsed-sidebar desktop/tablet-style width
* wide desktop

The same major workflow should remain possible at all supported layouts.

Do not merely screenshot each breakpoint.

Actually use it.

---

# SIDEBAR E2E MATRIX

Test the sidebar thoroughly.

## Mobile

* homepage
* login
* hamburger appears
* sidebar initially hidden
* open sidebar
* focus behavior
* click destination
* destination loads
* sidebar closes appropriately
* reopen
* Escape closes
* focus returns appropriately
* route state correct

## Medium

* homepage
* login
* collapsed sidebar visible
* icons usable
* tooltips appear through appropriate interaction
* keyboard usage works
* active state visible
* navigation works
* no content overlap

## Large

* homepage
* login
* full sidebar visible
* labels visible
* grouping correct
* navigation works
* active state correct
* layout stable

Also resize during an authenticated session.

Verify responsive state transitions do not leave:

* stale overlays
* trapped focus
* duplicate sidebars
* incorrect content margins
* hidden navigation
* broken scroll state

---

# ACCESSIBILITY IS PART OF E2E

Major workflows should validate accessibility, not merely visuals.

Audit/test as appropriate:

* semantic HTML
* accessible names
* keyboard navigation
* focus order
* focus visibility
* dialogs
* sheets
* menus
* tooltips
* ARIA
* form labels
* validation messages
* color contrast
* destructive actions
* reduced-motion considerations
* dynamic updates

Run automated accessibility checks where tooling exists.

Treat serious AXE/WCAG failures as bugs.

---

# TEST REAL CROSS-FEATURE EFFECTS

Tests should verify important system consequences.

Examples:

### Analytics

visit page → analytics changes

### Billing

change plan → entitlements/UI change

### Settings

change setting → feature behavior changes

### Content

edit page → published page changes

### Domain

configure domain → status/UI reflect it

### Feature flag

change flag → relevant behavior changes

### User permissions

change role → accessible actions change

### Deployment

trigger deploy → deployment state progresses → output is available

Do not stop at:

> toast says success

Verify the actual effect.

---

# TEST PERSISTENCE

For important mutations:

1. perform mutation
2. see immediate result
3. navigate away
4. return
5. reload
6. verify state remains correct

When appropriate, create a new page/tab/session and verify persisted state there too.

This catches optimistic-UI bugs that shallow tests miss.

---

# TEST ERROR RECOVERY

Where practical, test realistic failures.

Examples:

* validation failure
* rejected API request
* temporary unavailable operation
* expired/rejected auth
* permission denial
* malformed input
* network interruption
* conflicting state
* duplicate submission

Verify:

* understandable feedback
* no application crash
* retry/recovery behavior
* no corrupted UI state
* no duplicate mutations
* no console errors beyond intentionally handled diagnostics

---

# TEST DOUBLE-CLICK / RAPID USER BEHAVIOR

Humans click twice.

Humans navigate quickly.

Humans press Back.

Humans reload.

Humans submit imperfect input.

Humans resize windows.

Where relevant test:

* repeated click
* duplicate submit
* rapid navigation
* back/forward
* refresh during state
* reopen modal
* close without saving
* submit while pending

The application should behave predictably.

---

# TEST VISUAL STABILITY WHERE VALUABLE

For structurally important admin screens, consider stable screenshot/visual regression coverage after the UI becomes deterministic.

Good candidates:

* application shell
* mobile sidebar
* collapsed sidebar
* wide sidebar
* key dashboards
* major forms
* dialogs

Do not create fragile screenshot coverage for every trivial pixel.

Use it where layout regressions would materially hurt UX.

---

# UNIT TESTS

Use unit tests for:

* domain logic
* validation
* parsing
* transformations
* reducers/state machines
* permission rules
* serialization
* error mapping
* calculations
* edge cases
* critical utilities

Keep unit tests:

* fast
* deterministic
* isolated
* readable

Do not boot a full browser for a pure unit.

Do not mock half the application merely to call something a unit test.

If something requires absurd mocking, consider whether its architecture is wrong.

---

# CHARACTERIZATION TESTS

Before a risky rewrite of poorly tested existing behavior:

* capture important current behavior
* add characterization coverage
* then refactor

Afterward, remove characterization tests that merely preserve obsolete implementation details.

Keep tests that protect real product behavior.

---

# TEST QUALITY > COVERAGE PERCENTAGE

Do not create tests solely to increase a percentage.

A test must protect:

* behavior
* invariant
* user workflow
* contract
* regression
* meaningful edge case

Prefer 10 meaningful tests over 100 trivial ones.

Coverage reports are evidence.

They are not the objective.

---

# BUG-HUNT CONTINUOUSLY

Actively inspect for:

* race conditions
* stale state
* duplicate state
* async sequencing problems
* subscription leaks
* lost exceptions
* swallowed errors
* duplicate requests
* bad caching
* permission bypass
* incorrect loading state
* hydration mismatches
* SSR/browser assumptions
* invalid responsive transitions
* weak validation
* optimistic update corruption
* timezone bugs
* pagination bugs
* stale forms
* failed cleanup
* accessibility regressions

Do not wait for existing tests to expose defects.

---

# ROOT-CAUSE FIXING

When finding a bug:

1. reproduce
2. understand root cause
3. create regression test
4. fix architecture or implementation
5. verify
6. inspect adjacent code for same defect class

Never patch the visual symptom when the underlying state model is wrong.

---

# ERROR-HANDLING CONVERGENCE

Normalize error handling.

Errors should be:

* handled at meaningful boundaries
* categorized
* observable
* testable
* user-safe
* developer-understandable

Remove:

* swallowed errors
* duplicate logging
* meaningless catch/rethrow
* giant generic catch blocks
* leaked secrets
* console noise

---

# PERFORMANCE REVIEW

Look for measurable problems such as:

* duplicate requests
* unnecessary JavaScript
* oversized dependencies
* unnecessary Angular rendering
* redundant signals/computations
* eager route loading
* huge DOM
* repeated transformations
* wasteful serialization
* bad database query patterns
* unnecessary polling
* repeated initialization

Measure when practical.

Do not build complicated caching infrastructure to fix hypothetical performance.

---

# AI-OPTIMIZE THE REPOSITORY

A coding agent joining the repository should quickly understand:

* product purpose
* architecture
* commands
* feature locations
* shared primitives
* tests
* conventions
* forbidden patterns
* extension points
* deployment boundaries

Improve:

* `CLAUDE.md`
* `.claude/rules`
* skills
* scoped instructions
* architecture docs
* directory naming

Keep always-loaded context concise.

Move detailed procedural instructions into appropriate skills/rules.

Do not let `CLAUDE.md` become a novel.

---

# HUMAN-OPTIMIZE THE REPOSITORY

A senior engineer should be able to join tomorrow and navigate intuitively.

Improve:

* directory structure
* filenames
* package scripts
* README
* setup instructions
* environment documentation
* architectural boundaries
* test commands
* error messages

Prefer obvious structure over architecture requiring tribal knowledge.

---

# DELETE DOCUMENTATION DRIFT

Documentation that describes architecture that no longer exists is harmful.

After meaningful architecture changes:

* update authoritative documentation
* delete obsolete docs
* remove conflicting instructions
* remove obsolete comments

Do not keep documents merely because they are old.

---

# COMMENTS

Delete comments that merely repeat the code.

Keep comments that explain:

* non-obvious why
* external constraints
* security implications
* architectural decisions
* unusual browser/framework behavior

Prefer self-documenting code.

---

# QUALITY RATCHET

Establish baseline quality metrics when practical.

Track meaningful trends such as:

* failing tests
* skipped tests
* E2E scenario count
* critical-feature E2E coverage
* TypeScript errors
* lint errors
* Knip issues
* dependencies
* custom CSS size
* bundle size
* unexpected console warnings/errors
* accessibility failures

Do not game metrics.

A metric is evidence of repository direction.

---

# NO SILENT REGRESSION

After meaningful changes compare before/after where appropriate.

Do not accept unexplained regressions in:

* build
* runtime behavior
* tests
* bundle size
* accessibility
* browser console
* network health
* dependency count
* TypeScript strictness
* CSS complexity

If a regression is genuinely justified by new capability, record why.

---

# INDEPENDENT ADVERSARIAL REVIEW

After a substantial refactor, use a separate subagent/context when available.

Tell the reviewer to assume the implementation is subtly wrong.

Ask it to search for:

* lost functionality
* hidden regressions
* weak tests
* unnecessary new abstractions
* dead compatibility code
* incorrect Angular patterns
* incomplete Spartan migration
* leftover CSS
* accessibility failures
* security issues
* bad responsive behavior
* network problems
* state bugs

The implementation agent should evaluate and fix valid findings.

Do not ask the user to arbitrate normal engineering disagreements.

Choose the better solution.

---

# PARALLEL SUBAGENTS

Use parallel analysis when it meaningfully accelerates discovery.

Good independent tracks:

* architecture/dead-code audit
* Angular modernization
* Spartan/UI audit
* E2E gap analysis
* dependency/Knip audit
* accessibility audit
* security/error audit
* performance audit
* AI/human developer-experience audit

Avoid multiple agents rewriting the same files simultaneously.

Parallelize investigation more aggressively than overlapping implementation.

---

# BUILD / TEST GATES

Discover repository-native commands.

Do not blindly assume script names.

Run smallest relevant verification during the inner loop.

Before marking meaningful work converged, run applicable:

* formatting
* lint
* TypeScript
* unit tests
* integration tests
* E2E
* production build
* Knip/dead-code analysis
* accessibility tests
* browser diagnostic checks

Do not suppress tools just to make output green.

Fix causes.

---

# TEST FAILURE POLICY

A failing test means something.

Determine whether:

* implementation is wrong
* requirement changed
* test is invalid
* fixture is invalid
* environment is broken
* test is flaky

Never blindly alter expectations to make red become green.

Never delete valuable coverage because refactoring broke it.

---

# FLAKINESS POLICY

A test that passes only sometimes is not healthy.

Eliminate:

* arbitrary sleeps
* timing assumptions
* unstable selectors
* cross-test state pollution
* ambiguous UI state
* hidden concurrency races

Prefer deterministic waiting for domain conditions.

Retries may aid diagnosis.

Retries must not become the definition of passing.

---

# TEST ISOLATION VS REALISTIC FLOW

Each E2E should begin from a known clean state.

Test infrastructure may create necessary fixture data outside the UI when doing so does not bypass the behavior being tested.

However:

**The user interaction under test must happen through the actual UI.**

Never use backend setup as a substitute for testing a user-visible operation.

---

# TEST DATA

Use:

* deterministic unique names
* deterministic fixtures
* isolated test entities
* cleanup mechanisms

Avoid tests depending on arbitrary production-like shared state.

Never perform destructive testing against production data.

---

# SECURITY

Review consequential areas for:

* auth bypass
* authorization errors
* tenant isolation
* unsafe input handling
* injection
* XSS
* secret leakage
* insecure redirects
* insecure object access
* unsafe file handling
* sensitive logs
* CSRF/replay issues where relevant

Do not weaken security to make tests easier.

---

# GIT SAFETY

Never:

* force push
* rewrite shared history
* push without authorization
* expose secrets
* destroy production data
* modify production infrastructure simply to satisfy a test
* discard unrelated working-tree changes

Local refactoring is authorized.

Respect unrelated user modifications.

Use checkpoints/commits when helpful for recoverability according to repository workflow.

---

# LARGE REFACTOR DISCIPLINE

Before:

* inspect behavior
* inspect existing coverage
* add meaningful tests

During:

* keep architecture coherent
* run focused tests
* delete superseded implementation progressively

After:

* run broader tests
* inspect diff
* search for leftovers
* run Knip
* remove compatibility code
* remove unused imports
* remove CSS
* update docs
* browser-test complete flow

Do not leave permanent half-migrations.

---

# DELETION PASS AFTER EVERY REFACTOR

Every significant refactor should end with:

> What can now be deleted?

Search for:

* old implementation
* adapters
* flags
* imports
* exports
* styles
* mocks
* tests of obsolete behavior
* dependencies
* docs
* wrappers
* compatibility layers

A rewrite that leaves the old architecture sitting beside it is incomplete.

---

# CONVERGENCE CRITERIA FOR A MAJOR FEATURE

A major feature is not `CONVERGED` until:

* architecture is coherent
* product behavior is complete
* types are strong
* important unit tests pass
* realistic E2E journeys pass
* E2E starts from homepage/login/navigation
* important error paths are tested
* persistence is tested
* cross-feature effects are tested where applicable
* mobile/desktop behavior works where applicable
* accessibility is acceptable
* console has no unexpected warnings/errors
* network behavior has no unexplained failures
* no obvious dead implementation remains
* obsolete CSS is gone
* Knip findings are understood/resolved
* documentation is accurate
* code is understandable by humans
* code is understandable by future AI agents

---

# REPOSITORY-WIDE DONE CONDITION

The repository approaches convergence when:

* production build passes
* lint passes
* strict TypeScript passes
* unit tests pass
* integration tests pass
* E2E tests pass
* every major product feature has realistic multi-step acceptance coverage
* Browserbase/Stagehand exploration finds no obvious untested major defects
* major workflows produce no unexpected console warnings/errors
* major workflows produce no unexplained network failures
* critical accessibility checks pass
* Angular code follows current version-aligned architecture
* old Angular patterns have been reduced where appropriate
* admin consistently uses Spartan
* sidebar is excellent at mobile/medium/large states
* old sidebar CSS is removed
* CSS surface is materially simpler
* no obvious unused dependencies remain
* no obvious dead files remain
* no obvious unused exports remain
* no major architecture duplication remains
* TypeScript strictness has not regressed
* repository instructions accurately represent reality
* humans can confidently manually test the product
* AI agents can confidently modify it
* new features have obvious homes
* conceptual complexity exists only where product complexity genuinely requires it

---

# FINAL PHILOSOPHY

Be aggressive toward code.

Be conservative toward required product behavior and data.

Do not confuse:

* old with correct
* complex with sophisticated
* abstraction with architecture
* coverage with confidence
* green tests with complete testing
* rendering with working
* successful HTTP responses with successful features
* toast messages with persisted outcomes
* custom code with product value
* more files with organization
* more CSS with better design
* more dependencies with capability

**Refactor everything that deserves refactoring.**

**Rewrite weak architecture.**

**Delete accidental complexity.**

**Converge competing approaches.**

**Use current Angular architecture.**

**Converge the admin around Spartan.**

**Delete the old CSS.**

**Make TypeScript enforce more correctness.**

**Use Knip to prove dead code is gone.**

**Test features as humans actually use them.**

**Start major E2E acceptance flows at the homepage.**

**Login through the E2E UI method.**

**Navigate by clicking the actual interface.**

**Test cause and effect across the whole application.**

**Use Playwright for deterministic regression protection.**

**Use Browserbase + Stagehand to explore the application like an intelligent human.**

**Turn every discovered bug into permanent deterministic regression coverage.**

**Require a clean browser console.**

**Require clean network behavior.**

**Never ask the user what to do next.**

**Make the best engineering decision and continue.**

At the end of every iteration:

1. leave the repository better than you found it
2. update `.claude/refactor-state.md`
3. identify the weakest remaining subsystem
4. immediately target that next

Continue converging until the autonomous session ends or there is genuinely no meaningful repository improvement remaining.
