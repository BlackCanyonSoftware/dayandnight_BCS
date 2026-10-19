# Handoff

Where the project stands, for whoever picks it up next - a person or a fresh
session with no memory of this one. Newest session first.

## Current state

**Milestone 0 is built and verified, except for the performance budget, which
fails.** The application runs, puts a live computed sky on the Windows desktop
behind the icons on every screen, and the editor drives it.

- **Branch:** `main`
- **Remote:** `origin` is `github.com/BlackCanyonSoftware/dayandnight_BCS`.
  **Nothing has been pushed.** The owner pushes.
- **Tier:** MVP
- **Checks:** lint, format, typecheck clean. 36 unit, 11 browser (one image
  reference), 7 desktop tests, all passing.
- **CI:** written (`.github/workflows/ci.yml`, Windows runner) but **never
  run**, because nothing has been pushed. Report it as unverified.

## The open question, and it blocks Milestone 1

**NFR-1 is not met.** At the default 20 fps on two screens the application
costs about **8.5% of one CPU core** against a budget of 2%, and about
**570 MB** against a budget of 160 MB for two screens.

The Milestone 0 shader is a vertical gradient with a dither, so this is the
Electron host's cost, not the sky's - a more complex sky will not make it much
worse, and a simpler one will not make it better. Drawing _less often_ does
scale it: 5 fps nearly reaches the budget.

ADR 0001 said this decision would reopen if the budget failed at Milestone 0.
It has, at exactly the moment intended: before any art depends on it. The four
options, with the recommendation, are in `docs/ROADMAP.md` under Milestone 0's
outcome. **The owner chooses before Milestone 1 builds further on this host.**

Two caveats on the measurement itself, both honest:

- Two of its six samples (idle, and 1 fps) are internally contradictory - they
  sit above the 5 fps sample, which is impossible - so **the floor is not yet
  known** and the "floor plus per-frame" split is not trustworthy. The
  headline does not depend on those rows. Re-measure with a longer settling
  window on a quiet machine.
- GPU time was not measured at all. There is no dependency-free way to read it
  on Windows.

## What exists

```
app/engine/     the renderer. Pure, no DOM, no Electron, no state between frames
  astro/solar.js    PLACEHOLDER sun position, 1-2 degrees (M1 replaces it)
  sky/oklab.js      the only colour conversions in the project
  sky/palette.js    PLACEHOLDER nine-stop gradient (M1 replaces it)
  gl/               the only files that know what WebGL is
app/ui/         the editor: panel, scrubber, preview, theme, settings
app/wallpaper.js  one monitor's surface; ~160 lines, and that is the point
desktop/        the Electron shell
  host-win32.js   the WorkerW sequence; the ONLY Win32 caller
  pause.js        lock, suspend, battery, full-screen detection
tools/          probe-host.js (safe), measure-cost.js (opens windows), serve.js
```

## Decisions already made

Settled with the owner and recorded as ADRs. Do not relitigate without a
reason the ADR does not already cover.

| Decision                                              | Where    | Status after M0                    |
| ----------------------------------------------------- | -------- | ---------------------------------- |
| Electron shell over a static ES-module web app        | ADR 0001 | **Reopened by the budget failure** |
| Win32 through koffi, one module                       | ADR 0002 | Proven on hardware, first attempt  |
| WebGL2 now, WebGPU later                              | ADR 0003 | Holds                              |
| Physical sky with an authored grade                   | ADR 0004 | Not yet built (M1)                 |
| Stateless scene, independent windows, no sync channel | ADR 0005 | Holds, and paid off repeatedly     |

## Next steps

1. **The owner picks an option for NFR-1** (`docs/ROADMAP.md`, Milestone 0
   outcome). Recommended first: redraw only when the scene has meaningfully
   changed - it is cheap to try and it also reveals the true floor.
2. **Re-measure** with a longer settling window, on a quiet machine, to get a
   trustworthy floor.
3. **Verify pause-on-fullscreen by hand** against a real game. The policy and
   the signal are implemented and unit-covered; nobody has watched it stop.
4. Then **Milestone 1**: real astronomy, the scattering model, the grade, the
   sun, the moon, the stars. Exit criteria in `docs/ROADMAP.md`.

