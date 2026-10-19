# Contributing

How work gets done on Day and Night. `AGENTS.md` is the short version for AI
assistants and restates the rules that must never be broken; this is the whole
thing.

## Setup

Node 24 (see `.nvmrc`; anything from 22 works).

```bash
npm install
npm run desktop
```

That is the whole setup. There is no build step, no database, no services and
no environment variables: the file on disk is the file that runs.

To work on the editor without launching the desktop application:

```bash
npm run serve   # http://127.0.0.1:5178
```

The editor runs in a plain browser because `app/ui/desktop.js` does the
browser's thing whenever the Electron bridge is absent. There is no wallpaper
to turn on there, and it says so.

### Running things that take over the desktop

`npm run desktop`, `npm run test:desktop` and `node tools/measure-cost.js`
create windows, parent them behind the desktop icons, and raise them. Do not
run them on a machine somebody is using without telling them first.

`node tools/probe-host.js` checks the Win32 side of the wallpaper host without
opening anything, and is safe at any time.

## Workflow

1. Read `docs/HANDOFF.md`, then `docs/ROADMAP.md`.
2. Take the next roadmap item. Restate its acceptance criteria from
   `docs/PRD.md` - stories have IDs like `US-012`, referenced from test names.
3. Write the test first for domain logic and for every bug fix.
4. Build the smallest thing that works end to end.
5. Review your own diff before committing.
6. Commit locally. **Never push** - the owner reviews and pushes.

Work on the current branch unless the owner names another. If you create one
for larger work, record it in `docs/HANDOFF.md` and leave merging to the owner.

## Code conventions

- **JavaScript, no build step.** ES modules under `app/`, CommonJS under
  `desktop/` and `tools/`. Shaders are template strings in
  `app/engine/shaders.js` because there is no bundler to import `.glsl` with.
- **`// @ts-check` on every file.** Types are JSDoc, checked by
  `npm run typecheck` with `strict` and `checkJs`. This project turned both on
  at Milestone 0 specifically so it never acquires a retrofit backlog; do not
  turn them off for a file.
- **Comments explain why.** A comment that restates the code is noise. The
  ones worth writing are the ones that stop the next person undoing a
  deliberate decision.
- **Names match the glossary** in `docs/PRD.md`. One term per concept:
  _altitude_, _azimuth_, _span_, _crop_, _grade_, _preset_, _host_.
- **Small public surfaces.** The engine exposes one class with three methods.
  `host-win32.js` exposes intent, not mechanism. Keep it that way.

## Architecture rules

The full list is in `docs/ARCHITECTURE.md` under Invariants, and the short
list is in `AGENTS.md`. The spirit of all of them is one idea:

> The scene is a pure function of its inputs.

Everything good about this design falls out of that - monitors that cannot
drift apart, a preview that cannot disagree with the desktop, a wallpaper that
is correct after the machine has slept, image tests that can pin a sky, a lost
GPU context that costs nothing. Almost every tempting shortcut breaks it. If a
change needs state between frames, that is a design conversation, not an
implementation detail.

A lint rule refuses `Date.now()`, `performance.now()`, `Math.random()` and
timers inside `app/engine/`. It is not there to be worked around.

## UI rules

- Every control has a hint on its `i`, and the hint says _why_ you would touch
  the control, not what it is called. A control without one is a bug (US-023).
- No loose explanatory text in the settings panel. The `i` is where words go.
- Every colour, radius, duration and spacing step comes from `app/tokens.css`.
- Every screen state is designed: loading, empty, error, disabled, pending.
- WCAG 2.2 AA. Keyboard operable, visible focus, 4.5:1 text contrast,
  `prefers-reduced-motion` honoured.
- The brand slot in the sidebar stays empty until the owner supplies the mark.
  See `app/brand/README.md`.

## Testing

| Level   | Where                                   | What belongs there                                                                            |
| ------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Unit    | `tests/unit/`, `node:test`              | The arithmetic: astronomy, colour, settings. Fast, deterministic, no DOM.                     |
| Browser | `tests/browser/`, Playwright            | The editor over the dev server, plus engine behaviour that needs a real WebGL context.        |
| Desktop | `tests/desktop/`, Playwright + Electron | The things only the real application can prove: the WorkerW host, the lockdown, the surfaces. |

Rules:

- Tests check behaviour through public interfaces. The page API
  (`window.DayAndNight`) exists for this.
- Deterministic: no real clock, no network, no unseeded randomness. Pin the
  date in any test whose assertion depends on the season, or it becomes a
  different claim every month.
- Reference story IDs in test names where one applies.
- Image tests carry a tolerance, because CI renders through SwiftShader rather
  than a real driver. Exactness is pinned by unit tests on the arithmetic
  instead.
- **Never weaken a test to get a passing run.** If a test is wrong, explain why
  before changing it. A test that caught something real and surprising is the
  most valuable thing in the suite - two of them changed the design during
  Milestone 0.

## Quality gates

```bash
npm run check    # lint, format, typecheck, unit, browser
npm run test:desktop   # separately: it opens windows
```

`npm run check` must pass before a commit. CI runs the same on Windows, and
only after the owner pushes - so run it locally and report CI as "not verified
until pushed".

A deliberate change to the look refreshes the image references
(`npm run test:e2e:update`) in the same commit.

## Commits

- Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`. The message explains **why**.
- Small and focused, ideally under about 400 changed lines excluding generated
  files. Never mix formatting or refactoring with a behaviour change.
- **No assistant attribution anywhere.** No `Co-Authored-By`, no "Generated
  with", no session links, in commit messages, PR titles or bodies, issues,
  review comments, code comments or files. Commits are authored by the owner
  with the owner's git identity.
- **Commit locally, never push.**
- `CHANGELOG.md` gets a line under _Unreleased_ for anything a user would
  notice.

## Dependencies

Justify every one: maintenance, size, licence. Verify the exact package name
and publisher before installing - look-alike and invented package names are a
real supply-chain risk. Anything third-party goes in
`licenses/THIRD-PARTY-NOTICES.md` in the commit that adds it, with its licence
text in `licenses/third-party/`; if it ships, it also goes in `REQUIRED` in
`desktop/build/check-bundle.js`, so that a build which drops its licence fails
instead of shipping. `licenses/README.md` has the full rule, including which
licences need the owner's decision.

The runtime dependency list is one entry long (`koffi`, for five Win32 calls,
ADR 0002). Keep it short.

## Definition of Done

1. Meets the acceptance criteria.
2. Tests cover the new behaviour at the levels above, and the suite passes.
3. Lint, format and typecheck pass with no new warnings.
4. **You ran it and watched it work.** For UI, in a real window: no console
   errors, keyboard operable, every state present. "Should work" is not
   verification.
5. The security baseline holds: nothing from a renderer or a settings file is
   trusted without validation.
6. Docs the change touches are updated - `README.md` or `AGENTS.md` if the
   commands changed, roadmap status, an ADR for a significant decision,
   `docs/DESIGN.md` for a new UI pattern, `CHANGELOG.md` for user-visible
   change, and always `docs/HANDOFF.md`.
7. No leftover debug code, no untracked TODOs, no placeholder presented as
   finished. A placeholder says so at the top of its file and has a roadmap
   entry.
8. Committed locally as a focused Conventional Commit.
