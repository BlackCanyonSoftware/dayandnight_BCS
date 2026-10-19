# Handoff

Where the project stands, for whoever picks it up next - a person or a fresh
session with no memory of this one. Newest session first.

## Current state

**Planning only. There is no code yet.** The repository holds the plan: PRD,
architecture, design, roadmap and five decision records. Nothing has been
built, installed or run, and there is no `package.json`.

The project is at the pause the kickoff standard calls for after the plan, with
the owner's approval outstanding before Milestone 0 begins.

- **Branch:** `main`
- **Remote:** `origin` is `github.com/BlackCanyonSoftware/dayandnight_BCS`,
  which is **empty**. Nothing has been pushed. The owner pushes.
- **Tier:** MVP (per `Claude Prompts/1 - New Project Kickoff Prompt.md`)

## What this is

A live Windows desktop wallpaper that renders the real sky for the user's own
time and location: sunrise on screen when the sun actually rises, correct
twilight, correct moon phase, stars where stars are. No video file, no loop -
the scene is computed from the clock.

Read in this order: `docs/PRD.md`, then `docs/ARCHITECTURE.md`, then
`docs/ROADMAP.md`. `docs/adr/` holds the reasoning behind the five decisions
that shape everything else.

## Decisions already made

Settled with the owner, and recorded as ADRs. Do not relitigate these without a
reason the ADR does not already cover:

| Decision | Where |
|---|---|
| Electron shell around a static ES-module web app, no build step | ADR 0001 |
| Win32 calls through koffi, confined to one module | ADR 0002 |
| WebGL2 now; WebGPU is a later backend swap | ADR 0003 |
| Physical sky model with a user-authored grade over it | ADR 0004 |
| Stateless scene; independent windows with no sync channel | ADR 0005 |
| One sky spanning every monitor, not one scene per screen | PRD US-012 |
| Milestone 1 scope is sky + sun/moon + stars; clouds come later | ROADMAP |

## Next steps

1. **Owner approves the plan** (or redirects it). This is the cheap moment to
   change direction.
2. **Milestone 0, the walking skeleton.** Exit criteria are in `ROADMAP.md`.
   The order that retires risk fastest:
   - `package.json`, tooling, CI, and the remaining docs (`README.md`,
     `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`).
   - Electron shell with the custom `dayandnight://` scheme and the editor
     window.
   - **`desktop/host-win32.js` and the WorkerW sequence.** Do this early. It is
     the single assumption that would invalidate the architecture, and ADR 0002
     is not proven on hardware yet.
   - A WebGL2 context drawing a flat gradient from a hard-coded altitude
     slider, on the desktop, on every monitor.
   - **Measure NFR-1 and write the numbers into `ARCHITECTURE.md`** with the
     machine and the method. If the budget fails, ADR 0001 reopens.

## Open questions for the owner

Carried from `docs/PRD.md` section 10; none of them block Milestone 0.

- **OQ-1** Tray icon and autostart in v1? (Recommendation: yes, deferred to
  Milestone 2.)
- **OQ-2** How many cities in the bundled picker? (Recommendation: start at
  1,000.)
- **OQ-3** Should the editor theme follow Windows or the sun? (Recommendation:
  Windows by default.)
- **OQ-4** Same EULA and installer shape as Pixel Galaxy Studio? **Needed
  before Milestone 2.**

Also outstanding, and not blocking:

- **The brand.** The owner is supplying a logo and wordmark. `app/brand/` stays
  empty and the sidebar's top-left slot holds its space until then
  (`docs/DESIGN.md`). There is no `dayandnight-bcs` brand in the brand kit at
  `C:\Users\Kpier\Documents\brand logos` yet; when the assets are made, they
  should be generated there rather than drawn in CSS, as Pixel Galaxy Studio
  does it.

## Gotchas

- **Pixel Galaxy Studio is the reference for the UI, not for the engine.** Its
  editor - `ui/panel.js`, `ui/schema.js`, `ui/output.js`, `ui/monitors.js`,
  `ui/settings.js`, `ui/history.js` and the Electron shell - ports across
  almost directly. Its *renderer* is canvas 2D on CPU workers for offline mp4
  export, which is the opposite of what this project needs. Do not port
  `engine/`. The exceptions worth reading for ideas are `engine/stars.js` and
  `engine/twinkles.js`, for the star glow and pulse behaviour.
- **`strict` from day one.** Pixel Galaxy Studio has `strict: false` in
  `jsconfig.json` and is retrofitting types file by file. This project turns on
  `checkJs` and `strict` at Milestone 0 so it never acquires that debt. Do not
  copy its `jsconfig.json`.
- **Electron 44, not 33.** Pixel Galaxy Studio is on 33; this is a new project
  and starts current (ADR 0001).
- **The owner's PowerShell 5.1 is execution-policy `Restricted`.** Any helper
  script has to work around that, which is part of why ADR 0002 rejected
  shelling out to PowerShell. Shell commands given to the owner should be
  PowerShell, and should say where to run them.
- **Never attribute anything to an assistant** in a commit, PR, issue or file.
  The owner's global instruction and the kickoff standard both require this.
- **Commit locally, never push.** The owner reviews and pushes.
- **A hook in this environment blocks shell commands whose text looks like a
  wait loop.** Prose containing "until ... sleep" in a heredoc will trip it;
  write documentation with the file tools instead.

## Session log

### 2026-10-18 - project kickoff and plan

- Read the owner's standards (`Claude Prompts/`), Pixel Galaxy Studio as the UI
  reference, and the brand kit. Confirmed the GitHub repository and local folder
  were both empty.
- Put four architecture questions to the owner (wallpaper host, sky model,
  multi-monitor behaviour, Milestone 1 scope). All four recommendations were
  accepted; they are now ADRs 0001-0005 and the roadmap.
- Initialised the repository on `main`, added `origin`, and wrote the repository
  config (`.gitignore`, `.gitattributes`, `.editorconfig`, `.prettierrc.json`,
  `.prettierignore`, `.nvmrc` at Node 24).
- Wrote `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`,
  `docs/ROADMAP.md`, ADRs 0001-0005, and this file.
- Verified `koffi@3.3.3` (MIT, Niels Martignène, `github.com/Koromix/koffi`)
  before recording it in ADR 0002. **Not installed.**
- **Nothing was built or run.** No `package.json`, no dependencies, no tests.
  Every performance and viability claim in the docs is a target, explicitly
  marked as such, not a measurement.
- Stopped at the post-plan pause for the owner's approval.
