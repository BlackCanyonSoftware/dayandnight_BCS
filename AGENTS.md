# AGENTS.md

The guide for AI assistants working on Day and Night. People should read
`CONTRIBUTING.md`; this file restates the rules that must not be broken,
because it is loaded automatically.

## What this is

A live Windows desktop wallpaper that renders the real sky for the user's own
time and place. No video file, no loop: the scene is computed from the clock
and the user's coordinates. **Rigor tier: MVP.**

## Commands

| Command                           | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `npm run desktop`                 | Run the application (Electron). **Opens windows on the user's desktop.** |
| `npm run serve`                   | Serve `app/` at `http://127.0.0.1:5178` for browser work                 |
| `npm run lint`                    | ESLint                                                                   |
| `npm run format` / `format:check` | Prettier                                                                 |
| `npm run typecheck`               | `tsc` over JSDoc, `strict` and `checkJs` on                              |
| `npm run test:unit`               | `node:test`, the arithmetic                                              |
| `npm run test:e2e`                | Playwright, the editor in a browser                                      |
| `npm run test:desktop`            | Playwright, the real Electron app. **Opens windows.**                    |
| `npm run check`                   | lint + format + typecheck + unit + e2e                                   |
| `npm run build`                   | Build the Windows installer into `dist/`. Opens nothing, takes minutes.  |
| `node tools/probe-host.js`        | Check the WorkerW technique on this machine. Opens nothing.              |
| `node tools/measure-cost.js`      | Measure NFR-1. **Opens windows, takes minutes.**                         |
| `node tools/verify-package.js`    | Check a packaged build really works. **Opens windows.**                  |

**Ask the user before running anything marked "opens windows".** The
application takes over the desktop background and raises windows; running it
while someone is working interrupts them.

## Project map

```
app/            the web app, loaded by every window
  engine/       the renderer. No DOM, no Electron, no timers, no state between frames
    astro/      where the sun and moon are (Meeus; see the tests before changing)
    sky/        scattering, grade, oklab, palette
    gl/         context, program - the only files that know what WebGL is
  ui/           the editor
  wallpaper.js  one monitor's surface; deliberately tiny
desktop/        the Electron shell
  host-win32.js the ONLY file that calls Win32
  main.js       windows, IPC, lifecycle
  pause.js      when to stop drawing
tests/          unit (node:test), browser (Playwright), desktop (Playwright + Electron)
docs/           PRD, ARCHITECTURE, DESIGN, ROADMAP, adr/, HANDOFF
```

## Read first

`docs/HANDOFF.md` - where things stand, every session, before anything else.
Then `docs/ROADMAP.md` for what is next and `docs/ARCHITECTURE.md` for how it
is built. `docs/adr/` holds decisions already made; do not relitigate them
without a reason the ADR does not cover.

## The invariants

Full list in `docs/ARCHITECTURE.md`. These are the ones that get broken by
accident:

1. **The scene is a pure function of `(preset, t, place, crop, pixelRatio)`.**
   No `Date.now()`, no `performance.now()`, no unseeded `Math.random()`, no
   timers and no accumulated state inside `app/engine/`. A lint rule enforces
   it. Two renders with the same arguments must be byte-identical.
2. **The engine never touches the DOM, Electron or the network**, and never
   decides when to draw. The host owns the loop.
3. **Wallpaper windows never talk to each other.** They stay in step because
   they compute the same pure function of the same clock. Adding a sync
   channel would be the bug, not the fix.
4. **Colour is mixed in linear light and interpolated in Oklab**, and the
   conversions live only in `engine/sky/oklab.js`.
5. **No setting may make the sun wrong.** A preset describes appearance only.
6. **A new setting** is a default in `engine/defaults.js` with a comment, a
   schema row with a hint, and a migration entry if it renames or changes the
   meaning of an existing key.
7. **Pausing tears the render loop down**, never runs it and returns early.
8. **`desktop/host-win32.js` is the only module that calls Win32.**

## Conventions

- JavaScript, ES modules in `app/`, CommonJS in `desktop/` and `tools/`. No
  build step: the file on disk is the file that runs.
- `// @ts-check` at the top of every file; types are JSDoc. `npm run typecheck`
  must pass with `strict`.
- Every control in the settings panel has a hint on its `i`. A control without
  one is a bug. No loose explanatory text in the panel.
- Every colour, radius, duration and spacing step comes from `app/tokens.css`.
  A one-off value in a component is a bug.
- Comments say **why**, not what. Match the density of the surrounding code.

## Building a slice

1. Restate the acceptance criteria from `docs/PRD.md` (story IDs like US-012).
2. Write the test first for domain logic and for every bug fix.
3. Build the smallest version that works end to end.
4. Review your own diff: naming, duplication, dead code, security, scope.
5. Commit when the Definition of Done holds.

## Definition of Done

1. Meets the acceptance criteria.
2. Tests cover the new behaviour; the whole suite passes.
3. Lint, format and typecheck pass with no new warnings.
4. **You ran it and observed it.** Not "should work".
5. Docs the change affects are updated, including `docs/HANDOFF.md`, the
   roadmap status, an ADR for a significant decision, and `CHANGELOG.md` for
   anything a user would notice.
6. No leftover debug code, untracked TODOs, or placeholder data presented as
   real.
7. Committed locally as a focused Conventional Commit.

## Never

- **Never attribute anything to an assistant.** No `Co-Authored-By`, no
  "Generated with", no assistant name in a commit message, PR, issue, code
  comment or file. Commits are authored by the repository owner.
- **Never push.** Commit locally; the owner reviews and pushes.
- **Never weaken a test to get a passing run** - no skipping, no hardcoded
  outputs, no `--no-verify`, no disabling a lint rule or type check to get
  green. If a test is wrong, say why before changing it.
- **Never present a placeholder as finished.** `engine/sky/palette.js` is a
  Milestone 0 placeholder and says so at the top; anything similar gets the
  same treatment, plus an entry in the roadmap.
- **Never claim something works that you have not run.** If you cannot run it
  here, say so and give the exact command.

## Reporting

At the end of a session, update `docs/HANDOFF.md` and report: **Summary**,
**Done** (with story IDs and key files), **Verification** (each check with its
actual result; anything unverified marked as such), **Try it**, **Decisions and
assumptions**, **Deviations**, **Known issues**, **Next**, **Needs you**.