## Open questions for the owner

- **OQ-1** Tray icon and autostart in v1? (Recommend yes, M2.)
- **OQ-2** How many cities in the bundled picker? (Recommend 1,000.)
- **OQ-3** Editor theme follows Windows or the sun? (Recommend Windows; it is
  built and defaults to dark with a three-way toggle.)
- **OQ-4** Licensing and installer shape. **Needed before Milestone 2.** There
  is no `LICENSE` file yet and `package.json` says `UNLICENSED`.
- **The brand.** `app/brand/` is empty by design and the sidebar slot holds its
  space. There is still no `dayandnight-bcs` brand in the kit at
  `C:\Users\Kpier\Documents\brand logos`.

## Gotchas

- **Do not run `npm run desktop`, `npm run test:desktop` or
  `tools/measure-cost.js` on a machine somebody is using.** They create
  windows, parent them behind the desktop icons and raise them. This
  interrupted the owner during Milestone 0. `node tools/probe-host.js` checks
  the Win32 side and opens nothing.
- **Never touch `window.webContents` inside a `closed` handler.** The object is
  destroyed by then and it throws out of an event handler, which Electron
  shows the user as a crash dialog. Capture ids at creation. This was a real
  bug in M0.
- **Pixel Galaxy Studio is the reference for the UI, not the engine.** Its
  renderer is canvas 2D on CPU workers for offline mp4 export - the opposite of
  what this needs. Its `ui/panel.js`, `ui/schema.js`, `ui/output.js`,
  `ui/monitors.js`, `ui/settings.js` and Electron shell are worth porting;
  `engine/` is not, except `stars.js` and `twinkles.js` for ideas.
- **Oklab does not prevent a muddy midpoint between complementary hues.** A
  unit test originally asserted that it did and was wrong. Oklab buys an even
  lightness progression; keeping chroma is the ramp's job, via enough stops to
  trace the hue path. Both are now pinned by tests.
- **A purely vertical gradient makes two side-by-side crops identical**, so the
  span test cannot prove the crop is honoured horizontally until the sun has a
  real azimuth in M1. It proves it vertically instead.
- `strict` and `checkJs` are on from day one, unlike Pixel Galaxy Studio. Keep
  them on.
- The root `package.json` is `type: commonjs` for Electron's main process, so
  ESM config files must be `.mjs`.
- **Never attribute anything to an assistant**, and **never push**.

## Session log

### 2026-10-18 - Milestone 0, the walking skeleton

- Built the Electron shell with its own `dayandnight://` secure scheme, the
  editor window, and one borderless wallpaper window per monitor.
- **Proved the WorkerW technique** with `tools/probe-host.js` before writing
  anything on top of it - it worked first time, retiring ADR 0002's risk.
- Built the engine: pure-function renderer, placeholder solar position,
  Oklab colour, a nine-stop gradient palette, blue-noise dither, WebGL2
  context with loss handling.
- Built the editor shell to match Pixel Galaxy Studio's layout in the new
  palette: brand slot (empty), settings panel with a hint on every control,
  live preview, light/dark/system theme, and the 24-hour scrubber that paints
  the day's real shape into its track.
- Wrote 54 tests across three levels. **Two of them found real problems**: the
  Oklab chroma claim was wrong (docs and ADR 0004 corrected), and the palette
  crossed through near-neutral grey around +7 degrees (a stop was added).
- Fixed a crash that showed the owner an Electron error dialog: reading
  `window.webContents` inside a `closed` handler.
- Added an explicit `starting` host state after a test found `on: true` being
  reported with `host: "off"`, which the editor would have mislabelled as
  success.
- **Measured NFR-1 and it fails.** Written up in `docs/ARCHITECTURE.md` with
  the method and the caveats. This is the project's open question.
- Interrupted the owner twice by launching windows. Noted above so the next
  session does not repeat it.

### 2026-10-18 - project kickoff and plan

- Read the owner's standards, Pixel Galaxy Studio as the UI reference, and the
  brand kit. Put four architecture questions to the owner; all four
  recommendations were accepted and became ADRs 0001-0005.
- Wrote `docs/PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, `ROADMAP.md`, the five
  ADRs, and this file. Nothing was built or run.
